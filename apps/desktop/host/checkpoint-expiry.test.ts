import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, writeFile, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { execFileSync } from "node:child_process";
import { startHost } from "@escode/host";
import { createHostClient } from "@escode/client-runtime";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";

test("authenticated polling expires inactive file coverage without deleting conversation or reviving files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-expiry-"));
  execFileSync("git", ["init", dir]);
  await writeFile(join(dir, "saved.txt"), "retained saved file");
  execFileSync("git", ["-C", dir, "add", "saved.txt"]);
  const index = await readFile(join(dir, ".git/index"));
  const store = new Chats(join(dir, "state"));
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as any;
  let now = 1;
  const service = new ChatService(store, async () => { throw Error("No provider effects expected"); }, undefined, undefined, undefined, () => now);
  const chat = await store.createDraft(null, dir);
  const host = await startHost({ ...await store.database.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }), checkpointPoints: (...args) => service.checkpointPoints(...args), openChat: (...args) => service.open(...args) });
  const client = createHostClient(async () => host.bootstrap());
  try {
    await store.database.command("checkpoint", { body: { id: "point", chatId: chat.id, kind: "before-message", createdAt: 1, availability: "available", files: { "saved.txt": { mode: 33188, content: "YQ==" } } } });
    now = 29 * 86400000;
    expect((await client.checkpointPoints(null, chat.id, null)).points[0].availability).toBe("available");
    await client.openChat(null, chat.id);
    now = 31 * 86400000;
    expect((await client.checkpointPoints(null, chat.id, null)).points[0].availability).toBe("available");
    now = 60 * 86400000;
    expect((await client.checkpointPoints(null, chat.id, null)).points[0]).toMatchObject({ availability: "unavailable", reason: "File checkpoint expired after 30 days of chat inactivity" });
    expect((await store.get(null, chat.id)).id).toBe(chat.id);
    expect(await readFile(join(dir, "saved.txt"), "utf8")).toBe("retained saved file");
    expect(await readFile(join(dir, ".git/index"))).toEqual(index);
    await client.openChat(null, chat.id);
    expect((await client.checkpointPoints(null, chat.id, null)).points[0].availability).toBe("unavailable");
  } finally { await client.close(); await host.close(); service.close(); await store.database.close(); globalThis.WebSocket = original; await rm(dir, { recursive: true, force: true }); }
});

test("background expiry protects recovery, active and uncertain evidence and retained branch copies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-expiry-protection-"));
  const store = new Chats(join(dir, "state"));
  const service = new ChatService(store);
  try {
    const chat = await store.createDraft(null, dir);
    const point = { id: "protected", chatId: chat.id, kind: "before-message", createdAt: 1, availability: "available", files: { "a": { mode: 33188, content: "YQ==" } } };
    await store.database.command("checkpoint", { body: point });
    const expire = (active: string[] = []) => store.database.command("expireCheckpoints", { body: { now: 31 * 86400000, active } });
    await store.database.recoveryWrite("host", "approvals", [{ root: dir }], 0);
    expect(await expire([chat.id])).toBe(0);
    await store.database.recoveryWrite("client", "workspace", { drafts: [{ text: "unsaved" }] }, 0);
    expect(await expire()).toBe(0);
    await store.database.recoveryWrite("client", "workspace", { drafts: [] }, 1);
    await store.database.command("rewindWrite", { commandId: "branch", body: { checkpoint: point, result: { status: "uncertain" } } });
    expect(await expire()).toBe(0);
    await store.database.command("rewindWrite", { commandId: "branch", body: { checkpoint: point, result: { status: "applied" } } });
    expect(await expire()).toBe(1);
    expect((await store.database.command("rewindRead", { commandId: "branch" })).checkpoint.files.a.content).toBe("YQ==");
    expect((await store.database.command("inspectCheckpoint", { commandId: chat.id, body: { boundary: point.id } })).files).toBeUndefined();
    expect((await store.get(null, chat.id)).checkout).toBe(dir);
    await store.database.command("checkpoint", { body: { ...point, id: "failure-a" } });
    await store.database.command("checkpoint", { body: { ...point, id: "failure-b" } });
    const { DatabaseSync } = await import("node:sqlite");
    const fault = new DatabaseSync(join(dir, "state.sqlite-state-v1/state.sqlite"));
    try {
      fault.exec("CREATE TRIGGER fail_expiry BEFORE UPDATE ON checkpoints WHEN NEW.id='failure-b' BEGIN SELECT RAISE(ABORT,'cleanup full'); END");
      await expect(expire()).rejects.toThrow("cleanup full");
      expect((await store.database.command("inspectCheckpoint", { commandId: chat.id, body: { boundary: "failure-a" } })).availability).toBe("available");
      fault.exec("DROP TRIGGER fail_expiry");
    } finally { fault.close(); }
    const command = { commandId: "uncertain-send", id: chat.id, project: null, admissionEpoch: "test" };
    const admission = await store.database.command("admit", { command, epoch: "test", hostId: "host", clientId: "client" });
    expect(await expire()).toBe(0);
    await store.database.command("outcome", { receipt: { ...admission.receipt, status: "uncertain" } });
    expect(await expire()).toBe(0);
    await store.database.command("outcome", { receipt: { ...admission.receipt, status: "accepted" } });
    expect(await expire()).toBe(2);
    for (let n = 0; n < 101; n++) await store.database.command("checkpoint", { body: { ...point, id: `batch-${n}` } });
    expect(await expire()).toBe(100);
    expect(await expire()).toBe(1);
  } finally { service.close(); await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("authenticated messages and observed agent work reset inactivity independently of polling", async () => {
  const { DurableSend } = await import("./durable-send");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-expiry-activity-")));
  execFileSync("git", ["init", dir]);
  execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "base"]);
  const store = new Chats(join(dir, "state"));
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as any;
  const start = Date.now();
  let now = start, turns = 0;
  let notify: (message: any) => void = () => {};
  const service = new ChatService(store, async (_cwd, receive) => ({
    async request(method: string) {
      if (method === "account/read") return { account: { type: "chatgpt" } };
      if (method === "thread/start" || method === "thread/resume") { notify = receive; return { thread: { id: "provider" }, cwd: dir, model: "fixture", approvalPolicy: "on-request", sandbox: { type: "workspaceWrite" } }; }
      if (method === "turn/start") return { turn: { id: `turn-${++turns}` } };
      return {};
    }, respond() {}, close() {},
  }), undefined, undefined, undefined, () => now);
  const chat = await store.create(dir);
  const sends = new DurableSend(store.database);
  const host = await startHost({ ...await store.database.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
    checkpointPoints: (...args) => service.checkpointPoints(...args),
    openChat: (...args) => service.open(...args),
    sendMessage: command => sends.execute(command, async () => { await service.send(command.project, command.id, command.text, undefined, command.commandId); }) });
  const client = createHostClient(async () => host.bootstrap());
  const day = (n: number) => { now = start + n * 86400000; };
  const complete = () => notify({ method: "turn/completed", params: { threadId: "provider", turn: { id: `turn-${turns}`, status: "completed" } } });
  try {
    await store.database.command("checkpoint", { body: { id: "original", chatId: chat.id, kind: "before-message", createdAt: start, availability: "available", files: {} } });
    const send = (id: string) => client.sendMessage({ commandId: id, admissionEpoch: sends.admissionEpoch, project: dir, id: chat.id, expected: "fixture", text: "message" });
    await client.openChat(dir, chat.id);
    day(29); expect(await send("one")).toMatchObject({ status: "accepted", message: "" }); complete();
    await expect.poll(() => service.snapshot(dir, chat.id).busy).toBe(false);
    day(58);
    expect((await client.checkpointPoints(dir, chat.id, null)).points[0].availability).toBe("available");
    expect((await send("two")).status).toBe("accepted");
    day(87);
    notify({ method: "item/agentMessage/delta", params: { threadId: "provider", turnId: "turn-2", itemId: "answer", delta: "agent work" } });
    complete();
    await expect.poll(() => service.snapshot(dir, chat.id).busy).toBe(false);
    day(116);
    expect((await client.checkpointPoints(dir, chat.id, null)).points[0].availability).toBe("available");
    day(118);
    expect((await client.checkpointPoints(dir, chat.id, null)).points[0].availability).toBe("unavailable");
    expect(turns).toBe(2);
  } finally { await client.close(); await host.close(); service.close(); await store.database.close(); globalThis.WebSocket = original; await rm(dir, { recursive: true, force: true }); }
});
