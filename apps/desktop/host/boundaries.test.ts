import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { startHost } from "@escode/host";
import { createHostClient } from "@escode/client-runtime";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";

test("authenticated No project boundary pages separate missing history from saved files without provider mutations", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-boundaries-")));
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as any;
  const store = new Chats(join(dir, "state"));
  const calls: string[] = [];
  let lost = false, unsupported = false;
  const service = new ChatService(store, async () => ({ async request(method) {
    calls.push(method);
    if (unsupported) throw Error("Method not found");
    if (method !== "thread/turns/list") throw Error("Unexpected mutation");
    return { data: lost ? [] : [{ id: "turn", items: [{ id: "a", type: "agentMessage", text: "saved answer" }] }], nextCursor: null };
  }, respond() { throw Error("Unexpected response"); }, close() {} }));
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let client: ReturnType<typeof createHostClient> | undefined;
  try {
    const chat = await store.createDraft(null, dir);
    await store.prepareScratch(chat);
    await store.update(null, chat.id, { threadId: "provider", phase: "bound" });
    for (let n = 0; n < 23; n++) await store.database.command("checkpoint", { body: { id: `point-${n}`, chatId: chat.id, kind: "after-turn", createdAt: n, threadId: "provider", turnId: "turn", availability: "unavailable", reason: "No project file coverage" } });
    host = await startHost({ ...await store.database.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
      checkpointPoints: (...args) => service.checkpointPoints(...args), inspectBoundary: (...args) => service.inspectBoundary(...args) });
    client = createHostClient(async () => host!.bootstrap());
    const first = await client.checkpointPoints(null, chat.id, null);
    expect(first.points).toHaveLength(20);
    expect(calls).toEqual([]);
    expect((await client.checkpointPoints(null, chat.id, first.nextCursor)).points).toHaveLength(3);
    expect((await client.inspectBoundary(null, chat.id, "point-0", null)).page.items[0].text).toBe("saved answer");
    lost = true;
    expect(await client.inspectBoundary(null, chat.id, "point-0", null)).toMatchObject({ availability: "unavailable", page: { items: [] } });
    unsupported = true;
    expect((await client.inspectBoundary(null, chat.id, "point-0", null)).message).toContain("Method not found");
    await expect(client.checkpointPoints(dir, chat.id, null)).rejects.toThrow();
    expect(calls).toEqual(["thread/turns/list", "thread/turns/list", "thread/turns/list"]);
    expect((await store.get(null, chat.id)).threadId).toBe("provider");
  } finally { await client?.close(); await host?.close(); service.close(); await store.database.close(); globalThis.WebSocket = original; await rm(dir, { recursive: true, force: true }); }
});
