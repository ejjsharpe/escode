import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chats } from "./chat";
import { createRecoveryCopy, recoverCopy } from "./recovery-copy";

test("consistent copy during writes preserves originals and quarantines recovered authority", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-copy-"));
  const chats = new Chats(join(dir, "chats"));
  try {
    const owner = await chats.database.ready;
    await chats.createDraft(null, "");
    const writing = (async () => { for (let i = 0; i < 12; i++) await chats.database.recoveryWrite("writer", "intent", { i }, i); })();
    const copy = await createRecoveryCopy(join(dir, "chats.sqlite-state-v1"), join(dir, "copy"), join(dir, "missing-spool"));
    await writing;
    expect(copy.complete).toBe(false);
    expect(copy.missing).toContain("live-spool-v1");
    await recoverCopy(join(dir, "copy"), join(dir, "recovered"), owner);
    const { DurableState } = await import("./durable-state");
    const recovered = new DurableState(join(dir, "recovered"));
    try { await expect(recovered.ready).rejects.toThrow("reconciliation"); }
    finally { await recovered.close(); }
    expect((await chats.database.read()).chats).toHaveLength(1);
    expect(await chats.database.ready).toEqual(owner);
    expect(await readFile(join(dir, "copy/manifest.json"), "utf8")).toContain(owner.hostId);
  } finally { await chats.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("tampered content and wrong recovered ownership are refused before creating state", async () => {
  const { writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "escode-copy-invalid-"));
  const chats = new Chats(join(dir, "chats"));
  try {
    const owner = await chats.database.ready;
    await createRecoveryCopy(join(dir, "chats.sqlite-state-v1"), join(dir, "copy"), join(dir, "spool"));
    await expect(recoverCopy(join(dir, "copy"), join(dir, "bad-owner"), { ...owner, hostId: "wrong" })).rejects.toThrow("owner");
    await writeFile(join(dir, "copy/state.sqlite"), "corrupted");
    await expect(recoverCopy(join(dir, "copy"), join(dir, "bad-content"), owner)).rejects.toThrow("checksum");
    expect((await chats.database.read()).chats).toEqual([]);
  } finally { await chats.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("reconciliation retains quarantine on provider uncertainty then rejects stale authenticated Send", async () => {
  const { reconcileRecovery } = await import("./recovery-copy");
  const { DurableState } = await import("./durable-state");
  const { DurableSend } = await import("./durable-send");
  const { startHost } = await import("@escode/host");
  const { createHostClient } = await import("@escode/client-runtime");
  const { default: WebSocket } = await import("ws");
  const { mkdir, writeFile, stat, realpath } = await import("node:fs/promises");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-copy-auth-")));
  const source = join(dir, "db");
  const db = new DurableState(source);
  let recovered: InstanceType<typeof DurableState> | undefined;
  const original = globalThis.WebSocket;
  let effects = 0;
  try {
    const owner = await db.ready;
    const info = await stat(dir);
    await db.write([{ id: "chat", project: null, checkout: dir, draft: "saved", threadId: "provider", directoryIdentity: { path: dir, dev: info.dev, ino: info.ino } }], 0);
    const sends = new DurableSend(db);
    const stale = { commandId: "not-in-copy", admissionEpoch: sends.admissionEpoch, project: null, id: "chat", expected: "state", text: "hello" };
    await mkdir(join(dir, "spool"));
    await createRecoveryCopy(source, join(dir, "copy"), join(dir, "spool"));
    await recoverCopy(join(dir, "copy"), join(dir, "recovered"), owner);
    expect((await reconcileRecovery(join(dir, "recovered"), owner, async () => false)).ready).toBe(false);
    await writeFile(join(dir, "external.txt"), "newer external work");
    expect((await reconcileRecovery(join(dir, "recovered"), owner, async thread => thread === "provider")).ready).toBe(true);
    recovered = new DurableState(join(dir, "recovered"));
    await recovered.ready;
    const next = new DurableSend(recovered);
    globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
    const host = await startHost({ ...owner, origin: "null", list: async () => ({ kind: "denied", message: "unused" }), sendMessage: command => next.execute(command, async () => { effects++; }) });
    const client = createHostClient(async () => host.bootstrap());
    try {
      await expect(client.sendMessage(stale)).rejects.toThrow("epoch");
      expect(effects).toBe(0);
      expect(await readFile(join(dir, "external.txt"), "utf8")).toBe("newer external work");
      expect((await client.sendMessage({ ...stale, commandId: "explicit-new", admissionEpoch: next.admissionEpoch })).status).toBe("accepted");
      expect(effects).toBe(1);
    } finally { await client.close(); await host.close(); }
  } finally { globalThis.WebSocket = original; await recovered?.close(); await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("missing referenced spool chunks are explicitly incomplete", async () => {
  const { LiveSpool } = await import("./live-spool");
  const { readdir } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "escode-copy-spool-"));
  const chats = new Chats(join(dir, "chats"));
  try {
    const owner = await chats.database.ready;
    const spool = join(dir, "spool");
    await new LiveSpool(spool).write("chat", "provider", [{ id: "body", turnId: "turn", type: "agentMessage", text: "output" }], false);
    const chunk = (await readdir(spool)).find(name => name.endsWith(".chunk"))!;
    await rm(join(spool, chunk));
    const result = await createRecoveryCopy(join(dir, "chats.sqlite-state-v1"), join(dir, "copy"), spool);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("spool/" + chunk);
    const { reconcileRecovery } = await import("./recovery-copy");
    await recoverCopy(join(dir, "copy"), join(dir, "recovered"), owner);
    expect((await reconcileRecovery(join(dir, "recovered"), owner, async () => true)).ready).toBe(false);
  } finally { await chats.database.close(); await rm(dir, { recursive: true, force: true }); }
});

 test("consistent copy retains unresolved SQLite receipts without an external journal", async () => {
  const { DurableSend } = await import("./durable-send");
  const { reconcileRecovery } = await import("./recovery-copy");
  const { mkdir } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "escode-copy-receipt-"));
  const chats = new Chats(join(dir, "chats"));
  try {
    const owner = await chats.database.ready;
    const chat = await chats.createDraft(null, "");
    const sends = new DurableSend(chats.database);
    await sends.execute({ commandId: "uncertain", admissionEpoch: sends.admissionEpoch, project: null, id: chat.id, expected: "state", text: "retained" }, async () => { throw Error("lost provider response"); });
    await mkdir(join(dir, "spool"));
    expect((await createRecoveryCopy(join(dir, "chats.sqlite-state-v1"), join(dir, "copy"), join(dir, "spool"))).complete).toBe(true);
    await recoverCopy(join(dir, "copy"), join(dir, "recovered"), owner);
    expect((await reconcileRecovery(join(dir, "recovered"), owner, async () => true)).issues).toContain("Unresolved SQLite submission evidence");
    expect((await sends.receipt("uncertain"))?.status).toBe("uncertain");
  } finally { await chats.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("retained checkpoint coverage reports missing required content instead of certifying the copy", async () => {
  const { mkdir } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "escode-copy-checkpoint-"));
  const chats = new Chats(join(dir, "chats"));
  try {
    await chats.database.ready;
    await mkdir(join(dir, "spool"));
    await chats.database.command("checkpoint", { body: { id: "missing", chatId: "chat", availability: "available", checkout: dir, gitBase: "0".repeat(40) } });
    const copy = await createRecoveryCopy(join(dir, "chats.sqlite-state-v1"), join(dir, "copy"), join(dir, "spool"));
    expect(copy.complete).toBe(false);
    expect(copy.missing).toContain("checkpoint/missing/files");
  } finally { await chats.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("copy includes concurrent captures and retained branch bytes, and refuses newer expiry or a lost exact Git base", async () => {
  const { mkdir, writeFile, stat, realpath } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  const { captureTurnCheckpoint } = await import("./checkpoints");
  const { reconcileRecovery } = await import("./recovery-copy");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-copy-git-")));
  const repo = join(dir, "repo");
  await mkdir(repo);
  const chats = new Chats(join(dir, "chats"));
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  try {
    const owner = await chats.database.ready;
    git("init");
    await writeFile(join(repo, "saved"), "base");
    git("add", "saved");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base");
    const info = await stat(repo);
    const chat = { ...await chats.createDraft(null, dir), project: repo, checkout: repo, directoryIdentity: { path: repo, dev: info.dev, ino: info.ino } };
    await chats.database.write([chat], (await chats.database.read()).revision);
    await writeFile(join(repo, "saved"), "captured");
    await captureTurnCheckpoint(chats.database, chat, null);
    const [point] = await chats.database.command("checkpoints", { commandId: chat.id });
    await chats.database.command("rewindWrite", { commandId: "branch", body: { checkpoint: point, result: { status: "applied" } } });
    await mkdir(join(dir, "spool"));
    const capturing = captureTurnCheckpoint(chats.database, chat, null);
    const copy = await createRecoveryCopy(join(dir, "chats.sqlite-state-v1"), join(dir, "copy"), join(dir, "spool"));
    await capturing;
    expect(copy.complete).toBe(true);
    expect(copy.checkpoints).toContainEqual(expect.objectContaining({ reference: "branch/branch", gitBase: git("rev-parse", "HEAD") }));
    await recoverCopy(join(dir, "copy"), join(dir, "recovered"), owner);
    await writeFile(join(repo, "saved"), "newer external work");
    expect((await reconcileRecovery(join(dir, "recovered"), owner, async () => true)).ready).toBe(true);
    await recoverCopy(join(dir, "copy"), join(dir, "expired"), owner);
    await chats.database.command("expireCheckpoints", { body: { now: Date.now() + 31 * 86400000, active: [] } });
    expect((await reconcileRecovery(join(dir, "expired"), owner, async () => true)).issues).toContain("Expired or retired original coverage: checkpoint/" + point.id);
    expect((await chats.database.command("rewindRead", { commandId: "branch" })).checkpoint.files.saved.content).toBe(Buffer.from("captured").toString("base64"));
    const preparing = chats.database.command("rewindWrite", { commandId: "preparing", body: { checkpoint: point, result: { status: "uncertain" } } });
    await preparing;
    const cleaning = chats.database.command("expireCheckpoints", { body: { now: Date.now() + 32 * 86400000, active: [] } });
    const duringCleanup = await createRecoveryCopy(join(dir, "chats.sqlite-state-v1"), join(dir, "cleanup-copy"), join(dir, "spool"));
    await Promise.all([preparing, cleaning]);
    expect(duringCleanup.complete).toBe(true);
    expect(duringCleanup.checkpoints).toContainEqual(expect.objectContaining({ reference: "checkpoint/" + point.id, availability: "unavailable" }));
    await recoverCopy(join(dir, "cleanup-copy"), join(dir, "cleanup-recovered"), owner);
    expect((await reconcileRecovery(join(dir, "cleanup-recovered"), owner, async () => true)).issues).toContain("Uncertain historical operation: preparing");
    await recoverCopy(join(dir, "copy"), join(dir, "lost-base"), owner);
    await rm(join(repo, ".git"), { recursive: true });
    expect((await reconcileRecovery(join(dir, "lost-base"), owner, async () => true)).issues).toContain("branch/branch/external-root-or-git-base");
    expect(await readFile(join(repo, "saved"), "utf8")).toBe("newer external work");
  } finally { await chats.database.close(); await rm(dir, { recursive: true, force: true }); }
}, 60000);
