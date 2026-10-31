import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, readFile, copyFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DurableState } from "./durable-state";
import { DurableSend } from "./durable-send";

for (const operation of ["answer", "input", "stop"] as const) test(`SIGKILL after authenticated ${operation} effect retains uncertainty without replay`, async () => {
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
    const { appendFileSync } = await import("node:fs");
    globalThis.WebSocket = class extends WebSocket { constructor(url) { super(url, {origin:"null"}); } };
    const store = new Chats(${JSON.stringify(path)});
    const db = store.database;
    let command; let notify;
    const service = new ChatService(store, async (_cwd, emit) => { notify = emit; return ({
      async request(method, params) {
        if (method === 'account/read') return {account:{type:'chatgpt'}};
        if (method === 'thread/start' || method === 'thread/resume') return {
          thread:{id:params.threadId ?? 'provider'},cwd:${JSON.stringify(dir)},model:'fixture',
          reasoningEffort:'high',approvalPolicy:'on-request',sandbox:{type:'workspaceWrite'}};
        if (method === 'turn/start') return {turn:{id:'turn'}};
        if (method === 'turn/interrupt') {
          appendFileSync(${JSON.stringify(effects)}, 'effect\\n');
          console.log(JSON.stringify(command));
          await new Promise(()=>{});
        }
        return {};
      }, respond(){
      appendFileSync(${JSON.stringify(effects)}, 'effect\\n');
      console.log(JSON.stringify(command));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
    }, close(){}
    }); });
    const chat = await store.create(${JSON.stringify(dir)});
    await service.open(${JSON.stringify(dir)}, chat.id);
    await service.send(${JSON.stringify(dir)}, chat.id, 'start');
    notify({id:77,method:${JSON.stringify(operation)} === 'input' ? 'item/tool/requestUserInput' : 'item/commandExecution/requestApproval',params:{threadId:'provider',turnId:'turn',itemId:'item',questions:[{id:'choice',header:'Choice',question:'Choose'}]}});
    const control = ${JSON.stringify(operation)} !== 'stop'
      ? {operation:'answer',target:'',token:service.snapshot(${JSON.stringify(dir)},chat.id).requests[0].token,answer:${JSON.stringify(operation)} === 'input' ? {choice:'first'} : 'accept'}
      : {operation:'stop',target:service.snapshot(${JSON.stringify(dir)},chat.id).controlTarget,token:'',answer:null};
    const sends = new DurableSend(db);
    command = {commandId:'crash',admissionEpoch:sends.admissionEpoch,project:${JSON.stringify(dir)},id:chat.id,expected:'',text:'',control};
    const host = await startHost({...await db.ready,origin:'null',list:async()=>({kind:'denied',message:'unused'}),
      sendMessage: command => sends.execute(command, async () => {
        if(command.control.operation==='stop') await service.stop(command.project,command.id,command.control.target);
        else await service.answer(command.project,command.id,command.control.token,command.control.answer);
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
    expect(await readFile(effects, "utf8")).toBe("effect\n");
    db = new DurableState(path + ".sqlite-state-v1");
    const sends = new DurableSend(db);
    host = await startHost({ ...await db.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
      sendMessage: command => sends.execute(command, async () => { await appendFile(effects, "duplicate\n"); }),
      sendStatus: id => sends.receipt(id) });
    client = createHostClient(async () => host!.bootstrap());
    expect((await client.sendStatus("crash"))?.status).toBe("uncertain");
    expect((await client.sendMessage(command)).status).toBe("uncertain");
    await expect(client.sendMessage({ ...command, commandId: "stale" })).rejects.toThrow();
    expect(await readFile(effects, "utf8")).toBe("effect\n");
  } finally {
    child?.kill("SIGKILL"); await client?.close(); await host?.close(); await db?.close();
    globalThis.WebSocket = original; await rm(dir, { recursive: true, force: true });
  }
});

for (const operation of ["answer", "input", "stop"] as const) test(`lost ${operation} response recovers without redispatch`, async () => {
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
  let turns = 0; let controls = 0; let notify!: (event: import("./tools").WireMessage) => void;
  const service = new ChatService(store, async (_cwd, emit) => { notify = emit; return ({
    async request(method: string, params: any) {
      if (method === "account/read") return { account: { type: "chatgpt" } };
      if (method === "thread/start" || method === "thread/resume") return { thread: { id: params.threadId ?? "provider" }, cwd: dir, model: "fixture", reasoningEffort: "high", approvalPolicy: "on-request", sandbox: { type: "workspaceWrite" } };
      if (method === "turn/start") { turns++; return { turn: { id: "turn" } }; }
      if (method === "turn/interrupt") controls++;
      return {};
    }, respond() { controls++; }, close() {},
  }); });
  try {
    const chat = await store.create(dir);
    await service.open(dir, chat.id);
    await service.send(dir, chat.id, "start");
    notify({id:77,method:operation === "input" ? "item/tool/requestUserInput" : "item/commandExecution/requestApproval",params:{threadId:"provider",turnId:"turn",itemId:"item",questions:[{id:"choice",header:"Choice",question:"Choose"}]}});
    const control = operation !== "stop"
      ? {operation: "answer" as const,target:"",token:service.snapshot(dir,chat.id).requests[0].token,answer:operation === "input" ? {choice:"first"} : "accept"}
      : {operation: "stop" as const,target:service.snapshot(dir,chat.id).controlTarget!,token:"",answer:null};
    const sends = new DurableSend(db);
    const host = await startHost({ ...await db.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
      sendMessage: command => sends.execute(command, async () => { if(command.control!.operation === "stop") await service.stop(command.project,command.id,command.control!.target); else await service.answer(command.project,command.id,command.control!.token,command.control!.answer); }), sendStatus: id => sends.receipt(id) });
    let client = createHostClient(async () => host.bootstrap());
    const command = { commandId: "one", admissionEpoch: sends.admissionEpoch, project: dir, id: chat.id, expected: "", text: "", control };
    try {
      await expect(client.sendMessage(command)).rejects.toThrow();
      expect(dropped).toBe(true);
      await client.close();
      client = createHostClient(async () => host.bootstrap());
      expect((await client.sendStatus("one"))?.status).toBe("accepted");
      await client.sendMessage(command);
      expect(turns).toBe(1);
      expect(controls).toBe(1);
    } finally { await client.close(); await host.close(); }
  } finally { globalThis.WebSocket = original; service.close(); await db.close(); await rm(dir, { recursive: true, force: true }); }
});
