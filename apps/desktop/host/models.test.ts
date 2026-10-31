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

test("saved chat activation supplies defaults and supersedes delayed activation and catalog reads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-model-race-"));
  const store = new Chats(join(dir, "chats"));
  let release: (() => void) | undefined;
  let delay = false;
  const connect = async () => ({ request: async () => {
    if (delay) { delay = false; await new Promise<void>(resolve => { release = resolve; }); }
    return { data: ["a", "b"].map(model => ({ model, displayName: model, supportedReasoningEfforts: [{ reasoningEffort: "low" }], defaultReasoningEffort: "low" })), nextCursor: null };
  }, close() {} });
  try {
    const service = new ChatService(store, connect as never);
    const background = await store.create(dir), foreground = await store.create(dir);
    await service.models(dir, background.id, "b");
    await service.models(dir, foreground.id, "a");
    await service.models(dir, background.id, undefined, undefined, true);
    const activated = await store.create(dir);
    expect((await service.models(dir, activated.id)).choice).toEqual({ model: "b", effort: "low" });
    delay = true;
    const pending = service.models(dir, background.id, undefined, undefined, true);
    while (!release) await new Promise(resolve => setTimeout(resolve, 1));
    await service.models(dir, foreground.id, undefined, undefined, true);
    release(); await pending;
    release = undefined;
    delay = true;
    const read = service.models(dir, background.id);
    while (!release) await new Promise(resolve => setTimeout(resolve, 1));
    (release as () => void)(); await read;
    const draft = await store.create(dir);
    expect((await service.models(dir, draft.id)).choice).toEqual({ model: "a", effort: "low" });
  } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});
