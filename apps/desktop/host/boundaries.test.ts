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
      inspectFiles: (...args) => service.inspectFiles(...args),
      loadWorkspace: async () => ({ state: await workspace.read(), restored: [], errors: [] }),
      persistWorkspace: state => workspace.write(state),
      checkpointPoints: (...args) => service.checkpointPoints(...args), inspectBoundary: (...args) => service.inspectBoundary(...args), rewind: (...args) => service.rewind(...args) });
    client = createHostClient(async () => host!.bootstrap());
    expect((await client.inspectFiles(null, chat.id, "point-0", null, null)).message).toContain("No project file coverage");
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
  await writeFile(join(root, "a.txt"), "captured"); await writeFile(join(root, "old.txt"), "captured untracked");
  await store.database.command("checkpoint", { body: { id: "restore-point", chatId: chat.id, kind: "after-turn", availability: "unavailable", completion: "pending", threadId: "provider", checkout: root, commandId: null } });
  await captureTurnCheckpoint(store.database, await store.get(source, chat.id), "provider", undefined, { id: "restore-point", turnId: "turn", completion: "completed", createdAt: Date.now() });
  await writeFile(join(root, "a.txt"), "today"); await writeFile(join(root, "new.txt"), "new eligible");
  const index = await readFile(join(source, ".git", "worktrees", "isolated", "index"));
  const workspace = new Workspace(join(dir, "workspace"), await store.database.ready, store.database);
  let failFiles = false;
  let forks = 0;
  const service = new ChatService(store, async () => ({ async request(method) {
    if (method === "thread/turns/list") return { data: [{ id: "turn", items: [] }], nextCursor: null };
    if (method === "thread/fork") { forks++; if (failFiles) await mkdir(join(root, "a.txt", "collision"), { recursive: true }); return { thread: { id: "historical" } }; }
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
