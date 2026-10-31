import { test, expect } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
test("catalog choices remember each model's effort and survive reopening without starting a turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-models-"));
  const calls: string[] = [];
  const store = new Chats(join(dir, "chats.json"));
  const connect = async () => ({ request: async (method: string) => {
    calls.push(method);
    return { data: [
      { model: "a", displayName: "A", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], defaultReasoningEffort: "low" },
      { model: "b", displayName: "B", supportedReasoningEfforts: [{ reasoningEffort: "medium" }], defaultReasoningEffort: "medium" },
    ], nextCursor: null };
  }, respond() {}, close() {} });
  try {
    const chat = await store.create(dir);
    const service = new ChatService(store, connect as never);
    await service.models(dir, chat.id, "a", "high");
    expect((await service.models(dir, chat.id, "b")).choice).toEqual({ model: "b", effort: "medium" });
    expect((await service.models(dir, chat.id, "a")).choice).toEqual({ model: "a", effort: "high" });
    await expect(service.models(dir, chat.id, "b", "high")).rejects.toThrow("Unsupported");
    await expect(service.models(dir, chat.id, "missing")).rejects.toThrow("Unavailable model");
    const reopened = new ChatService(new Chats(join(dir, "chats.json")), connect as never);
    expect((await reopened.models(dir, chat.id)).choice).toEqual({ model: "a", effort: "high" });
    expect(calls.every(c => c === "model/list")).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
