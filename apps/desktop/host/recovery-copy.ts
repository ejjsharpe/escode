import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, lstat, readFile, readdir, writeFile, copyFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { DurableIdentity } from "./durable-state";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function regular(file: string) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.()) throw Error("Invalid recovery file ownership/type");
  return readFile(file);
}
function validate(db: DatabaseSync, expected?: Pick<DurableIdentity, "hostId" | "clientId">) {
  if (db.prepare("PRAGMA user_version").get()!.user_version !== 3 || db.prepare("PRAGMA integrity_check").get()!.integrity_check !== "ok") throw Error("Unsupported or corrupt recovery copy");
  const rows = db.prepare("SELECT * FROM identity").all();
  const owner = rows[0];
  if (rows.length !== 1 || !owner || !/^[0-9a-f-]{36}$/.test(String(owner.hostId)) || !/^[0-9a-f-]{36}$/.test(String(owner.clientId)) || !Number.isSafeInteger(owner.revision) || (expected && (owner.hostId !== expected.hostId || owner.clientId !== expected.clientId))) throw Error("Recovery identity mismatch");
  for (const row of db.prepare("SELECT id, body FROM chats").all()) {
    const chat = JSON.parse(String(row.body));
    if (chat.id !== row.id || typeof chat.checkout !== "string" || typeof chat.draft !== "string" || !(chat.project === null || typeof chat.project === "string") || !(chat.threadId === null || typeof chat.threadId === "string")) throw Error("Invalid recovered chat identity");
  }
  for (const row of db.prepare("SELECT * FROM submissions").all()) {
    const receipt = JSON.parse(String(row.body));
    const association = JSON.parse(String(row.association));
    if (receipt.command?.commandId !== row.id || receipt.hostId !== owner.hostId || receipt.clientId !== owner.clientId || receipt.command.id !== association.id) throw Error("Invalid recovered command identity");
  }
  for (const row of db.prepare("SELECT * FROM client_recovery").all()) {
    if (!row.clientId || !["workspace", "intent", "fileCommands", "fileFacts", "approvals"].includes(String(row.kind)) || !Number.isSafeInteger(row.revision)) throw Error("Invalid recovered client ownership");
    JSON.parse(String(row.body));
  }
  return { hostId: String(owner.hostId), clientId: String(owner.clientId) };
}

// Administrative host utility; never exposed as a client-selected filesystem path.
export async function createRecoveryCopy(source: string, destination: string, spool: string) {
  await regular(source + ".established");
  await regular(join(source, "state.sqlite"));
  await mkdir(destination, { mode: 0o700 });
  const db = new DatabaseSync(join(source, "state.sqlite"), { readOnly: true });
  try { await backup(db, join(destination, "state.sqlite"), { rate: 16 }); }
  finally { db.close(); }
  const copied = new DatabaseSync(join(destination, "state.sqlite"), { readOnly: true });
  let owner;
  try { owner = validate(copied); } finally { copied.close(); }
  const files: Record<string, string> = { "state.sqlite": hash(await regular(join(destination, "state.sqlite"))) };
  const missing: string[] = [];
  await mkdir(join(destination, "spool"), { mode: 0o700 });
  try {
    const names = await readdir(spool);
    for (const name of names.filter(name => /^[a-f0-9]{64}\.index$/.test(name))) {
      const bytes = await regular(join(spool, name));
      const index = JSON.parse(bytes.toString());
      if (index.version !== 1 || typeof index.chatId !== "string" || typeof index.threadId !== "string" || !Array.isArray(index.items)) throw Error("Invalid spool index");
      for (const item of index.items) for (const chunk of item.chunks) {
        if (!/^[a-f0-9]{64}$/.test(chunk)) throw Error("Invalid spool reference");
        try {
          const content = await regular(join(spool, chunk + ".chunk"));
          if (hash(content) !== chunk) throw Error("Spool checksum mismatch");
          await writeFile(join(destination, "spool", chunk + ".chunk"), content, { mode: 0o600 });
          files["spool/" + chunk + ".chunk"] = chunk;
        } catch { missing.push("spool/" + chunk + ".chunk"); }
      }
      await writeFile(join(destination, "spool", name), bytes, { mode: 0o600 });
      files["spool/" + name] = hash(bytes);
    }
  } catch { missing.push("live-spool-v1"); }

  const manifest = { version: 1, ...owner, complete: missing.length === 0, missing, files,
    coverage: "SQLite consistent cut including command receipts; individually captured spool indexes/chunks; no provider history, project files or checkpoint content. Spool may be newer than SQLite." };
  await writeFile(join(destination, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
  return manifest;
}

export async function recoverCopy(source: string, destination: string, expected: Pick<DurableIdentity, "hostId" | "clientId">) {
  const manifest = JSON.parse((await regular(join(source, "manifest.json"))).toString());
  if (manifest.version !== 1 || manifest.hostId !== expected.hostId || manifest.clientId !== expected.clientId || !manifest.files || !Array.isArray(manifest.missing)) throw Error("Invalid recovery manifest/owner");
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (name !== "state.sqlite" && !/^spool\/[a-f0-9]{64}\.(chunk|index)$/.test(name)) throw Error("Invalid recovery content path");
    if (hash(await regular(join(source, name))) !== digest) throw Error("Recovery content checksum mismatch");
  }
  if (!manifest.files["state.sqlite"]) throw Error("Missing recovery database");
  const db = new DatabaseSync(join(source, "state.sqlite"), { readOnly: true });
  try { validate(db, expected); } finally { db.close(); }
  // Quarantine is established before any usable database can appear.
  await mkdir(destination, { mode: 0o700 });
  await writeFile(destination + ".recovery-pending", JSON.stringify(manifest), { mode: 0o600, flag: "wx" });
  await copyFile(join(source, "state.sqlite"), join(destination, "state.sqlite"), 1);
  if (hash(await regular(join(destination, "state.sqlite"))) !== manifest.files["state.sqlite"]) throw Error("Recovery source changed during copy");
  await writeFile(destination + ".established", "", { mode: 0o600, flag: "wx" });
  return manifest;
}

// Provider inspection must be read-only and confirm the exact retained thread/context.
export async function reconcileRecovery(directory: string, expected: Pick<DurableIdentity, "hostId" | "clientId">,
  inspectProvider: (threadId: string, checkout: string) => Promise<boolean>) {
  const { realpath, stat } = await import("node:fs/promises");
  const pending = await regular(directory + ".recovery-pending");
  const db = new DatabaseSync(join(directory, "state.sqlite"), { readOnly: true });
  const manifest = JSON.parse(pending.toString());
  const issues: string[] = [...manifest.missing.map((name: string) => "Incomplete content: " + name)];
  const files: { root: string; path: string; current: string | null; baseline: string }[] = [];
  try {
    validate(db, expected);
    for (const row of db.prepare("SELECT body FROM chats").all()) {
      const chat = JSON.parse(String(row.body));
      if (chat.checkout) {
        try {
          const path = await realpath(chat.checkout), info = await stat(path), identity = chat.directoryIdentity;
          if (!identity || path !== identity.path || info.dev !== identity.dev || info.ino !== identity.ino) throw Error("identity changed");
        } catch { issues.push("Unreconciled checkout: " + chat.checkout); }
      }
      if (chat.initialSend === "preparing" || chat.initialSend === "creating" || chat.worktree?.reservation?.error) issues.push("Uncertain preparation: " + chat.id);
      if (chat.threadId && !await inspectProvider(chat.threadId, chat.checkout)) issues.push("Uncertain provider context: " + chat.id);
    }
    for (const row of db.prepare("SELECT kind, body FROM client_recovery").all()) {
      const body = JSON.parse(String(row.body));
      if (row.kind === "intent" && body) issues.push("File intent requires explicit external reconciliation");
      if (row.kind === "fileFacts" && body?.length) issues.push("File facts require explicit reconciliation");
      if (row.kind === "fileCommands" && body.some((record: { result?: unknown }) => record.result === undefined)) issues.push("Uncertain file command");
      if (row.kind === "approvals") {
        for (const approval of body) {
          try {
            const info = await stat(approval.root);
            if (await realpath(approval.root) !== approval.root || `${info.dev}:${info.ino}` !== approval.directoryIdentity) throw Error("changed approval");
          } catch { issues.push("Unreconciled approved root: " + approval.root); }
        }
      }
      if (row.kind === "workspace") {
        for (const project of [...(body.projects ?? []), ...(body.savedProjects ?? [])]) {
          try { if (await realpath(project.root) !== project.root) throw Error("changed root"); }
          catch { issues.push("Unavailable saved root: " + project.root); }
        }
        for (const draft of body.drafts ?? []) {
          const { isAbsolute, relative } = await import("node:path");
          if (typeof draft.path !== "string" || isAbsolute(draft.path) || draft.path.split("/").includes("..")) throw Error("Invalid recovered draft path");
          let current: string | null = null;
          try {
            const target = await realpath(join(draft.root, draft.path));
            if (relative(await realpath(draft.root), target).startsWith("..")) throw Error("Escaped recovered root");
            current = hash(await regular(target));
          } catch { /* Missing/currently unavailable files retain their saved baseline. */ }
          files.push({ root: draft.root, path: draft.path, current, baseline: draft.disk.version });
        }
      }
    }
    if (db.prepare("SELECT body FROM submissions").all().some(row => ["admitted", "dispatching", "uncertain"].includes(JSON.parse(String(row.body)).status))) issues.push("Unresolved SQLite submission evidence");
    if (db.prepare("SELECT count(*) AS n FROM preparation_results").get()!.n !== 0) issues.push("Uncertain preparation result");
  } finally { db.close(); }
  const report = { ready: issues.length === 0, issues, files, message: "Current disk hashes are observations; recovered edits and baselines remain unchanged. No provider work was resumed." };
  await writeFile(directory + ".reconciliation.json", JSON.stringify(report, null, 2), { mode: 0o600 });
  if (report.ready) {
    if (!(await regular(directory + ".recovery-pending")).equals(pending)) throw Error("Recovery changed during reconciliation");
    await unlink(directory + ".recovery-pending");
  }
  return report;
}
