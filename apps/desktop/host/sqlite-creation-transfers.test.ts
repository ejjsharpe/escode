import { test, expect } from "vite-plus/test";
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";
import { startHost } from "@escode/host";
import { createHostClient } from "@escode/client-runtime";
import { createFileWorkflow } from "./file-workflow";
import { randomUUID } from "node:crypto";
import { DurableState } from "./durable-state";
import { Workspace, emptyWorkspace } from "./workspace";
import { Checkout } from "./project";

test("authenticated creation and duplicate retain outcomes, failures and copied edits across SQLite reopen", async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "escode-create-transfer-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  writeFileSync(join(root, "a.txt"), "source");
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "add", "a.txt"]);
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "baseline"]);
  writeFileSync(join(root, "staged.txt"), "preexisting staged bytes");
  execFileSync("git", ["-C", root, "add", "staged.txt"]);
  const staged = execFileSync("git", ["-C", root, "diff", "--cached", "--binary"], { encoding: "utf8" });
  const project = await Checkout.open(root);
  let db = new DurableState(join(base, "db"));
  const owner = await db.ready;
  const admissionEpoch = randomUUID();
  const socket = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
  const build = () => {
    const workspace = new Workspace(join(base, "legacy.json"), owner, db);
    const files = createFileWorkflow({ userData: base, workspace, admissionEpoch,
      projects: new Map([[root, project]]), projectSessions: new Map([[project.repositoryGit.repository(), {}]]),
      removing: new Set(), checkout: async () => project, isQuitting: () => false,
      clipboard: { read: async () => [] }, writeClipboard: async () => {},
      showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
    });
    return { files, workspace };
  };
  let current = build();
  let releaseResponse: (() => void) | undefined;
  let reportCreation!: () => void;
  const creationReported = new Promise<void>(resolve => { reportCreation = resolve; });
  let responseLost = false;
  const host = await startHost({ ...owner, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
    createState: () => admissionEpoch,
    createEntry: async c => {
      const result = await current.files.hostActions.createEntry!(c);
      if (c.commandId === "response-loss" && !responseLost) {
        responseLost = true;
        await new Promise<void>(resolve => { releaseResponse = resolve; reportCreation(); });
      }
      return result;
    },
    transferAction: a => current.files.hostActions.transferAction(a),
    ackFileOperation: r => current.files.hostActions.ackFileOperation(r),
    persistWorkspace: s => current.files.persist(s),
    loadWorkspace: async () => ({ state: await current.workspace.read(), restored: [], errors: [] }),
  });
  const client = createHostClient(async () => host.bootstrap());
  let fault = new DatabaseSync(join(base, "db/state.sqlite"));
  try {
    writeFileSync(join(base, "legacy.json"), "untouched legacy");
    const state = emptyWorkspace();
    state.drafts = [{ root, path: "a.txt", text: "unsaved source", disk: await project.read("a.txt") }];
    await client.persistWorkspace(state);
    const command = { commandId: "create", admissionEpoch: await client.createState(), root, parent: "", name: "new.txt", kind: "file" as const };
    fault.exec("CREATE TRIGGER deny_commands BEFORE INSERT ON client_recovery WHEN NEW.kind='fileCommands' BEGIN SELECT RAISE(ABORT,'intent unavailable'); END");
    await expect(client.createEntry(command)).rejects.toThrow("intent unavailable");
    await expect(project.read("new.txt")).rejects.toThrow();
    fault.exec("DROP TRIGGER deny_commands");
    expect(await client.createEntry(command)).toMatchObject({ status: "accepted", path: "new.txt" });
    writeFileSync(join(root, "new.txt"), "external");
    expect(await client.createEntry(command)).toMatchObject({ status: "accepted" });
    await expect(client.createEntry({ ...command, name: "changed" })).rejects.toThrow("identity conflict");
    const disconnected = { ...command, commandId: "response-loss", name: "response.txt" };
    const request = client.createEntry(disconnected).catch(error => error);
    await creationReported;
    await client.close();
    releaseResponse!();
    await request;
    writeFileSync(join(root, "response.txt"), "external after response loss");
    expect(await client.createEntry(disconnected)).toMatchObject({ status: "accepted", path: "response.txt" });
    expect(readFileSync(join(root, "response.txt"), "utf8")).toBe("external after response loss");
    const transfer = { root, operation: "transfer" as const, commandId: "copy", admissionEpoch: command.admissionEpoch, kind: "duplicate" as const, parent: "", paths: ["a.txt"] };
    const result = await client.transferAction(transfer);
    expect(result).toMatchObject({ results: [{ applied: true, intent: { destination: "a copy.txt" } }], requiresAck: true });
    expect(await client.transferAction(transfer)).toEqual(result);
    await client.persistWorkspace(state);
    expect((await client.loadWorkspace()).state.drafts).toContainEqual({ ...state.drafts[0], path: "a copy.txt" });
    expect(readFileSync(join(root, "a copy.txt"), "utf8")).toBe("source");
    await client.ackFileOperation(root);
    writeFileSync(join(root, "b.txt"), "second source");
    fault.exec("CREATE TRIGGER deny_second BEFORE INSERT ON client_recovery WHEN NEW.kind='intent' AND json_extract(NEW.body,'$.source')='b.txt' BEGIN SELECT RAISE(ABORT,'second intent unavailable'); END");
    const partial = { ...transfer, commandId: "partial", paths: ["a.txt", "b.txt"] };
    const partialResult = await client.transferAction(partial);
    expect(partialResult).toMatchObject({ results: [{ applied: true, intent: { destination: "a copy 2.txt" } }, { applied: false }], requiresAck: true });
    fault.exec("DROP TRIGGER deny_second");
    await expect(project.read("b copy.txt")).rejects.toThrow();
    expect(await client.transferAction(partial)).toEqual(partialResult);
    fault.close();
    await db.close(); db = new DurableState(join(base, "db")); await db.ready;
    current = build();
    await current.files.recover();
    expect(await client.transferAction(partial)).toEqual(partialResult);
    expect((await client.loadWorkspace()).state.drafts).toContainEqual({ ...state.drafts[0], path: "a copy 2.txt" });
    expect(await client.transferAction(transfer)).toEqual(result);
    expect(await client.createEntry(command)).toMatchObject({ status: "accepted" });
    expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("external");
    expect(readFileSync(join(base, "legacy.json"), "utf8")).toBe("untouched legacy");
    await client.persistWorkspace(state);
    expect((await client.loadWorkspace()).state.drafts).toContainEqual({ ...state.drafts[0], path: "a copy 2.txt" });
    await client.ackFileOperation(root);
    fault = new DatabaseSync(join(base, "db/state.sqlite"));
    fault.exec("CREATE TRIGGER deny_result BEFORE INSERT ON client_recovery WHEN NEW.kind='fileCommands' AND json_extract(NEW.body,'$[#-1].result') IS NOT NULL BEGIN SELECT RAISE(ABORT,'result unavailable'); END");
    const lostTransfer = { ...transfer, commandId: "lost-transfer" };
    await expect(client.transferAction(lostTransfer)).rejects.toThrow("result unavailable");
    fault.exec("DROP TRIGGER deny_result");
    const uncertainTransfer = await client.transferAction(lostTransfer);
    expect(uncertainTransfer).toMatchObject({ uncertain: true, results: [] });
    expect(await client.transferAction(lostTransfer)).toEqual(uncertainTransfer);
    await current.files.recover();
    await client.ackFileOperation(root);
    fault.exec("CREATE TRIGGER deny_result BEFORE INSERT ON client_recovery WHEN NEW.kind='fileCommands' AND json_extract(NEW.body,'$[#-1].result') IS NOT NULL BEGIN SELECT RAISE(ABORT,'result unavailable'); END");
    const lost = { ...command, commandId: "lost", name: "lost.txt" };
    await expect(client.createEntry(lost)).rejects.toThrow("result unavailable");
    expect(readFileSync(join(root, "lost.txt"), "utf8")).toBe("");
    fault.exec("DROP TRIGGER deny_result");
    expect(await client.createEntry(lost)).toMatchObject({ status: "uncertain" });
    expect(execFileSync("git", ["-C", root, "diff", "--cached"], { encoding: "utf8" })).toBe(staged);
    expect(execFileSync("git", ["-C", root, "show", ":staged.txt"], { encoding: "utf8" })).toBe("preexisting staged bytes");
  } finally {
    fault.close(); await client.close(); await host.close(); globalThis.WebSocket = socket;
     project.close(); await db.close(); rmSync(base, { recursive: true, force: true });
  }
});
