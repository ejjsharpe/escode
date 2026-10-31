import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, realpath, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import WebSocket from "ws";
import { startHost } from "@escode/host";
import { createHostClient } from "@escode/client-runtime";
import { Workspace, emptyWorkspace } from "./workspace";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";

test("authenticated No project inspection and explicit native rewind preserve current files and never replay", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-boundaries-")));
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as any;
  const store = new Chats(join(dir, "state"));
  const calls: string[] = [];
  let lost = false, unsupported = false, changed = false;
  let forkUnsupported = false;
  const forks: unknown[] = [];
  const service = new ChatService(store, async () => ({ async request(method, params) {
    calls.push(method);
    if (unsupported) throw Error("Method not found");
    if (method === "thread/fork") { if (forkUnsupported) throw Object.assign(Error("Method not found"), { rejected: true }); forks.push(params); return { thread: { id: "historical-provider" } }; }
    if (method !== "thread/turns/list") throw Error("Unexpected mutation");
    return { data: lost ? [] : [...(changed ? [{ id: "earlier", items: [] }] : []), { id: "turn", items: [{ id: "a", type: "agentMessage", text: "saved answer" }] }], nextCursor: null };
  }, respond() { throw Error("Unexpected response"); }, close() {} }));
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let client: ReturnType<typeof createHostClient> | undefined;
  try {
    const chat = await store.createDraft(null, dir);
    await store.prepareScratch(chat);
    await store.update(null, chat.id, { threadId: "provider", phase: "bound" });
    for (let n = 0; n < 23; n++) await store.database.command("checkpoint", { body: { id: `point-${n}`, chatId: chat.id, kind: "after-turn", createdAt: n, threadId: "provider", turnId: "turn", availability: "unavailable", reason: "No project file coverage" } });
    const workspace = new Workspace(join(dir, "workspace"), await store.database.ready, store.database);
    host = await startHost({ ...await store.database.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
      inspectFiles: (...args) => service.inspectFiles(...args),
      loadWorkspace: async () => ({ state: await workspace.read(), restored: [], errors: [] }),
      persistWorkspace: state => workspace.write(state),
      checkpointPoints: (...args) => service.checkpointPoints(...args), inspectBoundary: (...args) => service.inspectBoundary(...args), rewind: (...args) => service.rewind(...args) });
    client = createHostClient(async () => host!.bootstrap());
    expect((await client.inspectFiles(null, chat.id, "point-0", null, null)).message).toContain("No project file coverage");
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
    unsupported = false; lost = false;
    const cwd = (await store.get(null, chat.id)).checkout;
    execFileSync("git", ["init", cwd]);
    await writeFile(join(cwd, "saved.txt"), "staged version");
    execFileSync("git", ["-C", cwd, "add", "saved.txt"]);
    await writeFile(join(cwd, "saved.txt"), "current saved version");
    const recovery = emptyWorkspace();
    recovery.drafts = [{ root: cwd, path: "saved.txt", text: "unsaved client edit", disk: { text: "earlier baseline", version: "captured-baseline" } }];
    await client.persistWorkspace(recovery);
    const indexBytes = await readFile(join(cwd, ".git/index"));
    const stale = await client.rewind(null, chat.id, "point-0", null, null);
    changed = true;
    expect((await client.rewind(null, chat.id, "point-0", stale.token, "stale-command")).status).toBe("unavailable");
    expect(forks).toEqual([]);
    changed = false;
    const missing = await client.rewind(null, chat.id, "point-0", null, null);
    lost = true;
    expect((await client.rewind(null, chat.id, "point-0", missing.token, "lost-command")).status).toBe("unavailable");
    lost = false;
    const notSupported = await client.rewind(null, chat.id, "point-0", null, null);
    forkUnsupported = true;
    expect((await client.rewind(null, chat.id, "point-0", notSupported.token, "unsupported-command")).status).toBe("unavailable");
    forkUnsupported = false;
    await store.database.command("checkpoint", { body: { id: "before-first", chatId: chat.id, kind: "before-message", createdAt: 100, threadId: "provider", turnId: "turn", availability: "unavailable" } });
    expect((await client.rewind(null, chat.id, "before-first", null, null)).status).toBe("unavailable");
    const admission = await client.rewind(null, chat.id, "point-0", null, null);
    const originalCommand = store.database.command.bind(store.database);
    store.database.command = async (operation, fields) => {
      if (operation === "rewindWrite") throw Error("Intent storage unavailable");
      return originalCommand(operation, fields);
    };
    expect((await client.rewind(null, chat.id, "point-0", admission.token, "no-intent-command")).status).toBe("unavailable");
    expect(forks).toEqual([]);
    store.database.command = originalCommand;
    const selected = await client.rewind(null, chat.id, "point-0", null, null);
    expect(selected.status).toBe("ready");
    const applied = await client.rewind(null, chat.id, "point-0", selected.token, "rewind-command");
    expect(applied.status).toBe("applied");
    expect((await client.loadWorkspace()).state).toEqual(recovery);
    expect(forks).toEqual([{ threadId: "provider", lastTurnId: "turn" }]);
    expect(await readFile(join(cwd, "saved.txt"), "utf8")).toBe("current saved version");
    expect(await readFile(join(cwd, ".git/index"))).toEqual(indexBytes);
    expect((await store.get(null, chat.id)).threadId).toBe("historical-provider");
    expect(await client.rewind(null, chat.id, "point-0", selected.token, "rewind-command")).toEqual(applied);
    expect(calls.filter(m => m === "thread/fork")).toHaveLength(2);
    expect(calls.filter(m => m === "turn/start")).toHaveLength(0);
    await store.update(null, chat.id, { threadId: "provider" });
    const pending = await client.rewind(null, chat.id, "point-0", null, null);
    const command = store.database.command.bind(store.database);
    let writes = 0;
    store.database.command = async (operation, fields: any) => {
      if (operation === "rewindWrite" && ++writes === 3) throw Error("Disk full after provider effect");
      return command(operation, fields);
    };
    expect((await client.rewind(null, chat.id, "point-0", pending.token, "uncertain-command")).status).toBe("uncertain");
    store.database.command = command;
    const recoveredStore = new Chats(join(dir, "state"));
    const reopened = new ChatService(recoveredStore, async () => { throw Error("Must never replay"); });
    expect((await reopened.rewind(null, chat.id, "point-0", pending.token, "uncertain-command")).status).toBe("uncertain");
    expect(forks).toHaveLength(2);
    await expect(client.rewind(null, chat.id, "point-1", pending.token, "uncertain-command")).rejects.toThrow();
    reopened.close();
    await recoveredStore.database.close();
  } finally { await client?.close(); await host?.close(); service.close(); await store.database.close(); globalThis.WebSocket = original; await rm(dir, { recursive: true, force: true }); }
});
