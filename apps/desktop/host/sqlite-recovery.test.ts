import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableState } from "./durable-state";
import { Workspace, emptyWorkspace } from "./workspace";
import { FileOperationJournal } from "./file-operation-journal";

test("SQLite client snapshots and Save intent survive reopen with independent ownership", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-recovery-"));
  let db = new DurableState(join(dir, "db"));
  try {
    const owner = await db.ready;
    await writeFile(join(dir, "old.json"), "legacy bytes");
    const workspace = new Workspace(join(dir, "old.json"), owner, db);
    const state = emptyWorkspace();
    state.drafts.push({ root: dir, path: "a.txt", text: "available edit", disk: { text: "loaded baseline", version: "v1" } });
    await workspace.write(state);
    const journal = new FileOperationJournal(join(dir, "old-intent.json"), owner, db);
    await journal.writeIntent({ root: dir, checkoutIdentity: "1:2", source: "a.txt", destination: "", kind: "save", identity: "1:3", saveText: "available edit" });
    const other = new Workspace(join(dir, "other.json"), { ...owner, clientId: "other" }, db);
    await other.write(emptyWorkspace());
    await db.close();
    db = new DurableState(join(dir, "db"));
    await db.ready;
    expect((await new Workspace(join(dir, "old.json"), owner, db).read()).drafts).toEqual(state.drafts);
    expect(await new FileOperationJournal(join(dir, "old-intent.json"), owner, db).readIntent()).toMatchObject({ saveText: "available edit", kind: "save" });
    expect(await readFile(join(dir, "old.json"), "utf8")).toBe("legacy bytes");
    expect((await new Workspace(join(dir, "other.json"), { ...owner, clientId: "other" }, db).read()).drafts).toEqual([]);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("authenticated Save fails closed on admission failure and retains edits after outcome failure", async () => {
  const { realpath } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  const { DatabaseSync } = await import("node:sqlite");
  const { Checkout } = await import("./project");
  const { FileOperations } = await import("./file-operations");
  const { startHost } = await import("@escode/host");
  const { createHostClient } = await import("@escode/client-runtime");
  const { default: WebSocket } = await import("ws");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-save-sqlite-")));
  execFileSync("git", ["init", dir]);
  await writeFile(join(dir, "a.txt"), "original");
  const project = await Checkout.open(dir);
  const db = new DurableState(join(dir, "db"));
  const originalSocket = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
  let providerCalls = 0;
  try {
    const owner = await db.ready;
    const workspace = new Workspace(join(dir, "old.json"), owner, db);
    const baseline = await project.read("a.txt");
    const state = emptyWorkspace();
    state.drafts = [{ root: dir, path: "a.txt", text: "unsaved", disk: baseline }];
    await workspace.write(state);
    const operations = new FileOperations(workspace, join(dir, "intent.json"), owner);
    const host = await startHost({ ...owner, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
      saveFile: (...args) => operations.save(project, args[1], args[2], args[3], () => {}),
      persistWorkspace: value => operations.persist(value),
      loadWorkspace: async () => ({ state: await workspace.read(), restored: [], errors: [] }),
      sendMessage: async () => { providerCalls++; throw Error("Unexpected provider dispatch"); },
    });
    const client = createHostClient(async () => host.bootstrap());
    const fault = new DatabaseSync(join(dir, "db/state.sqlite"));
    try {
      fault.exec("CREATE TRIGGER deny_intent BEFORE INSERT ON client_recovery WHEN NEW.kind='intent' BEGIN SELECT RAISE(ABORT,'intent unavailable'); END");
      await expect(client.saveFile(dir, "a.txt", "saved", baseline.version)).rejects.toThrow("intent unavailable");
      expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("original");
      fault.exec("DROP TRIGGER deny_intent");
      await writeFile(join(dir, "a.txt"), "conflicting disk");
      expect(await client.saveFile(dir, "a.txt", "saved", baseline.version)).toMatchObject({ kind: "conflict" });
      expect((await client.loadWorkspace()).state.drafts[0]).toEqual(state.drafts[0]);
      expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("conflicting disk");
      await writeFile(join(dir, "a.txt"), "original");
      fault.exec("CREATE TRIGGER deny_outcome BEFORE INSERT ON client_recovery WHEN NEW.kind='intent' AND json_extract(NEW.body,'$.completed')=1 BEGIN SELECT RAISE(ABORT,'outcome unavailable'); END");
      expect(await client.saveFile(dir, "a.txt", "saved", baseline.version)).toMatchObject({ persistencePending: true });
      expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("saved");
      expect((await client.loadWorkspace()).state.drafts[0]).toEqual(state.drafts[0]);
      fault.exec("DROP TRIGGER deny_outcome");
      await writeFile(join(dir, "a.txt"), "external after save");
      const reopened = new Workspace(join(dir, "old.json"), owner, db);
      const recovered = new FileOperations(reopened, join(dir, "intent.json"), owner);
      expect(await recovered.recover(async () => project)).toContain("Uncertain");
      expect((await reopened.read()).drafts[0]).toEqual(state.drafts[0]);
      expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("external after save");
      expect(providerCalls).toBe(0);
    } finally { fault.close(); await client.close(); await host.close(); }
  } finally { globalThis.WebSocket = originalSocket; project.close(); await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test.each(["mutation", "outcome"])("SIGKILL after native Save %s retains edits and reconciles without replay", async window => {
  const { spawn, execFileSync } = await import("node:child_process");
  const { realpath } = await import("node:fs/promises");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-save-crash-")));
  execFileSync("git", ["init", dir]);
  await writeFile(join(dir, "a.txt"), "original");
  const moduleUrl = (name: string) => JSON.stringify(join(import.meta.dirname, name + ".ts"));
  const script = `const { DurableState } = await import(${moduleUrl("durable-state")});
    const { Workspace, emptyWorkspace } = await import(${moduleUrl("workspace")});
    const { FileOperations } = await import(${moduleUrl("file-operations")});
    const { Checkout } = await import(${moduleUrl("project")});
    const dir = ${JSON.stringify(dir)};
    const db = new DurableState(dir + '/db');
    const owner = await db.ready;
    const project = await Checkout.open(dir);
    const workspace = new Workspace(dir + '/unused', owner, db);
    const state = emptyWorkspace();
    const baseline = await project.read('a.txt');
    state.drafts = [{ root: dir, path: 'a.txt', text: 'crash edit', disk: baseline }];
    await workspace.write(state);
    const pause = async () => { console.log(JSON.stringify(owner)); await new Promise(() => {}); };
    ${window === "mutation" ? `const save = project.save.bind(project); project.save = async (...args) => { const result = await save(...args); await pause(); return result; };` : window === "outcome" ? `workspace.write = pause;` : ""}
    await new FileOperations(workspace, dir + '/intent', owner).save(project, 'a.txt', 'crash edit', baseline.version, () => {});`;
  const { build } = await import("esbuild");
  const { copyFile } = await import("node:fs/promises");
  await build({ stdin: { contents: script, resolveDir: import.meta.dirname }, outfile: join(dir, "child.mjs"), bundle: true, platform: "node", format: "esm" });
  await copyFile(join(import.meta.dirname, "sqlite-worker.cjs"), join(dir, "sqlite-worker.cjs"));
  const child = spawn(process.execPath, [join(dir, "child.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
  let db: DurableState | undefined;
  try {
    const owner = await new Promise<any>((resolve, reject) => {
      let output = "", errors = "";
      child.stderr.on("data", data => { errors += data; });
      child.stdout.on("data", data => { output += data; if (output.includes("\n")) resolve(JSON.parse(output.trim())); });
      child.on("error", reject);
      child.on("exit", () => reject(Error(errors || "No acknowledgement")));
    });
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGKILL"); await exited;
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("crash edit");
    db = new DurableState(join(dir, "db"));
    expect(await db.ready).toMatchObject({ hostId: owner.hostId, clientId: owner.clientId });
    const workspace = new Workspace(join(dir, "unused"), owner, db);
    expect((await workspace.read()).drafts[0]).toMatchObject({ text: "crash edit", disk: { text: "original" } });
    expect(await new FileOperationJournal(join(dir, "intent"), owner, db).readIntent()).toMatchObject({ kind: "save", saveText: "crash edit", ...(window === "outcome" ? { completed: true } : {}) });
    await writeFile(join(dir, "a.txt"), "external after crash");
    const { Checkout } = await import("./project");
    const { FileOperations } = await import("./file-operations");
    const project = await Checkout.open(dir);
    try {
      await new FileOperations(workspace, join(dir, "intent"), owner).recover(async () => project);
      expect((await workspace.read()).drafts[0].text).toBe("crash edit");
      expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("external after crash");
    } finally { project.close(); }
  } finally { child.kill("SIGKILL"); await db?.close(); await rm(dir, { recursive: true, force: true }); }
});

test("a stale recovery writer cannot discard a newer client's available text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-recovery-revision-"));
  const db = new DurableState(join(dir, "db"));
  try {
    const owner = await db.ready;
    const first = new Workspace(join(dir, "unused"), owner, db);
    const stale = new Workspace(join(dir, "unused"), owner, db);
    await stale.read();
    const state = emptyWorkspace();
    state.drafts = [{ root: dir, path: "a.txt", text: "new edit", disk: { text: "baseline", version: "v1" } }];
    await first.write(state);
    await expect(stale.write(emptyWorkspace())).rejects.toThrow("Recovery storage changed");
    expect((await first.read()).drafts).toEqual(state.drafts);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("independent authenticated clients retain text and baselines across Save, acknowledgement and late snapshots", async () => {
  const { realpath } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  const { Checkout } = await import("./project");
  const { FileOperations } = await import("./file-operations");
  const { startHost } = await import("@escode/host");
  const { createHostClient } = await import("@escode/client-runtime");
  const { default: WebSocket } = await import("ws");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-independent-save-")));
  execFileSync("git", ["init", dir]);
  await writeFile(join(dir, "a.txt"), "original");
  const project = await Checkout.open(dir);
  const db = new DurableState(join(dir, "db"));
  const originalSocket = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
  const connections: { close(): Promise<void> }[] = [];
  try {
    const owner = await db.ready;
    const baseline = await project.read("a.txt");
    const connect = async (clientId: string, text: string) => {
      const identity = { ...owner, clientId };
      const workspace = new Workspace(join(dir, "unused"), identity, db);
      const state = emptyWorkspace();
      state.drafts = [{ root: dir, path: "a.txt", text, disk: baseline }];
      await workspace.write(state);
      const operations = new FileOperations(workspace, join(dir, "intent"), identity);
      const host = await startHost({ ...identity, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
        saveFile: (...args) => operations.save(project, args[1], args[2], args[3], () => {}),
        ackFileOperation: async () => { await operations.ack(); },
        persistWorkspace: value => operations.persist(value),
        loadWorkspace: async () => ({ state: await workspace.read(), restored: [], errors: [] }),
      });
      connections.push(host);
      const client = createHostClient(async () => host.bootstrap());
      connections.push(client);
      return { client, state };
    };
    const a = await connect(owner.clientId, "A edit"), b = await connect("second-client", "B edit");
    expect(await a.client.saveFile(dir, "a.txt", "A edit", baseline.version)).toMatchObject({ kind: "saved", persistencePending: false });
    await a.client.ackFileOperation(dir);
    // This renderer snapshot was captured before Save's baseline handoff.
    a.state.drafts[0].text = "A newer edit";
    await a.client.persistWorkspace(a.state);
    expect((await a.client.loadWorkspace()).state.drafts[0]).toMatchObject({ text: "A newer edit", disk: { text: "A edit" } });
    expect((await b.client.loadWorkspace()).state.drafts[0]).toEqual(b.state.drafts[0]);
    expect(await b.client.saveFile(dir, "a.txt", "B edit", baseline.version)).toMatchObject({ kind: "conflict" });
    await b.client.ackFileOperation(dir);
    await b.client.persistWorkspace(b.state);
    expect((await b.client.loadWorkspace()).state.drafts[0]).toEqual(b.state.drafts[0]);
    expect((await a.client.loadWorkspace()).state.drafts[0]).toMatchObject({ text: "A newer edit", disk: { text: "A edit" } });
    expect(await b.client.saveFile(dir, "a.txt", "B edit", (await project.read("a.txt")).version)).toMatchObject({ kind: "saved", persistencePending: false });
    await b.client.ackFileOperation(dir);
    expect((await b.client.loadWorkspace()).state.drafts[0]).toMatchObject({ text: "B edit", disk: { text: "B edit" } });
    expect((await a.client.loadWorkspace()).state.drafts[0]).toMatchObject({ text: "A newer edit", disk: { text: "A edit" } });
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("B edit");
  } finally {
    for (const connection of connections.reverse()) await connection.close();
    globalThis.WebSocket = originalSocket; project.close(); await db.close(); await rm(dir, { recursive: true, force: true });
  }
});

test.each(["mutation", "outcome", "acknowledgement", "partial-batch"])("SIGKILL after native move %s retains edits and reconciles without replay", async window => {
  const { spawn, execFileSync } = await import("node:child_process");
  const { realpath } = await import("node:fs/promises");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-move-crash-")));
  execFileSync("git", ["init", dir]);
  await writeFile(join(dir, "a.txt"), "original");
  const moduleUrl = (name: string) => JSON.stringify(join(import.meta.dirname, name + ".ts"));
  const script = `const { DurableState } = await import(${moduleUrl("durable-state")});
    const { Workspace, emptyWorkspace } = await import(${moduleUrl("workspace")});
    const { FileOperations } = await import(${moduleUrl("file-operations")});
    const { Checkout } = await import(${moduleUrl("project")});
    const dir = ${JSON.stringify(dir)};
    const db = new DurableState(dir + '/db');
    const owner = await db.ready;
    const project = await Checkout.open(dir);
    const workspace = new Workspace(dir + '/unused', owner, db);
    const state = emptyWorkspace();
    const baseline = await project.read('a.txt');
    state.drafts = [{ root: dir, path: 'a.txt', text: 'crash edit', disk: baseline }];
    await workspace.write(state);
    const pause = async () => { console.log(JSON.stringify(owner)); await new Promise(() => {}); };
    ${window === "mutation" ? `const move = project.move.bind(project); project.move = (...args) => { const result = move(...args); console.log(JSON.stringify(owner)); process.kill(process.pid, "SIGSTOP"); return result; };` : window === "outcome" ? `workspace.write = pause;` : ""}
    const operations = new FileOperations(workspace, dir + '/intent', owner);
    await operations.run(project, 'move', 'a.txt', 'moved.txt');
    ${window === "acknowledgement" ? "await operations.ack(dir); await pause();" : window === "partial-batch" ? "await operations.ack(); try { await operations.run(project, 'move', 'missing.txt', 'other.txt'); } catch {} await pause();" : ""}`;
  const { build } = await import("esbuild");
  const { copyFile } = await import("node:fs/promises");
  await build({ stdin: { contents: script, resolveDir: import.meta.dirname }, outfile: join(dir, "child.mjs"), bundle: true, platform: "node", format: "esm" });
  await copyFile(join(import.meta.dirname, "sqlite-worker.cjs"), join(dir, "sqlite-worker.cjs"));
  const child = spawn(process.execPath, [join(dir, "child.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
  let db: DurableState | undefined;
  try {
    const owner = await new Promise<any>((resolve, reject) => {
      let output = "", errors = "";
      child.stderr.on("data", data => { errors += data; });
      child.stdout.on("data", data => { output += data; if (output.includes("\n")) resolve(JSON.parse(output.trim())); });
      child.on("error", reject);
      child.on("exit", () => reject(Error(errors || "No acknowledgement")));
    });
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGKILL"); await exited;
    expect(await readFile(join(dir, "moved.txt"), "utf8")).toBe("original");
    db = new DurableState(join(dir, "db"));
    expect(await db.ready).toMatchObject({ hostId: owner.hostId, clientId: owner.clientId });
    const workspace = new Workspace(join(dir, "unused"), owner, db);
    expect((await workspace.read()).drafts[0]).toMatchObject({ text: "crash edit", disk: { text: "original" } });
    if (window === "acknowledgement" || window === "partial-batch") expect(await new FileOperationJournal(join(dir, "intent"), owner, db).readIntent()).toBeNull();
    else expect(await new FileOperationJournal(join(dir, "intent"), owner, db).readIntent()).toMatchObject({ kind: "move", destination: "moved.txt", ...(window === "outcome" ? { completed: true } : {}) });
    await writeFile(join(dir, "moved.txt"), "external after crash");
    const { Checkout } = await import("./project");
    const { FileOperations } = await import("./file-operations");
    const project = await Checkout.open(dir);
    try {
      await new FileOperations(workspace, join(dir, "intent"), owner).recover(async () => project);
      expect((await workspace.read()).drafts[0].text).toBe("crash edit");
      expect(await readFile(join(dir, "moved.txt"), "utf8")).toBe("external after crash");
    } finally { project.close(); }
  } finally { child.kill("SIGKILL"); await db?.close(); await rm(dir, { recursive: true, force: true }); }
});

test("authenticated move rejects failed SQLite admission and preserves descendants after failed outcome", async () => {
  const { realpath, mkdir } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  const { DatabaseSync } = await import("node:sqlite");
  const { Checkout } = await import("./project");
  const { FileOperations } = await import("./file-operations");
  const { startHost } = await import("@escode/host");
  const { createHostClient } = await import("@escode/client-runtime");
  const { default: WebSocket } = await import("ws");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-move-auth-")));
  execFileSync("git", ["init", dir]);
  await mkdir(join(dir, "folder"));
  await writeFile(join(dir, "folder/a.txt"), "original");
  const project = await Checkout.open(dir);
  const db = new DurableState(join(dir, "db"));
  const originalSocket = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
  try {
    const owner = await db.ready;
    const workspace = new Workspace(join(dir, "unused"), owner, db);
    const state = emptyWorkspace();
    state.drafts = [{ root: dir, path: "folder/a.txt", text: "available descendant", disk: await project.read("folder/a.txt") }];
    await workspace.write(state);
    const operations = new FileOperations(workspace, join(dir, "intent"), owner);
    const host = await startHost({ ...owner, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
      moveEntry: async ({ source, target }) => operations.run(project, "move", source, target),
      persistWorkspace: value => operations.persist(value),
      loadWorkspace: async () => ({ state: await workspace.read(), restored: [], errors: [] }),
    });
    const client = createHostClient(async () => host.bootstrap());
    const fault = new DatabaseSync(join(dir, "db/state.sqlite"));
    try {
      fault.exec("CREATE TRIGGER deny_intent BEFORE INSERT ON client_recovery WHEN NEW.kind='intent' BEGIN SELECT RAISE(ABORT,'intent unavailable'); END");
      await expect(client.moveEntry({ root: dir, action: "move", source: "folder", target: "renamed" })).rejects.toThrow("intent unavailable");
      expect(await readFile(join(dir, "folder/a.txt"), "utf8")).toBe("original");
      fault.exec("DROP TRIGGER deny_intent");
      fault.exec("CREATE TRIGGER deny_outcome BEFORE INSERT ON client_recovery WHEN NEW.kind='intent' AND json_extract(NEW.body,'$.completed')=1 BEGIN SELECT RAISE(ABORT,'outcome unavailable'); END");
      expect(await client.moveEntry({ root: dir, action: "move", source: "folder", target: "renamed" })).toMatchObject({ applied: true, persistencePending: true });
      expect(await readFile(join(dir, "renamed/a.txt"), "utf8")).toBe("original");
      expect((await client.loadWorkspace()).state.drafts).toEqual(state.drafts);
      fault.exec("DROP TRIGGER deny_outcome");
      await operations.recover(async () => project);
      await client.persistWorkspace(state);
      expect((await client.loadWorkspace()).state.drafts[0]).toMatchObject({ path: "renamed/a.txt", text: "available descendant", disk: { text: "original" } });
    } finally { fault.close(); await client.close(); await host.close(); }
  } finally { globalThis.WebSocket = originalSocket; project.close(); await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("recovered move delivers an acknowledgement obligation before another mutation", async () => {
  const { Checkout } = await import("./project");
  const { FileOperations } = await import("./file-operations");
  const { execFileSync } = await import("node:child_process");
  const { realpath } = await import("node:fs/promises");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-handoff-")));
  execFileSync("git", ["init", dir]);
  await writeFile(join(dir, "a.txt"), "original");
  const db = new DurableState(join(dir, "db"));
  const project = await Checkout.open(dir);
  try {
    const owner = await db.ready;
    const workspace = new Workspace(join(dir, "unused"), owner, db);
    const state = emptyWorkspace();
    state.drafts = [{ root: dir, path: "a.txt", text: "my edit", disk: await project.read("a.txt") }];
    await workspace.write(state);
    await new FileOperations(workspace, "unused", owner).run(project, "move", "a.txt", "b.txt");
    const recovered = new FileOperations(workspace, "unused", owner);
    await recovered.recover(async () => project);
    expect(recovered.acknowledgementRoots()).toEqual([dir]);
    const loaded = await workspace.read();
    expect(loaded.drafts[0]).toMatchObject({ path: "b.txt", text: "my edit", disk: { text: "original" } });
    await recovered.persist(loaded);
    await recovered.ack(dir);
    expect(recovered.acknowledgementRoots()).toEqual([]);
    expect((await recovered.run(project, "move", "b.txt", "c.txt")).applied).toBe(true);
  } finally { project.close(); await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test.each(["move", "trash"] as const)("another client's %s reconciles independent edits and retains its own acknowledgement", async kind => {
  const { Checkout } = await import("./project");
  const { FileOperations } = await import("./file-operations");
  const { execFileSync } = await import("node:child_process");
  const { realpath } = await import("node:fs/promises");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-multi-move-")));
  execFileSync("git", ["init", dir]);
  await writeFile(join(dir, "a.txt"), "original");
  const db = new DurableState(join(dir, "db"));
  const project = await Checkout.open(dir);
  try {
    const owner = await db.ready;
    const a = new Workspace("unused", owner, db);
    const other = { ...owner, clientId: "other" };
    const b = new Workspace("unused", other, db);
    const state = emptyWorkspace();
    state.drafts = [{ root: dir, path: "a.txt", text: "A edit", disk: await project.read("a.txt") }];
    await a.write(state);
    const late = structuredClone(state);
    late.drafts[0].text = "B independent edit";
    late.drafts[0].disk = { text: "B old baseline", version: "old" };
    await b.write(late);
    const first = new FileOperations(a, "unused", owner);
    await first.run(project, kind, "a.txt", kind === "move" ? "b.txt" : "");
    await first.ack(dir);
    const second = new FileOperations(b, "unused", other);
    const { startHost } = await import("@escode/host");
    const { createHostClient } = await import("@escode/client-runtime");
    const { default: WebSocket } = await import("ws");
    const originalSocket = globalThis.WebSocket;
    globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
    const host = await startHost({ ...other, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
      loadWorkspace: async () => {
        await second.recover(async () => project);
        return { state: await b.read(), restored: [], errors: [], acknowledgementRoots: second.acknowledgementRoots() };
      },
      persistWorkspace: state => second.persist(state),
      ackFileOperation: root => second.ack(root),
    });
    const client = createHostClient(async () => host.bootstrap());
    try {
      expect((await client.loadWorkspace()).acknowledgementRoots).toEqual([dir]);
      await client.persistWorkspace(late);
      expect((await client.loadWorkspace()).state.drafts[0]).toEqual({ ...late.drafts[0], path: kind === "move" ? "b.txt" : "a.txt" });
      await client.ackFileOperation(dir);
    } finally { await client.close(); await host.close(); globalThis.WebSocket = originalSocket; }
    expect((await new FileOperationJournal("unused", owner, db).readFacts())).toEqual([]);
    expect((await new FileOperationJournal("unused", other, db).readFacts())).toEqual([]);
  } finally { project.close(); await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test.each(["mutation", "outcome", "acknowledgement", "partial-batch"])("SIGKILL after native Trash %s retains edits and reconciles without replay", async window => {
  const { spawn, execFileSync } = await import("node:child_process");
  const { realpath } = await import("node:fs/promises");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-trash-crash-")));
  execFileSync("git", ["init", dir]);
  await writeFile(join(dir, "a.txt"), "original");
  const moduleUrl = (name: string) => JSON.stringify(join(import.meta.dirname, name + ".ts"));
  const script = `const { DurableState } = await import(${moduleUrl("durable-state")});
    const { Workspace, emptyWorkspace } = await import(${moduleUrl("workspace")});
    const { FileOperations } = await import(${moduleUrl("file-operations")});
    const { Checkout } = await import(${moduleUrl("project")});
    const dir = ${JSON.stringify(dir)};
    const db = new DurableState(dir + '/db');
    const owner = await db.ready;
    const project = await Checkout.open(dir);
    const workspace = new Workspace(dir + '/unused', owner, db);
    const state = emptyWorkspace();
    const baseline = await project.read('a.txt');
    state.drafts = [{ root: dir, path: 'a.txt', text: 'crash edit', disk: baseline }];
    await workspace.write(state);
    const nativeTrash = project.trash.bind(project);
    project.trash = (...args) => { const destination = nativeTrash(...args); owner.trashDestination = destination; return destination; };
    const pause = async () => { console.log(JSON.stringify(owner)); await new Promise(() => {}); };
    ${window === "mutation" ? `const trash = project.trash.bind(project); project.trash = (...args) => { const result = trash(...args); console.log(JSON.stringify(owner)); process.kill(process.pid, "SIGSTOP"); return result; };` : window === "outcome" ? `workspace.write = pause;` : ""}
    const operations = new FileOperations(workspace, dir + '/intent', owner);
    await operations.run(project, 'trash', 'a.txt', '');
    ${window === "acknowledgement" ? "await operations.ack(dir); await pause();" : window === "partial-batch" ? "await operations.ack(); try { await operations.run(project, 'trash', 'missing.txt', ''); } catch {} await pause();" : ""}`;
  const { build } = await import("esbuild");
  const { copyFile } = await import("node:fs/promises");
  await build({ stdin: { contents: script, resolveDir: import.meta.dirname }, outfile: join(dir, "child.mjs"), bundle: true, platform: "node", format: "esm" });
  await copyFile(join(import.meta.dirname, "sqlite-worker.cjs"), join(dir, "sqlite-worker.cjs"));
  const child = spawn(process.execPath, [join(dir, "child.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
  let db: DurableState | undefined;
  try {
    const owner = await new Promise<any>((resolve, reject) => {
      let output = "", errors = "";
      child.stderr.on("data", data => { errors += data; });
      child.stdout.on("data", data => { output += data; if (output.includes("\n")) resolve(JSON.parse(output.trim())); });
      child.on("error", reject);
      child.on("exit", () => reject(Error(errors || "No acknowledgement")));
    });
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGKILL"); await exited;
    expect(await readFile(owner.trashDestination, "utf8")).toBe("original");
    await rm(owner.trashDestination); // Only the native helper's test-owned result.
    await expect(readFile(join(dir, "a.txt"))).rejects.toThrow();
    db = new DurableState(join(dir, "db"));
    expect(await db.ready).toMatchObject({ hostId: owner.hostId, clientId: owner.clientId });
    const workspace = new Workspace(join(dir, "unused"), owner, db);
    if (window === "mutation" || window === "outcome") expect((await workspace.read()).drafts[0]).toMatchObject({ text: "crash edit", disk: { text: "original" } });
    if (window === "acknowledgement" || window === "partial-batch") expect(await new FileOperationJournal(join(dir, "intent"), owner, db).readIntent()).toBeNull();
    else expect(await new FileOperationJournal(join(dir, "intent"), owner, db).readIntent()).toMatchObject({ kind: "trash", destination: "", ...(window === "outcome" ? { completed: true } : {}) });
    await writeFile(join(dir, "unrelated.txt"), "external after crash");
    const { Checkout } = await import("./project");
    const { FileOperations } = await import("./file-operations");
    const project = await Checkout.open(dir);
    try {
      await new FileOperations(workspace, join(dir, "intent"), owner).recover(async () => project);
      if (window === "mutation") expect((await workspace.read()).drafts[0].text).toBe("crash edit");
      else expect((await workspace.read()).drafts).toEqual([]);
      expect(await readFile(join(dir, "unrelated.txt"), "utf8")).toBe("external after crash");
    } finally { project.close(); }
  } finally { child.kill("SIGKILL"); await db?.close(); await rm(dir, { recursive: true, force: true }); }
});
