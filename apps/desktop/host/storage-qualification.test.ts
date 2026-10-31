import { test, expect } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DurableState } from "./durable-state";
import { DurableSend } from "./durable-send";

test.skipIf(!process.env.ESCODE_FULL_VOLUME)("real exhausted disposable filesystem fails closed and retains emergency cancellation", async () => {
  const dir = await mkdtemp(join(process.env.ESCODE_FULL_VOLUME!, "qualification-"));
  const db = new DurableState(join(dir, "db"));
  try {
    const owner = await db.ready;
    await db.write([{ id: "chat", project: null, checkout: dir, draft: "retained", threadId: null }], 0);
    let full = false;
    for (let i = 0; i < 100; i++) {
      try { await writeFile(join(dir, "fill-" + i), Buffer.alloc(1024 * 1024)); }
      catch (error) { expect((error as NodeJS.ErrnoException).code).toBe("ENOSPC"); full = true; break; }
    }
    expect(full).toBe(true);
    for (let i = 0; i < 512; i++) {
      try { await writeFile(join(dir, "tail-" + i), Buffer.alloc(4096)); }
      catch (error) { expect((error as NodeJS.ErrnoException).code).toBe("ENOSPC"); break; }
    }
    await expect(db.recoveryWrite(owner.clientId, "workspace", { text: "x".repeat(8 * 1024 * 1024) }, 0)).rejects.toThrow(/full/);
    const sends = new DurableSend(db);
    let effects = 0;
    const command = { commandId: "stop", admissionEpoch: sends.admissionEpoch, project: null, id: "chat", expected: "state", text: "x".repeat(90000), control: { operation: "stop" as const, target: "captured", token: "token", answer: null } };
    expect((await sends.execute(command, async () => { effects++; })).reason).toBe("emergency-stop-available");
    expect(effects).toBe(0);
    expect((await sends.execute({ ...command, control: { ...command.control, emergency: true } }, async () => { effects++; })).status).toBe("uncertain");
    expect(effects).toBe(1);
    expect((await db.read()).chats[0].draft).toBe("retained");
    console.log("#127 real ENOSPC", owner.hostId, "retained identity and draft; cancellation count", effects);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test.skipIf(!process.env.ESCODE_READ_ONLY_PROVIDER)("installed saved provider recovery inspection performs only reads", async () => {
  const { connectCodex } = await import("./tools");
  const { inspectRecoveryProvider } = await import("./recovery-provider");
  const rpc = await connectCodex(process.cwd(), () => {}, () => {});
  try {
    const account = await rpc.request("account/read", { refreshToken: false }) as { account?: unknown };
    expect(!!account.account).toBe(true);
    const list = await rpc.request("thread/list", { limit: 1 }) as { data: { id: string; cwd: string }[] };
    expect(list.data.length).toBeGreaterThan(0);
    const thread = list.data[0];
    expect(await inspectRecoveryProvider(thread.id, thread.cwd)).toBe(true);
    console.log("#127 live read-only provider", JSON.stringify({ threadId: thread.id, checkout: thread.cwd, authenticated: true, inspected: true }));
  } finally { rpc.close(); await rpc.finished; }
});
