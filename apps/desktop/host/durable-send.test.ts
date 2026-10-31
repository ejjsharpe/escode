import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, readFile, copyFile, appendFile } from "node:fs/promises";
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

test("authenticated dropped socket response recovers status after reconnect without dispatch", async () => {
  const { startHost } = await import("@escode/host");
  const { createHostClient } = await import("@escode/client-runtime");
  const { default: WebSocket } = await import("ws");
  const original = globalThis.WebSocket;
  let dropped = false;
  globalThis.WebSocket = class extends WebSocket {
    constructor(url: string) {
      super(url, { origin: "null" });
    }
    override emit(event: string | symbol, ...args: any[]): boolean {
      if (event === "message" && !dropped && String(args[0]).includes('"accepted"')) {
        dropped = true;
        this.terminate();
        return true;
      }
      return super.emit(event, ...args);
    }
  } as unknown as typeof globalThis.WebSocket;
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
      await expect(client.sendMessage(command)).rejects.toThrow();
      expect(dropped).toBe(true);
      await client.close();
      client = createHostClient(async () => host.bootstrap());
      expect((await client.sendStatus("one"))?.status).toBe("accepted");
      await client.sendMessage(command);
      expect(turns).toBe(1);
    } finally { await client.close(); await host.close(); }
  } finally { globalThis.WebSocket = original; service.close(); await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("SIGKILL after an authenticated provider effect recovers uncertainty without another effect", async () => {
  const { spawn } = await import("node:child_process");
  const { build } = await import("esbuild");
  const { startHost } = await import("@escode/host");
  const { createHostClient } = await import("@escode/client-runtime");
  const { default: WebSocket } = await import("ws");
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
  const dir = await mkdtemp(join(tmpdir(), "escode-send-crash-"));
  const path = join(dir, "db");
  const effects = join(dir, "provider-effects");
  const script = `(async () => {
    const { Chats } = await import("./chat");
    const { ChatService } = await import("./chat-service");
    const { DurableSend } = await import("./durable-send");
    const { startHost } = await import("@escode/host");
    const { createHostClient } = await import("@escode/client-runtime");
    const { default: WebSocket } = await import("ws");
    const { appendFile } = await import("node:fs/promises");
    globalThis.WebSocket = class extends WebSocket { constructor(url) { super(url, {origin:"null"}); } };
    const store = new Chats(${JSON.stringify(path)});
    const db = store.database;
    let command;
    const service = new ChatService(store, async () => ({
      async request(method, params) {
        if (method === 'account/read') return {account:{type:'chatgpt'}};
        if (method === 'thread/start' || method === 'thread/resume') return {
          thread:{id:params.threadId ?? 'provider'},cwd:${JSON.stringify(dir)},model:'fixture',
          reasoningEffort:'high',approvalPolicy:'on-request',sandbox:{type:'workspaceWrite'}};
        if (method === 'turn/start') {
          await appendFile(${JSON.stringify(effects)}, 'turn\\n');
          console.log(JSON.stringify(command));
          await new Promise(()=>{});
        }
        return {};
      }, respond(){}, close(){}
    }));
    const chat = await store.create(${JSON.stringify(dir)});
    await service.open(${JSON.stringify(dir)}, chat.id);
    const sends = new DurableSend(db);
    command = {commandId:'crash',admissionEpoch:sends.admissionEpoch,project:${JSON.stringify(dir)},id:chat.id,expected:'state',text:'retained'};
    const host = await startHost({...await db.ready,origin:'null',list:async()=>({kind:'denied',message:'unused'}),
      sendMessage: command => sends.execute(command, async () => {
        await service.send(command.project,command.id,command.text);
      }), sendStatus: id => sends.receipt(id)});
    const client = createHostClient(async()=>host.bootstrap());
    await client.sendMessage(command);
  })().catch(error=>{console.error(error);process.exit(1)});`;
  let child: ReturnType<typeof spawn> | undefined;
  let db: DurableState | undefined;
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let client: ReturnType<typeof createHostClient> | undefined;
  try {
    await build({ stdin: { contents: script, resolveDir: import.meta.dirname }, bundle: true,
      platform: "node", format: "cjs", outfile: join(dir, "fixture.cjs"), logLevel: "silent" });
    await copyFile(join(import.meta.dirname, "sqlite-worker.cjs"), join(dir, "sqlite-worker.cjs"));
    child = spawn(process.execPath, [join(dir, "fixture.cjs")], { stdio: ["ignore", "pipe", "pipe"] });
    const command = await new Promise<any>((resolve, reject) => {
      let output = "", errors = "";
      child!.stdout!.on("data", data => { output += data; if (output.includes("\n")) resolve(JSON.parse(output.trim())); });
      child!.stderr!.on("data", data => { errors += data; });
      child!.on("exit", () => reject(Error(errors)));
    });
    const exited = new Promise(resolve => child!.once("exit", resolve));
    child.kill("SIGKILL"); await exited;
    expect(await readFile(effects, "utf8")).toBe("turn\n");
    db = new DurableState(path + ".sqlite-state-v1");
    const sends = new DurableSend(db);
    host = await startHost({ ...await db.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
      sendMessage: command => sends.execute(command, async () => { await appendFile(effects, "duplicate\n"); }),
      sendStatus: id => sends.receipt(id) });
    client = createHostClient(async () => host!.bootstrap());
    expect((await client.sendStatus("crash"))?.status).toBe("uncertain");
    expect((await client.sendMessage(command)).status).toBe("uncertain");
    await expect(client.sendMessage({ ...command, commandId: "stale" })).rejects.toThrow();
    expect(await readFile(effects, "utf8")).toBe("turn\n");
  } finally {
    child?.kill("SIGKILL"); await client?.close(); await host?.close(); await db?.close();
    globalThis.WebSocket = original; await rm(dir, { recursive: true, force: true });
  }
});

test("independent authenticated clients preserve newer composer revisions while submissions complete", async () => {
  const { startHost } = await import("@escode/host");
  const { createHostClient, createChatClient } = await import("@escode/client-runtime");
  const { default: WebSocket } = await import("ws");
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
  const dir = await mkdtemp(join(tmpdir(), "escode-send-clients-"));
  const db = new DurableState(join(dir, "db"));
  const releases = new Map<string, () => void>();
  let turns = 0;
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  const transports: ReturnType<typeof createHostClient>[] = [];
  try {
    await db.write([{ id: "chat", project: null, checkout: dir, draft: "", threadId: "provider" }], 0);
    const sends = new DurableSend(db);
    host = await startHost({ ...await db.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
      sendState: async () => ({ admissionEpoch: sends.admissionEpoch, expected: "state" }),
      sendMessage: command => sends.execute(command, async () => {
        turns++;
        await new Promise<void>(resolve => releases.set(command.text, resolve));
      }), sendStatus: id => sends.receipt(id) });
    const clients = [0, 1].map(() => {
      const transport = createHostClient(async () => host!.bootstrap());
      transports.push(transport);
      const values = new Map<string, string>();
      const adapter = { storage: { getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); } },
        flush: async () => {}, confirmResolve: async () => false };
      return { client: createChatClient(transport, adapter), adapter, values, transport };
    });
    const first = clients[0].client.send(null, "chat", "first");
    const second = clients[1].client.send(null, "chat", "second");
    await expect.poll(() => releases.size).toBe(2);
    const pendingKey = 'escode-send:[null,"chat"]';
    const identities = clients.map(({ values }) => JSON.parse(values.get(pendingKey)!));
    expect(identities[0].commandId).not.toBe(identities[1].commandId);
    await clients[0].client.draft("chat", "edited");
    await clients[0].client.draft("chat", "first");
    await clients[1].client.draft("chat", "second newer");
    expect(createChatClient(clients[0].transport, clients[0].adapter).composer(null, "chat")).toBe("first");
    expect(createChatClient(clients[1].transport, clients[1].adapter).composer(null, "chat")).toBe("second newer");
    releases.get("first")!();
    await expect.poll(async () => (await clients[0].transport.sendStatus(identities[0].commandId))?.status).toBe("accepted");
    expect(clients[1].values.has(pendingKey)).toBe(true);
    releases.get("second")!();
    expect(await Promise.all([first, second])).toEqual(["first", "second newer"]);
    expect(createChatClient(clients[0].transport, clients[0].adapter).composer(null, "chat")).toBe("first");
    expect(createChatClient(clients[1].transport, clients[1].adapter).composer(null, "chat")).toBe("second newer");
    expect(turns).toBe(2);
  } finally {
    releases.forEach(resolve => resolve());
    await Promise.all(transports.map(client => client.close()));
    await host?.close(); await db.close(); globalThis.WebSocket = original;
    await rm(dir, { recursive: true, force: true });
  }
});

test("complete worker loss fails admission closed but permits captured emergency Stop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-worker-stop-"));
  const db = new DurableState(join(dir, "db"));
  try {
    await db.ready;
    const sends = new DurableSend(db);
    await db.close();
    let effects = 0;
    const command = { commandId: "stop", admissionEpoch: sends.admissionEpoch, project: null, id: "chat", expected: "state", text: "", control: { operation: "stop" as const, target: "captured-turn", token: "token", answer: "" } };
    await expect(sends.execute(command, async () => { effects++; })).rejects.toThrow("Emergency Stop");
    expect(effects).toBe(0);
    expect((await sends.execute({ ...command, control: { ...command.control, emergency: true } }, async () => { effects++; })).status).toBe("uncertain");
    expect(effects).toBe(1);
    await expect(sends.execute({ ...command, commandId: "send", control: undefined }, async () => { effects++; })).rejects.toThrow("worker");
    expect(effects).toBe(1);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});
