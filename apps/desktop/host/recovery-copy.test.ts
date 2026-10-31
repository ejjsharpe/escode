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
    await chats.database.ready;
    const spool = join(dir, "spool");
    await new LiveSpool(spool).write("chat", "provider", [{ id: "body", turnId: "turn", type: "agentMessage", text: "output" }], false);
    const chunk = (await readdir(spool)).find(name => name.endsWith(".chunk"))!;
    await rm(join(spool, chunk));
    const result = await createRecoveryCopy(join(dir, "chats.sqlite-state-v1"), join(dir, "copy"), spool);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("spool/" + chunk);
  } finally { await chats.database.close(); await rm(dir, { recursive: true, force: true }); }
});
