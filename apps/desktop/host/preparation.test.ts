import { test, expect } from "vite-plus/test";
import { mkdtemp, realpath, rm, readdir, readFile, copyFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";
import { startHost } from "@escode/host";
import { createHostClient } from "@escode/client-runtime";
import { DurableState } from "./durable-state";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
import { DurableSend } from "./durable-send";

for (const boundary of ["reservation", "allocation", "provider"] as const) {
  test(`authenticated first Send retains exact scratch reservation after SQLite ${boundary} failure`, async () => {
    const original = globalThis.WebSocket;
    globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
    const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-preparation-")));
    const file = join(dir, "chats");
    let store = new Chats(file);
    let starts = 0, turns = 0;
    const connector: ConstructorParameters<typeof ChatService>[1] = async cwd => ({
      async request(method: string, params: any) {
        if (method === "account/read") return { account: {} };
        if (method === "thread/start" || method === "thread/resume") {
          starts++;
          return { thread: { id: params.threadId ?? "retained-provider" }, cwd, model: "fixture", reasoningEffort: "high", approvalPolicy: "on-request", sandbox: { type: "workspaceWrite" } };
        }
        if (method === "thread/turns/list") return { data: [], nextCursor: null };
        if (method === "turn/start") { turns++; return { turn: { id: "turn" } }; }
        return {};
      }, respond() {}, close() {},
    });
    let service = new ChatService(store, connector);
    let host: Awaited<ReturnType<typeof startHost>> | undefined;
    let client: ReturnType<typeof createHostClient> | undefined;
    try {
      const chat = await store.createDraft(null, "");
      const fault = new DatabaseSync(join(file + ".sqlite-state-v1", "state.sqlite"));
      const condition = boundary === "reservation" ? "json_extract(NEW.body, '$.scratch.path') IS NOT NULL" : boundary === "allocation" ? "json_extract(NEW.body, '$.scratch.ino') IS NOT NULL" : "json_extract(NEW.body, '$.threadId') IS NOT NULL";
      fault.exec(`CREATE TRIGGER fail_preparation BEFORE INSERT ON chats WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'preparation disk failure'); END`);
      const sends = new DurableSend(store.database);
      host = await startHost({ ...await store.database.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
        sendMessage: command => sends.execute(command, async () => { await service.send(command.project, command.id, command.text); }), sendStatus: id => sends.receipt(id) });
      client = createHostClient(async () => host!.bootstrap());
      const command = { commandId: "prepare", admissionEpoch: sends.admissionEpoch, project: null, id: chat.id, expected: "state", text: "retained prompt" };
      await client.sendMessage(command);
      expect(turns).toBe(0);
      expect(starts).toBe(boundary === "provider" ? 1 : 0);
      await client.close(); await host.close(); client = undefined; host = undefined;
      service.close(); await store.database.close();
      fault.exec("DROP TRIGGER fail_preparation"); fault.close();
      store = new Chats(file);
      service = new ChatService(store, connector);
      const saved = await store.get(null, chat.id);
      if (boundary === "provider") expect(saved.threadId).toBe("retained-provider");
      expect(saved.draft).toBe("retained prompt");
      if (boundary === "reservation") {
        expect(saved.scratch).toBeUndefined();
        expect(await readdir(dir)).not.toContain("scratch");
      } else {
        expect(saved.checkout).toBe(join(dir, "scratch", chat.id));
        expect(saved.scratch?.path).toBe(saved.checkout);
        expect(await readdir(saved.checkout)).not.toContain(".git");
        await service.open(null, chat.id);
      }
      const recovered = new DurableSend(store.database);
      expect((await recovered.execute(command, async () => { turns++; })).status).toBe("uncertain");
      expect(turns).toBe(0);
      expect(starts).toBe(boundary === "provider" ? 2 : 0);
    } finally {
      await client?.close(); await host?.close(); service.close(); await store.database.close();
      globalThis.WebSocket = original; await rm(dir, { recursive: true, force: true });
    }
  });
}

for (const kind of ["scratch", "worktree"] as const) test(`SIGKILL after ${kind} first Send recovers uncertainty without another effect`, async () => {
  const { spawn } = await import("node:child_process");
  const { build } = await import("esbuild");
  const { startHost } = await import("@escode/host");
  const { createHostClient } = await import("@escode/client-runtime");
  const { default: WebSocket } = await import("ws");
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-send-crash-")));
  const path = join(dir, "db");
  const effects = join(dir, "provider-effects");
  const root = join(dir, "source");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]).toString().trim();
  let base = "";
  if (kind === "worktree") {
    await mkdir(root);
    git("init", "-b", "main");
    await writeFile(join(root, "tracked"), "committed");
    git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base");
    base = git("rev-parse", "HEAD");
    await writeFile(join(root, "tracked"), "source unsaved on disk");
  }
  const project = kind === "worktree" ? root : null;
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
    const { Checkout } = await import("./project");
    const source = ${JSON.stringify(project)} ? await Checkout.open(${JSON.stringify(root)}) : null;
    const service = new ChatService(store, async cwd => ({
      async request(method, params) {
        if (method === 'account/read') return {account:{type:'chatgpt'}};
        if (method === 'thread/start' || method === 'thread/resume') return {
          thread:{id:params.threadId ?? 'provider'},cwd,model:'fixture',
          reasoningEffort:'high',approvalPolicy:'on-request',sandbox:{type:'workspaceWrite'}};
        if (method === 'turn/start') {
          await appendFile(${JSON.stringify(effects)}, 'turn\\n');
          console.log(JSON.stringify(command));
          await new Promise(()=>{});
        }
        return {};
      }, respond(){}, close(){}
    }), undefined, undefined, source ? {
      guard: () => () => {}, authorize: async () => {}, currentTarget: async () => source.root,
      managedRoot: ${JSON.stringify(join(dir, "managed"))}, checkout: path => Checkout.open(path)
    } : undefined);
    const chat = await store.createDraft(${JSON.stringify(project)}, ${JSON.stringify(project ?? "")});
    if (source) await store.context(${JSON.stringify(project)}, chat.id, ${JSON.stringify(project)}, ${JSON.stringify(root)},
      {source:${JSON.stringify(root)},ref:'refs/heads/main',commit:${JSON.stringify(base)}});
    const sends = new DurableSend(db);
    command = {commandId:'crash',admissionEpoch:sends.admissionEpoch,project:${JSON.stringify(project)},id:chat.id,expected:'state',text:'retained'};
    const host = await startHost({...await db.ready,origin:'null',list:async()=>({kind:'denied',message:'unused'}),
      sendMessage: command => sends.execute(command, async () => {
        await service.send(command.project,command.id,command.text);
      }), sendStatus: id => sends.receipt(id)});
    const client = createHostClient(async()=>host.bootstrap());
    const result = await client.sendMessage(command);
    throw Error(JSON.stringify(result));
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
    const recoveredStore = new Chats(path);
    const saved = await recoveredStore.get(project, command.id);
    if (kind === "scratch") {
      expect(saved.checkout).toBe(join(dir, "scratch", command.id));
      expect(saved.scratch?.ino).toBeGreaterThan(0);
      expect(await readdir(saved.checkout)).not.toContain(".git");
    } else {
      expect(saved.worktree?.reservation?.root).toBe(saved.checkout);
      expect(saved.worktree?.reservation?.ino).toBeGreaterThan(0);
      expect(await readFile(join(saved.checkout, "tracked"), "utf8")).toBe("committed");
      expect(await readFile(join(root, "tracked"), "utf8")).toBe("source unsaved on disk");
      expect(git("rev-parse", "HEAD")).toBe(base);
    }
    expect(saved.threadId).toBe("provider");
    db = recoveredStore.database;
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
