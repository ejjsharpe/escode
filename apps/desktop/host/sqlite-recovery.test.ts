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

test("SIGKILL retains acknowledged recovery text and interrupted Save evidence without replay", async () => {
  const { spawn } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const dir = await mkdtemp(join(tmpdir(), "escode-save-crash-"));
  await writeFile(join(dir, "a.txt"), "external disk");
  const script = `const { DurableState } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, "durable-state.ts")).href)});
    const db = new DurableState(${JSON.stringify(join(dir, "db"))});
    const owner = await db.ready;
    await db.recoveryWrite(owner.clientId, 'workspace', { projects: [], selected: '', views: {}, drafts: [{ root: ${JSON.stringify(dir)}, path: 'a.txt', text: 'crash edit', disk: { text: 'old disk', version: 'old' } }] }, 0);
    await db.recoveryWrite(owner.clientId, 'intent', { root: ${JSON.stringify(dir)}, checkoutIdentity: '1:2', source: 'a.txt', destination: '', kind: 'save', identity: '1:3', saveText: 'crash edit' }, 0);
    console.log(JSON.stringify(owner)); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
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
    db = new DurableState(join(dir, "db"));
    expect(await db.ready).toMatchObject({ hostId: owner.hostId, clientId: owner.clientId });
    expect((await new Workspace(join(dir, "old.json"), owner, db).read()).drafts[0]).toMatchObject({ text: "crash edit", disk: { text: "old disk", version: "old" } });
    expect(await new FileOperationJournal(join(dir, "intent.json"), owner, db).readIntent()).toMatchObject({ kind: "save", saveText: "crash edit" });
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("external disk");
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
