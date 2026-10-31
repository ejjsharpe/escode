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
  let forkUnsupported = false, lostResponse = false;
  const forks: unknown[] = [];
  const service = new ChatService(store, async () => ({ async request(method, params) {
    calls.push(method);
    if (unsupported) throw Error("Method not found");
    if (method === "thread/fork") { if (forkUnsupported) throw Object.assign(Error("Method not found"), { rejected: true }); forks.push(params); if (lostResponse) throw Error("Provider response lost after fork"); return { thread: { id: "historical-provider" } }; }
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
      branchHistory: (...args) => service.branchHistory(...args),
      inspectFiles: (...args) => service.inspectFiles(...args),
      loadWorkspace: async () => ({ state: await workspace.read(), restored: [], errors: [] }),
      persistWorkspace: state => workspace.write(state),
      checkpointPoints: (...args) => service.checkpointPoints(...args), inspectBoundary: (...args) => service.inspectBoundary(...args), rewind: (...args) => service.rewind(...args) });
    client = createHostClient(async () => host!.bootstrap());
    expect((await client.inspectFiles(null, chat.id, "point-0", null, null)).message).toContain("No project file coverage");
    expect((await client.branchHistory(null, chat.id, "point-0", null, null)).status).toBe("unavailable");
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
    await store.update(null, chat.id, { threadId: "provider" });
    const responseChoice = await client.rewind(null, chat.id, "point-0", null, null);
    lostResponse = true;
    expect((await client.rewind(null, chat.id, "point-0", responseChoice.token, "lost-response-command")).status).toBe("uncertain");
    expect((await client.rewind(null, chat.id, "point-0", responseChoice.token, "lost-response-command")).status).toBe("uncertain");
    expect(forks).toHaveLength(3);
    expect((await store.get(null, chat.id)).threadId).toBe("provider");
    reopened.close();
    await recoveredStore.database.close();
  } finally { await client?.close(); await host?.close(); service.close(); await store.database.close(); globalThis.WebSocket = original; await rm(dir, { recursive: true, force: true }); }
});

for (const failure of ["none", "provider-response", "outcome", "final-outcome", "allocation", "intent"] as const) test(`historical branch ${failure}`, async () => runHistoricalBranch(failure));

for (const failure of ["none", "provider-response", "outcome", "final-outcome", "allocation", "intent"] as const) test(`completion historical branch ${failure}`, async () => runHistoricalBranch(failure, true));

async function runHistoricalBranch(failure: string, completion = false) {
  const { Checkout } = await import("./project");
  const { captureTurnCheckpoint } = await import("./checkpoints");
  const { mkdir } = await import("node:fs/promises");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-branch-")));
  const root = join(dir, "repo"); await mkdir(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]).toString().trim();
  git("init", "-b", "main"); await writeFile(join(root, "saved"), "base"); await writeFile(join(root, "deleted\tfile"), "removed historically"); git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=t@t.test", "commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  const store = new Chats(join(dir, "state"));
  const chat = await store.createDraft(root, root);
  const info = await import("node:fs/promises").then(fs => fs.stat(root));
  await store.update(root, chat.id, { threadId: "source-provider", phase: "bound", directoryIdentity: { path: root, dev: info.dev, ino: info.ino } });
  await writeFile(join(root, "saved"), "staged"); git("add", ".");
  git("rm", "--", "deleted\tfile");
  await writeFile(join(root, "untracked"), "captured untracked");
  await writeFile(join(root, "saved"), "captured");
  await captureTurnCheckpoint(store.database, await store.get(root, chat.id), "source-provider", "capture");
  await store.database.command("checkpoint", { body: { id: "completion", chatId: chat.id, kind: "after-turn", commandId: "capture", turnId: "second", threadId: "source-provider", availability: "unavailable", createdAt: 1 } });
  const points = await store.database.command("checkpointPoints", { commandId: chat.id, body: {} });
  let boundary = points.points.find((p: any) => p.kind === "before-message").id;
  let selectedBase = base;
  if (completion) {
    await writeFile(join(root, "saved"), "completed files");
    git("add", "saved"); git("-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "completion base");
    selectedBase = git("rev-parse", "HEAD");
    await writeFile(join(root, "saved"), "completion captured");
    await store.database.command("checkpoint", { body: { id: "selected-completion", checkout: root, chatId: chat.id, kind: "after-turn", commandId: "capture", threadId: "source-provider", completion: "pending", availability: "unavailable", createdAt: 2 } });
    await captureTurnCheckpoint(store.database, await store.get(root, chat.id), "source-provider", "capture", { id: "selected-completion", turnId: "second", completion: "completed", createdAt: 2 });
    await writeFile(join(root, "saved"), "next before files");
    await captureTurnCheckpoint(store.database, await store.get(root, chat.id), "source-provider", "next-capture");
    git("add", "saved"); git("-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "later base");
    boundary = "selected-completion";
  }
  await writeFile(join(root, "saved"), "today"); const index = await readFile(join(root, ".git/index"));
  let missingHistory = false, unsupportedHistory = false;
  const calls: any[] = [];
  const opened: Awaited<ReturnType<typeof Checkout.open>>[] = [];
  const service = new ChatService(store, async () => ({ async request(method, params) {
    calls.push([method, params]);
    if (unsupportedHistory) throw Error("Method not found");
    if (method === "thread/turns/list") return { data: missingHistory ? [] : [{ id: "first" }, { id: "second" }], nextCursor: null };
    if (method === "thread/fork") { if (failure === "provider-response") throw Error("Lost provider response"); return { thread: { id: "branched-provider" } }; }
    throw Error("Unexpected turn");
  }, respond() {}, close() {} }), undefined, undefined, { guard: () => () => {}, authorize: async () => {}, currentTarget: async () => root, managedRoot: join(dir, "managed"), checkout: async path => { const c = await Checkout.open(path); opened.push(c); return c; } });
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as any;
  const workspace = new Workspace(join(dir, "workspace"), await store.database.ready, store.database);
  const host = await startHost({ ...await store.database.ready, origin: "null", loadWorkspace: async () => ({ state: await workspace.read(), restored: [], errors: [] }), persistWorkspace: state => workspace.write(state), list: async () => ({ kind: "denied", message: "unused" }), branchHistory: (...args) => service.branchHistory(...args) });
  const client = createHostClient(async () => host.bootstrap());
  try {
    const recovery = emptyWorkspace();
    recovery.drafts = [{ root, path: "saved", text: "unsaved client edit", disk: { text: "baseline", version: "baseline-version" } }];
    await client.persistWorkspace(recovery);
    const captured = await store.database.command("inspectCheckpoint", { commandId: chat.id, body: { boundary } });
    await store.database.command("checkpoint", { body: { ...captured, id: "missing-base", gitBase: "0".repeat(40) } });
    expect((await client.branchHistory(root, chat.id, "missing-base", null, null)).status).toBe("unavailable");
    await store.database.command("checkpoint", { body: { ...captured, id: "missing-files", availability: "unavailable", files: undefined } });
    expect((await client.branchHistory(root, chat.id, "missing-files", null, null)).status).toBe("unavailable");
    missingHistory = true;
    expect((await client.branchHistory(root, chat.id, boundary, null, null)).status).toBe("unavailable");
    missingHistory = false;
    unsupportedHistory = true;
    expect((await client.branchHistory(root, chat.id, boundary, null, null)).message).toContain("Method not found");
    unsupportedHistory = false;
    const invalid = await client.branchHistory(root, chat.id, "completion", null, null);
    expect(invalid.status).toBe("unavailable");
    if (completion) {
      await store.database.command("checkpoint", { body: { ...captured, id: "interrupted-completion", availability: "unavailable", files: undefined, completion: "interrupted", reason: "Turn interrupted; completion files unavailable" } });
      expect((await client.branchHistory(root, chat.id, "interrupted-completion", null, null)).message).toContain("interrupted");
    }
    const choice = await client.branchHistory(root, chat.id, boundary, null, null);
    expect(choice.status).toBe("ready");
    const command = store.database.command.bind(store.database);
    let writes = 0;
    store.database.command = async (operation, fields: any) => {
      if (operation === "rewindWrite" && ++writes === (failure === "intent" ? 1 : failure === "final-outcome" ? 5 : failure === "outcome" ? 4 : failure === "allocation" ? 3 : -1)) throw Error("Injected storage failure");
      return command(operation, fields);
    };
    const result = await client.branchHistory(root, chat.id, boundary, choice.token, "branch-command");
    store.database.command = command;
    if (failure === "intent") {
      expect(result.status).toBe("unavailable");
      expect(await store.list(root)).toHaveLength(1);
      expect(calls.filter(c => c[0] === "thread/fork")).toHaveLength(0);
      return;
    }
    if (failure !== "none") {
      expect(result.status).toBe("uncertain");
      const children = (await store.list(root)).filter(c => c.id !== chat.id);
      expect(children).toHaveLength(1);
      const child = children[0]; expect(child.worktree?.reservation?.root).toBe(child.checkout);
      expect(child.historicalPending).toBe(failure === "final-outcome" ? false : true);
      if (failure !== "final-outcome") await expect(service.send(root, child.id, "must not run")).rejects.toThrow("Historical preparation incomplete");
      const recovered = new Chats(join(dir, "state"));
      const restarted = new ChatService(recovered, async () => { throw Error("Must not replay"); });
      expect((await restarted.branchHistory(root, chat.id, boundary, choice.token, "branch-command")).status).toBe("uncertain");
      expect((await recovered.get(root, child.id)).checkout).toBe(child.checkout);
      restarted.close(); await recovered.database.close();
      expect(await readFile(join(root, "saved"), "utf8")).toBe("today");
      expect(await readFile(join(root, ".git/index"))).toEqual(index);
      return;
    }
    expect(result.status).toBe("applied");
    expect((await client.loadWorkspace()).state.drafts).toEqual(recovery.drafts);
    const fork = calls.find(c => c[0] === "thread/fork")[1];
    expect(fork.lastTurnId).toBe(completion ? "second" : "first"); expect(fork.threadId).toBe("source-provider");
    expect(await readFile(join(fork.cwd, "saved"), "utf8")).toBe(completion ? "completion captured" : "captured");
    expect(await readFile(join(fork.cwd, "untracked"), "utf8")).toBe("captured untracked");
    await expect(readFile(join(fork.cwd, "deleted\tfile"))).rejects.toThrow();
    expect(execFileSync("git", ["-C", fork.cwd, "rev-parse", "HEAD"]).toString().trim()).toBe(selectedBase);
    expect(execFileSync("git", ["-C", fork.cwd, "diff", "--cached"]).toString()).toBe("");
    expect(await readFile(join(root, "saved"), "utf8")).toBe("today"); expect(await readFile(join(root, ".git/index"))).toEqual(index);
    expect((await store.get(root, chat.id)).threadId).toBe("source-provider");
    expect(await client.branchHistory(root, chat.id, boundary, choice.token, "branch-command")).toEqual(result);
    expect(calls.filter(c => c[0] === "thread/fork")).toHaveLength(1);
    expect(calls.filter(c => c[0] === "turn/start")).toHaveLength(0);
    const children = (await store.list(root)).filter(c => c.id !== chat.id);
    expect(children).toHaveLength(1);
    expect(children[0].checkout).toBe(fork.cwd);
    expect(children[0].id).not.toBe(chat.id);
  } finally { await client.close(); await host.close(); service.close(); for (const c of opened) c.close(); await store.database.close(); globalThis.WebSocket = original; await rm(dir, { recursive: true, force: true }); }
}

test("SIGKILL during authenticated historical fork retains the exact reservation without replay", async () => {
  const { build } = await import("esbuild");
  const { spawn } = await import("node:child_process");
  const { mkdir, copyFile } = await import("node:fs/promises");
  const { Checkout } = await import("./project");
  const { captureTurnCheckpoint } = await import("./checkpoints");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-branch-crash-")));
  const root = join(dir, "repo"), state = join(dir, "state"); await mkdir(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]).toString().trim();
  git("init"); await writeFile(join(root, "saved"), "base"); git("add", ".");
  git("-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "base");
  const store = new Chats(state);
  const chat = await store.createDraft(root, root);
  const info = await import("node:fs/promises").then(fs => fs.stat(root));
  await store.update(root, chat.id, { threadId: "provider", phase: "bound", directoryIdentity: { path: root, dev: info.dev, ino: info.ino } });
  await captureTurnCheckpoint(store.database, await store.get(root, chat.id), "provider", "capture");
  await store.database.command("checkpoint", { body: { id: "completion", chatId: chat.id, kind: "after-turn", commandId: "capture", turnId: "second", threadId: "provider", availability: "unavailable", createdAt: 1 } });
  const points = await store.database.command("checkpointPoints", { commandId: chat.id, body: {} });
  const boundary = points.points.find((p: any) => p.kind === "before-message").id;
  await store.database.close();
  const script = `
import { Chats } from './chat'; import { ChatService } from './chat-service'; import { Checkout } from './project';
import { startHost } from '@escode/host'; import { createHostClient } from '@escode/client-runtime'; import WebSocket from 'ws';
(async()=>{
 globalThis.WebSocket=class extends WebSocket { constructor(url){super(url,{origin:'null'});} };
 const store=new Chats(${JSON.stringify(state)}); let choice;
 const service=new ChatService(store,async()=>({async request(method,params){
   if(method==='thread/turns/list')return {data:[{id:'first'},{id:'second'}],nextCursor:null};
   if(method==='thread/fork'){console.log(JSON.stringify({token:choice.token,cwd:params.cwd}));await new Promise(()=>{});}
   throw Error('Unexpected provider effect');},respond(){},close(){} }),undefined,undefined,
 {guard:()=>()=>{},authorize:async()=>{},currentTarget:async()=>${JSON.stringify(root)},managedRoot:${JSON.stringify(join(dir, "managed"))},checkout:path=>Checkout.open(path)});
 const host=await startHost({...await store.database.ready,origin:'null',list:async()=>({kind:'denied',message:'unused'}),branchHistory:(...args)=>service.branchHistory(...args)});
 const client=createHostClient(async()=>host.bootstrap());
 choice=await client.branchHistory(${JSON.stringify(root)},${JSON.stringify(chat.id)},${JSON.stringify(boundary)},null,null);
 await client.branchHistory(${JSON.stringify(root)},${JSON.stringify(chat.id)},${JSON.stringify(boundary)},choice.token,'crash-branch');
})().catch(e=>{console.error(e);process.exit(1)});`;
  await build({ stdin: { contents: script, resolveDir: import.meta.dirname }, bundle: true, platform: "node", format: "cjs", outfile: join(dir, "fixture.cjs"), logLevel: "silent" });
  await copyFile(join(import.meta.dirname, "sqlite-worker.cjs"), join(dir, "sqlite-worker.cjs"));
  const child = spawn(process.execPath, [join(dir, "fixture.cjs")], { stdio: ["ignore", "pipe", "pipe"] });
  let recovered: Chats | undefined;
  try {
    const effect = await new Promise<{ token: string; cwd: string }>((resolve, reject) => {
      let output = "", errors = "";
      const timeout = setTimeout(() => reject(Error("Historical fork fixture timed out: " + errors)), 15000);
      child.stderr.on("data", data => { errors += data; });
      child.stdout.on("data", data => { output += data; if (output.includes("\n")) { clearTimeout(timeout); resolve(JSON.parse(output.trim())); } });
      child.once("exit", code => { clearTimeout(timeout); reject(Error(`Fixture exited ${code}: ${errors}`)); });
    });
    const exited = new Promise(resolve => child.once("exit", resolve)); child.kill("SIGKILL"); await exited;
    recovered = new Chats(state);
    const service = new ChatService(recovered, async () => { throw Error("Must never replay"); });
    const host = await startHost({ ...await recovered.database.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }), branchHistory: (...args) => service.branchHistory(...args) });
    const original = globalThis.WebSocket;
    globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as any;
    const client = createHostClient(async () => host.bootstrap());
    try {
      expect((await client.branchHistory(root, chat.id, boundary, effect.token, "crash-branch")).status).toBe("uncertain");
      const branches = (await recovered.list(root)).filter(c => c.id !== chat.id);
      expect(branches).toHaveLength(1); expect(branches[0].checkout).toBe(effect.cwd);
      expect(branches[0].historicalPending).toBe(true);
      expect(await readFile(join(effect.cwd, "saved"), "utf8")).toBe("base");
      await expect(service.send(root, branches[0].id, "no replay")).rejects.toThrow("Historical preparation incomplete");
    } finally { await client.close(); await host.close(); service.close(); globalThis.WebSocket = original; }
  } finally { child.kill("SIGKILL"); await recovered?.database.close(); await rm(dir, { recursive: true, force: true }); }
});
