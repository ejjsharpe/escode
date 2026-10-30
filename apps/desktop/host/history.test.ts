import { test, expect } from "vite-plus/test";
import { mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";

test("saved history pages preserve binding without Git, immutable revisions and unavailable context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-history-"));
  const root = join(dir, "checkout");
  await mkdir(root);
  const store = new Chats(join(dir, "host-chats-v1.json"));
  const chat = await store.createDraft(root, root);
  await store.update(root, chat.id, { phase: "bound", threadId: "exact-provider" });
  const calls: { method: string; params: any }[] = [];
  let body: unknown = { data: [{ id: "t2", items: [{ id: "a", type: "future-safe-kind", payload: "safe unknown" }] }], nextCursor: null };
  let emit = (_event: any) => {};
  const service = new ChatService(store, async (_cwd, receive) => {
    emit = receive;
    return {
    async request(method, params: any) {
      calls.push({ method, params });
      if (method === "account/read") return { account: {} };
      if (method === "thread/resume") return { thread: { id: "exact-provider" }, cwd: root, model: "fixture", sandbox: {}, approvalPolicy: "on-request" };
      if (method === "thread/turns/list") return params.cursor === null
        ? { data: [{ id: "t1", items: [{ id: "a", type: "agentMessage", text: "first page" }] }], nextCursor: "second" }
        : body;
      throw Error("Unexpected command");
    }, respond() {}, close() {},
  }; });
  try {
    const initial = await service.open(root, chat.id);
    expect(initial.items.map(i => i.text)).toEqual(["first page"]);
    expect(calls.filter(c => c.method === "thread/turns/list")).toHaveLength(1);
    const second = await service.history(root, chat.id, "second");
    expect(second.items[0].text).toContain("safe unknown");
    expect(second.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(await service.history(root, chat.id, "second")).toEqual(second);
    body = { data: [{ id: "t2", items: [{ id: "a", type: "agentMessage", text: "changed" }] }], nextCursor: null };
    expect((await service.history(root, chat.id, "second")).revision).not.toBe(second.revision);
    expect(second.items[0].text).toContain("safe unknown");
    emit({ method: "turn/started", params: { threadId: "exact-provider", turn: { id: "t1" } } });
    emit({ method: "item/agentMessage/delta", params: { threadId: "exact-provider", turnId: "t1", itemId: "a", delta: " live" } });
    expect(service.snapshot(root, chat.id).items[0]).toMatchObject({ text: "first page live" });
    expect(service.snapshot(root, chat.id).items[0].revision).toBeUndefined();
    expect(initial.items[0].text).toBe("first page");
    emit({ method: "turn/completed", params: { threadId: "exact-provider", turn: { id: "t1" } } });
    for (const malformed of [{ data: {}, nextCursor: null }, { data: [], nextCursor: "second" },
      { data: [{ id: "t", items: [{ id: "a", type: "agentMessage", text: "x".repeat(131073) }] }], nextCursor: null }]) {
      body = malformed;
      await expect(service.history(root, chat.id, "second")).rejects.toThrow(/history|History/);
    }
    await rename(root, root + "-away");
    const count = calls.length;
    await expect(service.history(root, chat.id, "second")).rejects.toThrow(/unavailable/);
    expect(calls).toHaveLength(count);
    expect(await store.get(root, chat.id)).toMatchObject({ checkout: root, threadId: "exact-provider", phase: "bound" });
    expect(calls.some(c => c.method === "thread/start" || c.method === "turn/start")).toBe(false);
    expect(calls.find(c => c.method === "thread/turns/list")?.params).toMatchObject({ threadId: "exact-provider", limit: 20 });
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});
