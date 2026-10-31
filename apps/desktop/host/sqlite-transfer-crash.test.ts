import { test, expect } from "vite-plus/test";
import { mkdtemp, realpath, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { DurableState } from "./durable-state";
import { Workspace } from "./workspace";
import { FileOperationJournal } from "./file-operation-journal";
test.each(["mutation", "outcome"])("SIGKILL after native copy %s retains edits and reconciles without replay", async window => {
  const { spawn, execFileSync } = await import("node:child_process");
  const { realpath } = await import("node:fs/promises");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-copy-crash-")));
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
    ${window === "mutation" ? `const copy = project.copy.bind(project); project.copy = async (...args) => { const result = await copy(...args); await pause(); return result; };` : `workspace.write = pause;`}
    await new FileOperations(workspace, dir + '/intent', owner).run(project, 'copy', 'a.txt', 'b.txt', () => {});`;
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
    expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("original");
    db = new DurableState(join(dir, "db"));
    expect(await db.ready).toMatchObject({ hostId: owner.hostId, clientId: owner.clientId });
    const workspace = new Workspace(join(dir, "unused"), owner, db);
    expect((await workspace.read()).drafts[0]).toMatchObject({ text: "crash edit", disk: { text: "original" } });
    expect(await new FileOperationJournal(join(dir, "intent"), owner, db).readIntent()).toMatchObject({ kind: "copy", destination: "b.txt", ...(window === "outcome" ? { completed: true } : {}) });
    await writeFile(join(dir, "b.txt"), "external after crash");
    const { Checkout } = await import("./project");
    const { FileOperations } = await import("./file-operations");
    const project = await Checkout.open(dir);
    try {
      await new FileOperations(workspace, join(dir, "intent"), owner).recover(async () => project);
      expect((await workspace.read()).drafts[0].text).toBe("crash edit");
      expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("external after crash");
    } finally { project.close(); }
  } finally { child.kill("SIGKILL"); await db?.close(); await rm(dir, { recursive: true, force: true }); }
});

test.each(["mutation", "outcome"])("SIGKILL after actual creation %s never repeats creation", async window => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-create-crash-")));
  execFileSync("git", ["init", dir]);
  const moduleUrl = (name: string) => JSON.stringify(join(import.meta.dirname, name + ".ts"));
  const script = `const { DurableState } = await import(${moduleUrl("durable-state")});
    const { DurableFiles } = await import(${moduleUrl("durable-files")});
    const { Checkout } = await import(${moduleUrl("project")});
    const dir = ${JSON.stringify(dir)};
    const db = new DurableState(dir + '/db'); const owner = await db.ready;
    const project = await Checkout.open(dir);
    const pause = async () => { console.log(JSON.stringify(owner)); await new Promise(() => {}); };
    await new DurableFiles(db, owner.clientId, 'epoch').run({commandId:'create', admissionEpoch:'epoch'}, 'uncertain', async () => {
      project.create('', 'created.txt', 'file');
      ${window === "mutation" ? "await pause();" : ""}
      return 'accepted';
    });
    await pause();`;
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
      child.on("error", reject); child.on("exit", () => reject(Error(errors || "No acknowledgement")));
    });
    const exited = new Promise(resolve => child.once("exit", resolve)); child.kill("SIGKILL"); await exited;
    expect(await readFile(join(dir, "created.txt"), "utf8")).toBe("");
    await writeFile(join(dir, "created.txt"), "external after crash");
    db = new DurableState(join(dir, "db"));
    expect(await db.ready).toMatchObject({ hostId: owner.hostId, clientId: owner.clientId });
    const { DurableFiles } = await import("./durable-files");
    const commands = new DurableFiles(db, owner.clientId, "new epoch");
    expect(await commands.run({ commandId: "create", admissionEpoch: "epoch" }, "uncertain", async () => { throw Error("Creation replayed"); })).toBe(window === "mutation" ? "uncertain" : "accepted");
    expect(await readFile(join(dir, "created.txt"), "utf8")).toBe("external after crash");
    await expect(commands.run({ commandId: "unknown", admissionEpoch: "epoch" }, "uncertain", async () => "bad")).rejects.toThrow("Expired");
  } finally { child.kill("SIGKILL"); await db?.close(); await rm(dir, { recursive: true, force: true }); }
});
