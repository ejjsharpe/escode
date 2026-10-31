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
    expect((await client.rewind(null, chat.id, "point-0", null, null, true)).status).toBe("unavailable");
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

for (const failure of ["intent", "allocation", "outcome", "final-outcome"]) test(`summarized reservation ${failure}`, async () => runHistoricalBranch(failure, true, true));

test("explicit summarized branch preserves files without native fork or automatic turn", async () => runHistoricalBranch("none", true, true));

async function runHistoricalBranch(failure: string, completion = false, summarized = false) {
  const { Checkout } = await import("./project");
  const { captureTurnCheckpoint } = await import("./checkpoints");
  const { mkdir } = await import("node:fs/promises");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-branch-")));
  const root = join(dir, "repo"); await mkdir(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]).toString().trim();
  git("init", "-b", "main"); await writeFile(join(root, "saved"), "base"); await writeFile(join(root, "deleted\tfile"), "removed historically"); await writeFile(join(root, "foo"), "base file"); await mkdir(join(root, "bar")); await writeFile(join(root, "bar/child"), "base child"); git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=t@t.test", "commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  const store = new Chats(join(dir, "state"));
  const chat = await store.createDraft(root, root);
  const info = await import("node:fs/promises").then(fs => fs.stat(root));
  await store.update(root, chat.id, { threadId: "source-provider", phase: "bound", directoryIdentity: { path: root, dev: info.dev, ino: info.ino } });
  await writeFile(join(root, "saved"), "staged"); git("add", ".");
  git("rm", "--", "deleted\tfile");
  await rm(join(root, "foo")); await mkdir(join(root, "foo")); await writeFile(join(root, "foo/child"), "historical child");
  await rm(join(root, "bar"), { recursive: true }); await writeFile(join(root, "bar"), "historical file");
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
  let missingHistory = false, unsupportedHistory = false, changedSummary = false;
  const calls: any[] = [];
  const opened: Awaited<ReturnType<typeof Checkout.open>>[] = [];
  const service = new ChatService(store, async () => ({ async request(method, params) {
    calls.push([method, params]);
    if (unsupportedHistory) throw Error("Method not found");
    if (method === "thread/turns/list") return { data: missingHistory ? [] : [{ id: "first", items: [{ id: "a", type: "agentMessage", text: "Earlier answer" }] }, { id: "second", items: [{ id: "b", type: "agentMessage", text: changedSummary ? "Changed answer" : "Completed answer" }] }], nextCursor: null };
    if (method === "thread/fork") { if (summarized) throw Error("Native historical continuation unsupported"); if (failure === "provider-response") throw Error("Lost provider response"); return { thread: { id: "branched-provider" } }; }
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
    expect((await client.branchHistory(root, chat.id, "missing-base", null, null, summarized)).status).toBe("unavailable");
    await store.database.command("checkpoint", { body: { ...captured, id: "missing-files", availability: "unavailable", files: undefined } });
    expect((await client.branchHistory(root, chat.id, "missing-files", null, null, summarized)).status).toBe("unavailable");
    missingHistory = true;
    expect((await client.branchHistory(root, chat.id, boundary, null, null, summarized)).status).toBe("unavailable");
    missingHistory = false;
    unsupportedHistory = true;
    expect((await client.branchHistory(root, chat.id, boundary, null, null, summarized)).message).toContain("Method not found");
    unsupportedHistory = false;
    const invalid = await client.branchHistory(root, chat.id, "completion", null, null);
    expect(invalid.status).toBe("unavailable");
    if (completion) {
      await store.database.command("checkpoint", { body: { ...captured, id: "interrupted-completion", availability: "unavailable", files: undefined, completion: "interrupted", reason: "Turn interrupted; completion files unavailable" } });
      expect((await client.branchHistory(root, chat.id, "interrupted-completion", null, null)).message).toContain("interrupted");
    }
    const choice = await client.branchHistory(root, chat.id, boundary, null, null, summarized);
    expect(choice.status).toBe("ready");
    if (summarized) {
      changedSummary = true;
      expect((await client.branchHistory(root, chat.id, boundary, choice.token, "changed-summary", true)).status).toBe("unavailable");
      changedSummary = false;
    }
    const command = store.database.command.bind(store.database);
    let writes = 0;
    store.database.command = async (operation, fields: any) => {
      if (operation === "rewindWrite" && ++writes === (failure === "intent" ? 1 : failure === "final-outcome" ? 5 : failure === "outcome" ? 4 : failure === "allocation" ? 3 : -1)) throw Error("Injected storage failure");
      return command(operation, fields);
    };
    const result = await client.branchHistory(root, chat.id, boundary, choice.token, "branch-command", summarized);
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
      expect((await restarted.branchHistory(root, chat.id, boundary, choice.token, "branch-command", summarized)).status).toBe("uncertain");
      expect((await recovered.get(root, child.id)).checkout).toBe(child.checkout);
      restarted.close(); await recovered.database.close();
      expect(await readFile(join(root, "saved"), "utf8")).toBe("today");
      expect(await readFile(join(root, ".git/index"))).toEqual(index);
      return;
    }
    expect(result.status).toBe("applied");
    expect((await client.loadWorkspace()).state.drafts).toEqual(recovery.drafts);
    if (summarized) {
      const child = (await store.list(root)).find(c => c.id !== chat.id)!;
      expect(child.draft).toContain("Completed answer");
      expect(child.draft).toContain("not native historical provider context");
      expect(child.threadId).toBeNull();
      expect(await readFile(join(child.checkout, "saved"), "utf8")).toBe("completion captured");
      expect(calls.filter(c => c[0] === "thread/fork" || c[0] === "turn/start")).toHaveLength(0);
      expect(await readFile(join(root, "saved"), "utf8")).toBe("today");
      return;
    }
    const fork = calls.find(c => c[0] === "thread/fork")[1];
    expect(fork.lastTurnId).toBe(completion ? "second" : "first"); expect(fork.threadId).toBe("source-provider");
    expect(await readFile(join(fork.cwd, "saved"), "utf8")).toBe(completion ? "completion captured" : "captured");
    expect(await readFile(join(fork.cwd, "foo/child"), "utf8")).toBe("historical child");
    expect(await readFile(join(fork.cwd, "bar"), "utf8")).toBe("historical file");
    expect(await readFile(join(fork.cwd, "untracked"), "utf8")).toBe("captured untracked");
    await expect(readFile(join(fork.cwd, "deleted\tfile"))).rejects.toThrow();
    expect(execFileSync("git", ["-C", fork.cwd, "rev-parse", "HEAD"]).toString().trim()).toBe(selectedBase);
    expect(execFileSync("git", ["-C", fork.cwd, "diff", "--cached"]).toString()).toBe("");
    expect(await readFile(join(root, "saved"), "utf8")).toBe("today"); expect(await readFile(join(root, ".git/index"))).toEqual(index);
    expect((await store.get(root, chat.id)).threadId).toBe("source-provider");
    expect(await client.branchHistory(root, chat.id, boundary, choice.token, "branch-command", summarized)).toEqual(result);
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

test("authenticated restoration replaces saved files only in an exact isolated worktree", async () => {
  const { stat } = await import("node:fs/promises");
  const { captureTurnCheckpoint } = await import("./checkpoints");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-restore-")));
  const source = join(dir, "source"), root = join(dir, "isolated");
  const { mkdir } = await import("node:fs/promises"); await mkdir(source);
  const git = (...args: string[]) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" });
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.com");
  await writeFile(join(source, "a.txt"), "committed"); git("add", "."); git("commit", "-qm", "base");
  git("worktree", "add", "-qb", "isolated", root);
  const store = new Chats(join(dir, "state"));
  const identity = await stat(root);
  const chat = await store.createDraft(source, root);
  await store.update(source, chat.id, { threadId: "provider", phase: "bound", directoryIdentity: { path: root, dev: identity.dev, ino: identity.ino }, worktree: { ref: "isolated", commit: git("rev-parse", "HEAD").trim(), source, reservation: { root, branch: "isolated", commit: git("rev-parse", "HEAD").trim(), dev: identity.dev, ino: identity.ino } } });
  await mkdir(join(root, "to-directory", "nested"), { recursive: true }); await writeFile(join(root, "to-directory", "nested", "leaf"), "historical leaf");
  await writeFile(join(root, "to-file"), "historical file");
  await writeFile(join(root, "a.txt"), "captured"); await writeFile(join(root, "old.txt"), "captured untracked");
  await store.database.command("checkpoint", { body: { id: "restore-point", chatId: chat.id, kind: "after-turn", availability: "unavailable", completion: "pending", threadId: "provider", checkout: root, commandId: null } });
  await captureTurnCheckpoint(store.database, await store.get(source, chat.id), "provider", undefined, { id: "restore-point", turnId: "turn", completion: "completed", createdAt: Date.now() });
  await rm(join(root, "to-directory"), { recursive: true }); await writeFile(join(root, "to-directory"), "new file");
  await rm(join(root, "to-file")); await mkdir(join(root, "to-file")); await writeFile(join(root, "to-file", "leaf"), "new leaf");
  await writeFile(join(root, "a.txt"), "today"); await writeFile(join(root, "new.txt"), "new eligible");
  const index = await readFile(join(source, ".git", "worktrees", "isolated", "index"));
  const workspace = new Workspace(join(dir, "workspace"), await store.database.ready, store.database);
  let failFiles = false;
  let forks = 0;
  const service = new ChatService(store, async () => ({ async request(method) {
    if (method === "thread/turns/list") return { data: [{ id: "turn", items: [] }], nextCursor: null };
    if (method === "thread/fork") { forks++; if (failFiles) { await mkdir(join(root, "a.txt", "collision"), { recursive: true }); await writeFile(join(root, "a.txt", "collision", ".git"), "excluded"); } return { thread: { id: "historical" } }; }
    throw Error("Unexpected provider effect");
  }, respond() {}, close() {} }));
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as any;
  const host = await startHost({ ...await store.database.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }), rewind: (...args) => service.rewind(...args), loadWorkspace: async () => ({ state: await workspace.read(), restored: [], errors: [] }), persistWorkspace: state => workspace.write(state) });
  const client = createHostClient(async () => host.bootstrap());
  try {
    const recovery = emptyWorkspace();
    recovery.drafts = [{ root, path: "a.txt", text: "unsaved client text", disk: { text: "loaded baseline", version: "baseline-version" } }];
    await client.persistWorkspace(recovery);
    const captured = await store.database.command("inspectCheckpoint", { commandId: chat.id, body: { boundary: "restore-point" } });
    for (const [boundary, changes] of [["missing-base", { gitBase: "0".repeat(40) }], ["expired-files", { availability: "unavailable", files: null }]] as const) {
      await store.database.command("checkpoint", { body: { ...captured, ...changes, id: boundary } });
      expect((await client.rewind(source, chat.id, boundary, null, null, true)).status).toBe("unavailable");
    }
    const originalChat = await store.createDraft(source, source, true);
    const sourceIdentity = await stat(source);
    await store.update(source, originalChat.id, { threadId: "provider", directoryIdentity: { path: source, dev: sourceIdentity.dev, ino: sourceIdentity.ino } });
    await store.database.command("checkpoint", { body: { ...captured, id: "original-point", chatId: originalChat.id, checkout: source, directoryIdentity: { path: source, dev: sourceIdentity.dev, ino: sourceIdentity.ino } } });
    expect((await client.rewind(source, originalChat.id, "original-point", null, null, true)).message).toContain("original checkouts");
    await writeFile(join(source, ".git", "info", "exclude"), "to-file/protected\n");
    const { symlink } = await import("node:fs/promises");
    for (const collision of ["ignored", "symlink", "nested"]) {
      const protectedPath = join(root, "to-file", collision === "nested" ? ".git" : "protected");
      if (collision === "symlink") await symlink(join(source, "a.txt"), protectedPath);
      else await writeFile(protectedPath, "excluded bytes");
      expect((await client.rewind(source, chat.id, "restore-point", null, null, true)).status).toBe("unavailable");
      expect(await readFile(join(root, "to-file", "leaf"), "utf8")).toBe("new leaf");
      expect(forks).toBe(0);
      await rm(protectedPath);
    }
    const cancelled = await client.rewind(source, chat.id, "restore-point", null, null, true);
    expect(cancelled.status).toBe("ready");
    expect(await readFile(join(root, "to-file", "leaf"), "utf8")).toBe("new leaf");
    expect(forks).toBe(0);
    const savedChat = await store.get(source, chat.id);
    await store.update(source, chat.id, { worktree: undefined });
    expect((await client.rewind(source, chat.id, "restore-point", null, null, true)).status).toBe("ready");
    await store.update(source, chat.id, { worktree: savedChat.worktree });
    const stale = await client.rewind(source, chat.id, "restore-point", null, null, true);
    await writeFile(join(root, "changed-after-choice.txt"), "new file");
    expect((await client.rewind(source, chat.id, "restore-point", stale.token, "stale-files-command", true)).status).toBe("unavailable");
    expect(forks).toBe(0);
    await rm(join(root, "changed-after-choice.txt"));
    const choice = await client.rewind(source, chat.id, "restore-point", null, null, true);
    expect(choice.status, choice.message).toBe("ready"); expect(choice.message).toContain("untracked");
    const result = await client.rewind(source, chat.id, "restore-point", choice.token, "restore-command", true);
    expect(result.status).toBe("applied");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("captured");
    expect(await readFile(join(root, "to-directory", "nested", "leaf"), "utf8")).toBe("historical leaf");
    expect(await readFile(join(root, "to-file"), "utf8")).toBe("historical file");
    expect(await readFile(join(root, "old.txt"), "utf8")).toBe("captured untracked");
    await expect(readFile(join(root, "new.txt"))).rejects.toThrow();
    expect(await readFile(join(source, ".git", "worktrees", "isolated", "index"))).toEqual(index);
    expect(await readFile(join(source, "a.txt"), "utf8")).toBe("committed");
    expect(await client.rewind(source, chat.id, "restore-point", choice.token, "restore-command", true)).toEqual(result);
    expect(forks).toBe(1);
    expect((await client.loadWorkspace()).state.drafts).toEqual(recovery.drafts);
    await store.update(source, chat.id, { threadId: "provider" });
    const partial = await client.rewind(source, chat.id, "restore-point", null, null, true);
    await rm(join(root, "a.txt")); failFiles = true;
    expect((await client.rewind(source, chat.id, "restore-point", partial.token, "partial-command", true)).status).toBe("uncertain");
    const reopenedStore = new Chats(join(dir, "state"));
    const reopened = new ChatService(reopenedStore, async () => { throw Error("No replay"); });
    expect((await reopened.rewind(source, chat.id, "restore-point", partial.token, "partial-command", true)).status).toBe("uncertain");
    await reopenedStore.database.close();
    expect(forks).toBe(2);
    expect((await client.loadWorkspace()).state.drafts).toEqual(recovery.drafts);
    await store.update(source, chat.id, { threadId: "provider" });
    const other = await store.createDraft(source, root, true);
    expect(other.id).not.toBe(chat.id);
    expect((await client.rewind(source, chat.id, "restore-point", null, null, true)).message).toContain("shared");
    await store.update(source, other.id, { removed: true });
    await rm(join(root, "a.txt"), { recursive: true }); await writeFile(join(root, "a.txt"), "before crash");
    const { build } = await import("esbuild");
    const { spawn } = await import("node:child_process");
    const { copyFile } = await import("node:fs/promises");
    const script = `
      const { Chats } = require('./chat'); const { ChatService } = require('./chat-service');
      const { startHost } = require('@escode/host'); const { createHostClient } = require('@escode/client-runtime');
      const WebSocket = require('ws');
      globalThis.WebSocket = class extends WebSocket { constructor(url) { super(url,{origin:'null'}); } };
      (async()=>{
        const store = new Chats(${JSON.stringify(join(dir, "state"))});
        let token;
        const service = new ChatService(store, async()=>({async request(method){
          if(method==='thread/turns/list') return {data:[{id:'turn',items:[]}],nextCursor:null};
          if(method==='thread/fork'){ require('node:fs').appendFileSync(${JSON.stringify(join(dir, "effects"))}, 'fork'); console.log(token); await new Promise(()=>{}); }
          throw Error('Unexpected turn');
        },respond(){},close(){}}));
        const host = await startHost({...await store.database.ready,origin:'null',list:async()=>({kind:'denied',message:'unused'}),rewind:(...args)=>service.rewind(...args)});
        const client = createHostClient(async()=>host.bootstrap());
        const choice = await client.rewind(${JSON.stringify(source)},${JSON.stringify(chat.id)},'restore-point',null,null,true);
        if(choice.status!=='ready') throw Error(choice.message);
        token=choice.token;
        await client.rewind(${JSON.stringify(source)},${JSON.stringify(chat.id)},'restore-point',token,'crash-command',true);
      })().catch(e=>{console.error(e);process.exit(1)});
    `;
    await build({ stdin: { contents: script, resolveDir: import.meta.dirname }, bundle: true, platform: "node", format: "cjs", outfile: join(dir, "crash.cjs"), logLevel: "silent" });
    await copyFile(join(import.meta.dirname, "sqlite-worker.cjs"), join(dir, "sqlite-worker.cjs"));
    const child = spawn(process.execPath, [join(dir, "crash.cjs")], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      const token = await new Promise<string>((resolve, reject) => {
        let output = "", errors = "";
        child.stdout.on("data", chunk => { output += chunk; if (output.includes("\n")) resolve(output.trim()); });
        child.stderr.on("data", chunk => { errors += chunk; });
        child.on("exit", () => reject(Error(errors)));
      });
      const exit = new Promise(resolve => child.once("exit", resolve)); child.kill("SIGKILL"); await exit;
      const recoveryStore = new Chats(join(dir, "state"));
      try {
        const recoveryService = new ChatService(recoveryStore, async()=>{ throw Error("Crash recovery replayed"); });
        expect((await recoveryService.rewind(source, chat.id, "restore-point", token, "crash-command", true)).status).toBe("uncertain");
        expect(await readFile(join(dir, "effects"), "utf8")).toBe("fork");
        expect(await readFile(join(root, "a.txt"), "utf8")).toBe("before crash");
      } finally { await recoveryStore.database.close(); }
    } finally { child.kill("SIGKILL"); }

  } finally { client.close(); await host.close(); globalThis.WebSocket = original; await store.database.close(); await rm(dir, { recursive: true, force: true }); }
}, 60000);
