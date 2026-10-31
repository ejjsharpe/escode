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
    expect((await service.permissions(dir, chat.id)).choice).toBeNull();
    await service.permissions(dir, chat.id, "supervised");
    expect((await new ChatService(new Chats(join(dir, "chats")), connect as never).permissions(dir, chat.id)).choice).toBe("supervised");
  } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});
