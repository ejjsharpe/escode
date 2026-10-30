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
    await expect.poll(() => service.snapshot(root, chat.id).items[0]).toMatchObject({ text: "first page live" });
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

test("live output stays bounded on spool failure without cancelling provider work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-live-"));
  const store = new Chats(join(dir, "chats.json"));
  const chat = await store.createDraft(dir, dir);
  await store.update(dir, chat.id, { phase: "bound", threadId: "provider" });
  let emit = (_event: any) => {}, stopped = 0, closed = 0;
  const service = new ChatService(store, async (_cwd, receive) => {
    emit = receive;
    return { async request(method) {
      if (method === "account/read") return { account: {} };
      if (method === "thread/resume") return { thread: { id: "provider" }, cwd: dir, model: "fixture", sandbox: {}, approvalPolicy: "on-request" };
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      if (method === "turn/interrupt") { stopped++; return {}; }
      throw Error(method);
    }, respond() {}, close() { closed++; } };
  });
  try {
    await service.open(dir, chat.id);
    emit({ method: "turn/started", params: { threadId: "provider", turn: { id: "turn" } } });
    emit({ method: "item/agentMessage/delta", params: { threadId: "provider", turnId: "turn", itemId: "body", delta: "durable text" } });
    await expect.poll(() => service.snapshot(dir, chat.id).items[0]?.text).toBe("durable text");
    const before = service.snapshot(dir, chat.id);
    const recovered = new ChatService(store, async () => ({ async request(method) {
      if (method === "account/read") return { account: {} };
      if (method === "thread/resume") return { thread: { id: "provider" }, cwd: dir, model: "fixture", sandbox: {}, approvalPolicy: "on-request" };
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      throw Error(method);
    }, respond() {}, close() {} }));
    expect((await recovered.inspect(dir, chat.id)).items[0].text).toBe("durable text");
    await recovered.open(dir, chat.id).catch(() => {});
    // Recovery must remain available even while provider history has not caught up.
    expect((await recovered.inspect(dir, chat.id)).items[0].text).toBe("durable text");
    recovered.close();
    await rm(store.spoolDirectory, { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(store.spoolDirectory, "disk failure fixture");
    for (let n = 0; n < 20; n++) emit({ method: "item/agentMessage/delta", params: { threadId: "provider", turnId: "turn", itemId: "body", delta: "x".repeat(100000) } });
    const snapshot = service.snapshot(dir, chat.id);
    expect(snapshot.error).toMatch(/partial|unavailable/i);
    expect(snapshot).toMatchObject({ busy: true, threadId: "provider", turnId: "turn" });
    expect(JSON.stringify(snapshot).length).toBeLessThan(160000);
    expect(closed).toBe(0);
    expect(before.items[0].text).toBe("durable text");
    await service.stop(dir, chat.id);
    expect(stopped).toBe(1);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test("slow durable output coalesces ingress while Stop remains responsive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-slow-spool-"));
  const store = new Chats(join(dir, "chats.json"));
  const chat = await store.createDraft(dir, dir);
  await store.update(dir, chat.id, { phase: "bound", threadId: "provider" });
  let emit = (_event: any) => {}, writes = 0, stopped = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const service = new ChatService(store, async (_cwd, receive) => {
    emit = receive;
    return { async request(method) {
      if (method === "account/read") return { account: {} };
      if (method === "thread/resume") return { thread: { id: "provider" }, cwd: dir, model: "fixture", sandbox: {}, approvalPolicy: "on-request" };
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      if (method === "turn/interrupt") { stopped++; return {}; }
      throw Error(method);
    }, respond() {}, close() {} };
  }, { read: async () => undefined, write: async () => { writes++; await held; } });
  try {
    await service.open(dir, chat.id);
    emit({ method: "turn/started", params: { threadId: "provider", turn: { id: "turn" } } });
    for (let n = 0; n < 100; n++) emit({ method: "item/agentMessage/delta", params: { threadId: "provider", turnId: "turn", itemId: "body", delta: "x" } });
    expect(writes).toBe(1);
    expect(service.snapshot(dir, chat.id).items).toEqual([]);
    await Promise.race([service.stop(dir, chat.id), new Promise((_, reject) => setTimeout(() => reject(Error("Stop blocked by storage")), 500))]);
    expect(stopped).toBe(1);
    release();
    await expect.poll(() => service.snapshot(dir, chat.id).items[0]?.text).toBe("x".repeat(100));
    expect(writes).toBe(2);
  } finally { release(); await service.shutdown(); await rm(dir, { recursive: true, force: true }); }
});
