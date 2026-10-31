import { test, expect } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
test("custom and managed policy cannot be replaced by a preset", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-permissions-"));
  const store = new Chats(join(dir, "chats"));
  let config: Record<string, unknown> = { sandbox_workspace_write: { writable_roots: ["/custom"], network_access: true } };
  let requirements: unknown = null;
  const connect = async () => ({ request: async (method: string) => method === "config/read" ? { config } : { requirements }, respond() {}, close() {} });
  try {
    const chat = await store.create(dir);
    const service = new ChatService(store, connect as never);
    await expect(service.permissions(dir, chat.id, "full")).rejects.toThrow("Custom or managed");
    config = {}; requirements = { allowedSandboxModes: ["read-only"] };
    await expect(service.permissions(dir, chat.id, "edits")).rejects.toThrow("Custom or managed");
    requirements = null;
    config = { sandbox_mode: { malformed: true } };
    await expect(service.permissions(dir, chat.id, "full")).rejects.toThrow("Custom or managed");
    config = {};
    await expect(service.permissions(dir, chat.id, "invalid")).rejects.toThrow("Unsupported");
    await expect(service.permissions(dir, chat.id, "")).rejects.toThrow("Unsupported");
    expect((await service.permissions(dir, chat.id)).choice).toBe("full");
    await service.permissions(dir, chat.id, "supervised");
    expect((await new ChatService(new Chats(join(dir, "chats")), connect as never).permissions(dir, chat.id)).choice).toBe("supervised");
  } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("saved policy conflict keeps history accessible and blocks Send until explicitly resolved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-policy-resume-"));
  const store = new Chats(join(dir, "chats"));
  let turns = 0;
  const connect = async () => ({ request: async (method: string) => {
    if (method === "config/read") return { config: {} };
    if (method === "configRequirements/read") return { requirements: null };
    if (method === "account/read") return { account: {} };
    if (method === "thread/resume") return { thread: { id: "original" }, cwd: dir, model: "a", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false } };
    if (method === "thread/turns/list") return { data: [{ id: "old-turn", items: [{ id: "old-message", type: "agentMessage", text: "retained history" }] }], nextCursor: null };
    if (method === "turn/start") { turns++; return { turn: { id: "new-turn" } }; }
    return {};
  }, close() {} });
  try {
    const chat = await store.create(dir);
    await store.update(dir, chat.id, { threadId: "original", hasSent: true, nextPermission: "full" });
    await store.draft(dir, chat.id, "retained draft");
    const service = new ChatService(store, connect as never);
    await service.open(dir, chat.id);
    expect(service.snapshot(dir, chat.id).items).toEqual(expect.arrayContaining([expect.objectContaining({ text: "retained history" })]));
    expect((await service.permissions(dir, chat.id)).message).toContain("Supervised");
    await expect(service.send(dir, chat.id, "retained draft")).rejects.toThrow("permission policy");
    expect(turns).toBe(0);
    expect(await store.get(dir, chat.id)).toMatchObject({ threadId: "original", draft: "retained draft", nextPermission: "full" });
    await service.permissions(dir, chat.id, "supervised");
    await service.send(dir, chat.id, "retained draft");
    expect(turns).toBe(1);
  } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});
