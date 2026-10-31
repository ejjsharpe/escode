import { DurableState } from "./durable-state";
import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startHost } from "@escode/host";
import { createHostClient } from "@escode/client-runtime";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";

test("authenticated draft context and identities reopen atomically without importing old stores", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-sqlite-"));
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
  let store = new Chats(join(dir, "chats.json"));
  try {
    await writeFile(join(dir, "chats.json"), "old bytes");
    const identity = await store.database.ready;
    expect(identity.settings).toEqual({ journalMode: "wal", synchronous: 1, checkpointFullfsync: 1 });
    const service = new ChatService(store, async () => { throw Error("No provider allocation expected"); }, undefined, undefined, {
      guard: () => () => {}, authorize: async () => {}, currentTarget: async () => "", managedRoot: dir,
      checkout: async () => { throw Error("No checkout allocation expected"); },
    });
    const host = await startHost({ ...identity, origin: "null", list: async () => ({ kind: "denied", message: "unused" }), draftAction: action => service.draftAction(action), sendState: async (project, id) => ({ admissionEpoch: "epoch", expected: await service.expectation(project, id) }) });
    const client = createHostClient(async () => host.bootstrap());
    let id = "";
    try {
      const chat = await client.draftAction({ operation: "createDraft", project: null });
      id = chat.id;
      const state = await client.sendState(null, id);
      await client.draftAction({ operation: "context", project: null, id, expected: state.expected, target: null });
      await expect(client.draftAction({ operation: "context", project: null, id, expected: state.expected, target: null })).rejects.toThrow();
    } finally { await client.close(); await host.close(); service.close(); }
    await store.database.close();
    store = new Chats(join(dir, "chats.json"));
    expect(await store.database.ready).toMatchObject({ hostId: identity.hostId, clientId: identity.clientId });
    expect(await store.get(null, id)).toMatchObject({ id, project: null, checkout: "", phase: "draft", threadId: null });
    expect(await readFile(join(dir, "chats.json"), "utf8")).toBe("old bytes");
  } finally { globalThis.WebSocket = original; await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("failed transaction preserves every draft and revision across reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-sqlite-atomic-"));
  let store = new Chats(join(dir, "state"));
  try {
    const chat = await store.createDraft(null, "");
    const before = await store.database.read();
    const { DatabaseSync } = await import("node:sqlite");
    const fault = new DatabaseSync(join(dir, "state.sqlite-state-v1/state.sqlite"));
    fault.exec("CREATE TRIGGER reject_draft BEFORE INSERT ON chats WHEN NEW.id = 'rejected' BEGIN SELECT RAISE(ABORT, 'injected disk write failure'); END");
    fault.close();
    await expect(store.database.write([{ ...chat, draft: "changed" }, { ...chat, id: "rejected" }], before.revision)).rejects.toThrow("injected disk write failure");
    expect(await store.database.read()).toEqual(before);
    await store.database.close();
    store = new Chats(join(dir, "state"));
    expect(await store.database.read()).toEqual(before);
  } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});

for (const damage of ["directory", "missing", "corrupt", "unsupported", "identity", "malformed"] as const) {
  test(`established ${damage} storage is refused without replacement`, async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const dir = await mkdtemp(join(tmpdir(), "escode-sqlite-refuse-"));
    const path = join(dir, "state");
    let store = new Chats(path);
    try {
      await store.database.ready;
      await store.database.close();
      const file = path + ".sqlite-state-v1/state.sqlite";
      if (damage === "directory") await rm(path + ".sqlite-state-v1", { recursive: true });
      else if (damage === "missing") await rm(file);
      else if (damage === "corrupt") await writeFile(file, "corrupt bytes");
      else {
        const db = new DatabaseSync(file);
        if (damage === "unsupported") db.exec("PRAGMA user_version=99");
        if (damage === "identity") db.exec("DELETE FROM identity");
        if (damage === "malformed") db.exec("INSERT INTO chats VALUES ('bad', '{}')");
        db.close();
      }
      store = new Chats(path);
      await expect(store.database.ready).rejects.toThrow();
    } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
  });
}

test("acknowledged drafts survive abrupt process death without new identities", async () => {
  const { spawn } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const dir = await mkdtemp(join(tmpdir(), "escode-sqlite-crash-"));
  const path = join(dir, "state");
  const script = `const { DurableState } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, "durable-state.ts")).href)});
    const store = new DurableState(${JSON.stringify(path + ".sqlite-state-v1")});
    const identity = await store.ready;
    await store.write([{ id: 'crash-draft', project: null, checkout: '', draft: 'retained', threadId: null }], 0);
    console.log(JSON.stringify(identity)); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  let store: Chats | undefined;
  try {
    const identity = await new Promise<any>((resolve, reject) => {
      let output = "", errors = "";
      child.stderr.on("data", data => { errors += data; });
      child.stdout.on("data", data => { output += data; if (output.includes("\n")) resolve(JSON.parse(output.trim())); });
      child.on("error", reject);
      child.on("exit", () => reject(Error(errors || "Child exited before acknowledgement")));
    });
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
    store = new Chats(path);
    expect(await store.database.ready).toMatchObject({ hostId: identity.hostId, clientId: identity.clientId });
    expect(await store.get(null, "crash-draft")).toMatchObject({ draft: "retained" });
  } finally { child.kill("SIGKILL"); await store?.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("aggregate recovery admission preserves existing rows when owner capacity is exhausted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-owner-bound-"));
  const db = new DurableState(join(dir, "db"));
  try {
    for (let i = 0; i < 256; i++) await db.recoveryWrite("owner-" + i, "workspace", { text: "retained" }, 0);
    await expect(db.recoveryWrite("overflow", "workspace", {}, 0)).rejects.toThrow("capacity");
    expect((await db.recoveryRead("owner-0", "workspace")).body).toEqual({ text: "retained" });
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("aggregate payload capacity rejects growth without deleting protected recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-byte-bound-"));
  const db = new DurableState(join(dir, "db"));
  try {
    for (let i = 0; i < 4; i++) await db.recoveryWrite("owner-" + i, "workspace", { text: "x".repeat(15 * 1024 * 1024) }, 0);
    await expect(db.recoveryWrite("overflow", "workspace", { text: "x".repeat(5 * 1024 * 1024) }, 0)).rejects.toThrow("capacity");
    expect((await db.recoveryRead("overflow", "workspace")).revision).toBe(0);
    expect((await db.recoveryRead("owner-0", "workspace")).revision).toBe(1);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});
