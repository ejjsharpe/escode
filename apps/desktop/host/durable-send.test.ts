import { test, expect } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DurableState } from "./durable-state";
import { DurableSend } from "./durable-send";

test("SQLite Send retains immutable status and refuses changed or stale identities across reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-send-"));
  let db = new DurableState(join(dir, "db"));
  try {
    await db.write([{ id: "chat", project: "project", checkout: dir, draft: "", threadId: "provider" }], 0);
    let sends = new DurableSend(db);
    const command = { commandId: "one", admissionEpoch: sends.admissionEpoch, project: "project", id: "chat", expected: "state", text: "hello" };
    let turns = 0;
    expect((await sends.execute(command, async () => { turns++; })).status).toBe("accepted");
    expect((await sends.execute(command, async () => { turns++; })).status).toBe("accepted");
    await expect(sends.execute({ ...command, text: "changed" }, async () => { turns++; })).rejects.toThrow("conflict");
    await db.close();
    db = new DurableState(join(dir, "db"));
    sends = new DurableSend(db);
    expect((await sends.execute(command, async () => { turns++; })).status).toBe("accepted");
    await expect(sends.execute({ ...command, commandId: "missing" }, async () => { turns++; })).rejects.toThrow("epoch");
    expect(turns).toBe(1);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("failed admission dispatches nothing and failed outcome retains crash uncertainty", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = await mkdtemp(join(tmpdir(), "escode-send-fault-"));
  let db = new DurableState(join(dir, "db"));
  try {
    await db.write([{ id: "chat", project: null, checkout: dir, draft: "", threadId: "provider" }], 0);
    let sends = new DurableSend(db);
    const command = { commandId: "one", admissionEpoch: sends.admissionEpoch, project: null, id: "chat", expected: "state", text: "hello" };
    const fault = new DatabaseSync(join(dir, "db/state.sqlite"));
    fault.exec("CREATE TRIGGER fail_admission BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT, 'admission failure'); END");
    let turns = 0;
    await expect(sends.execute(command, async () => { turns++; })).rejects.toThrow("admission failure");
    expect(turns).toBe(0);
    fault.exec("DROP TRIGGER fail_admission; CREATE TRIGGER fail_outcome BEFORE UPDATE ON submissions WHEN json_extract(NEW.body, '$.status')='accepted' BEGIN SELECT RAISE(ABORT, 'outcome failure'); END");
    await expect(sends.execute(command, async () => { turns++; })).rejects.toThrow("outcome failure");
    fault.close();
    await db.close();
    db = new DurableState(join(dir, "db"));
    sends = new DurableSend(db);
    expect((await sends.execute(command, async () => { turns++; })).status).toBe("uncertain");
    expect(turns).toBe(1);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("authenticated lost response recovers status after reconnect without dispatch", async () => {
  const { startHost } = await import("@escode/host");
  const { createHostClient } = await import("@escode/client-runtime");
  const { default: WebSocket } = await import("ws");
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
  const dir = await mkdtemp(join(tmpdir(), "escode-send-auth-"));
  const { Chats } = await import("./chat");
  const { ChatService } = await import("./chat-service");
  const store = new Chats(join(dir, "chats"));
  const db = store.database;
  let turns = 0;
  const service = new ChatService(store, async () => ({
    async request(method: string, params: any) {
      if (method === "account/read") return { account: { type: "chatgpt" } };
      if (method === "thread/start" || method === "thread/resume") return { thread: { id: params.threadId ?? "provider" }, cwd: dir, model: "fixture", reasoningEffort: "high", approvalPolicy: "on-request", sandbox: { type: "workspaceWrite" } };
      if (method === "turn/start") { turns++; return { turn: { id: "turn" } }; }
      return {};
    }, respond() {}, close() {},
  }));
  try {
    const chat = await store.create(dir);
    await service.open(dir, chat.id);
    const sends = new DurableSend(db);
    const host = await startHost({ ...await db.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
      sendMessage: command => sends.execute(command, async () => { await service.send(command.project, command.id, command.text); }), sendStatus: id => sends.receipt(id) });
    let client = createHostClient(async () => host.bootstrap());
    const command = { commandId: "one", admissionEpoch: sends.admissionEpoch, project: dir, id: chat.id, expected: "state", text: "hello" };
    try {
      await client.sendMessage(command);
      await client.close();
      client = createHostClient(async () => host.bootstrap());
      expect((await client.sendStatus("one"))?.status).toBe("accepted");
      await client.sendMessage(command);
      expect(turns).toBe(1);
    } finally { await client.close(); await host.close(); }
  } finally { globalThis.WebSocket = original; service.close(); await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("SIGKILL after dispatch preserves uncertainty and never resumes a turn", async () => {
  const { spawn } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const dir = await mkdtemp(join(tmpdir(), "escode-send-crash-"));
  const path = join(dir, "db");
  const script = `const { DurableState } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, "durable-state.ts")).href)});
    const db = new DurableState(${JSON.stringify(path)});
    const identity = await db.ready;
    await db.write([{id:'chat',project:null,checkout:'',draft:'',threadId:'provider'}],0);
    const command = {commandId:'crash',admissionEpoch:'old',project:null,id:'chat',expected:'state',text:'retained'};
    const {receipt} = await db.command('admit',{command,epoch:'old',...identity});
    await db.command('outcome',{receipt:{...receipt,status:'dispatching'}});
    console.log('dispatched'); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  let db: DurableState | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "", errors = "";
      child.stdout.on("data", data => { output += data; if (output.includes("dispatched")) resolve(); });
      child.stderr.on("data", data => { errors += data; });
      child.on("exit", () => reject(Error(errors)));
    });
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGKILL"); await exited;
    db = new DurableState(path);
    const sends = new DurableSend(db);
    const recovered = await sends.receipt("crash");
    expect(recovered?.status).toBe("uncertain");
    let turns = 0;
    await sends.execute(recovered!.command, async () => { turns++; });
    expect(turns).toBe(0);
  } finally { child.kill("SIGKILL"); await db?.close(); await rm(dir, { recursive: true, force: true }); }
});
