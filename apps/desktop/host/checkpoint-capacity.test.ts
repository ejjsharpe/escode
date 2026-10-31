import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableState } from "./durable-state";

test("active checkpoints exhaust without eviction; expiry reclaims WAL and capacity while retaining branch copies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-capacity-"));
  const db = new DurableState(join(dir, "db"));
  const started = performance.now();
  try {
    await db.ready;
    const point = { id: "0", chatId: "active", createdAt: 1, availability: "available", files: { a: { mode: 33188, content: "a".repeat(1024 * 1024) } } };
    for (let n = 0; n < 47; n++) await db.command("checkpoint", { body: { ...point, id: String(n) } });
    await expect(db.command("checkpoint", { body: { ...point, id: "overflow" } })).rejects.toThrow("capacity exhausted");
    await db.command("checkpoint", { body: { id: "overflow", chatId: "active", createdAt: 1, availability: "unavailable", reason: "capacity exhausted" } });
    await db.command("rewindWrite", { commandId: "branch", body: { checkpoint: point, result: { status: "applied" } } });
    expect(await db.command("expireCheckpoints", { body: { now: 31 * 86400000, active: ["active"] } })).toBe(0);
    const before = (await stat(join(dir, "db", "state.sqlite"))).size;
    expect(await db.command("expireCheckpoints", { body: { now: 31 * 86400000, active: [] } })).toBe(47);
    expect((await db.command("rewindRead", { commandId: "branch" })).checkpoint.files.a.content).toBe(point.files.a.content);
    expect((await stat(join(dir, "db", "state.sqlite-wal"))).size).toBe(0);
    await db.command("checkpoint", { body: { ...point, id: "reused" } });
    const measured = { elapsedMs: performance.now() - started, databaseBytesBefore: before, databaseBytesAfter: (await stat(join(dir, "db", "state.sqlite"))).size };
    if (process.env.ESCODE_CAPACITY_REPORT) await writeFile(process.env.ESCODE_CAPACITY_REPORT, JSON.stringify(measured));
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("retained branch storage exhausts without replacing protected evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-branch-capacity-"));
  const db = new DurableState(join(dir, "db"));
  try {
    await db.ready;
    const body = { checkpoint: { files: { a: { content: "a".repeat(4 * 1024 * 1024) } } }, result: { status: "uncertain" } };
    for (let n = 0; n < 15; n++) await db.command("rewindWrite", { commandId: String(n), body });
    await expect(db.command("rewindWrite", { commandId: "overflow", body })).rejects.toThrow("capacity exhausted");
    expect((await db.command("rewindRead", { commandId: "0" })).result.status).toBe("uncertain");
    await db.command("rewindWrite", { commandId: "0", body: { ...body, result: { status: "applied" } } });
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("capture admits two concurrent Git scans and discloses excess without queueing", async () => {
  const { captureTurnCheckpoint } = await import("./checkpoints");
  const { execFileSync } = await import("node:child_process");
  const { writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "escode-capture-bound-"));
  const db = new DurableState(join(dir, "db"));
  try {
    execFileSync("git", ["init", dir]);
    execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "base"]);
    await writeFile(join(dir, ".gitignore"), "db*\n");
    await writeFile(join(dir, "saved"), "saved contents");
    const chat = { id: "chat", project: dir, checkout: dir, threadId: null, draft: "" };
    const results = await Promise.all([0, 1, 2].map(() => captureTurnCheckpoint(db, chat, null)));
    expect(results.filter(result => result === null)).toHaveLength(2);
    expect(results.filter(result => result?.includes("capture capacity exhausted"))).toHaveLength(1);
    expect((await db.command("checkpoints", { commandId: "chat" })).filter((p: any) => p.availability === "unavailable")).toHaveLength(1);
    for (let n = 0; n < 47; n++) await db.command("checkpoint", { body: { id: `fill-${n}`, chatId: "chat", createdAt: 1, availability: "available", files: { a: { content: "a".repeat(1024 * 1024) } } } });
    await writeFile(join(dir, "saved"), "a".repeat(2 * 1024 * 1024));
    expect(await captureTurnCheckpoint(db, chat, null)).toContain("storage capacity exhausted");
    expect((await db.command("checkpointPoints", { commandId: "chat", body: {} })).points.length).toBe(20);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("SQLite queued bytes reject excess work without changing protected drafts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-queue-bound-"));
  const db = new DurableState(join(dir, "db"));
  try {
    await db.ready;
    await db.write([{ id: "chat", project: null, checkout: dir, threadId: null, draft: "protected" }], 0);
    const jobs = Array.from({ length: 8 }, (_, n) => db.command("checkpoint", { body: { id: String(n), chatId: "active", createdAt: 1, availability: "available", files: { a: { content: "a".repeat(8 * 1024 * 1024) } } } }));
    const results = await Promise.allSettled(jobs);
    expect(results.some(r => r.status === "rejected" && String(r.reason).includes("queue capacity exhausted"))).toBe(true);
    expect((await db.read()).chats[0].draft).toBe("protected");
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});
