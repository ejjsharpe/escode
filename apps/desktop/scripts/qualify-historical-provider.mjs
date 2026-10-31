// Opt-in installed-provider qualification: creates two read-only paid turns and retained fixture threads.
// Run with node apps/desktop/scripts/qualify-historical-provider.mjs; never reads existing user threads.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const cwd = await mkdtemp(tmpdir() + "/escode-141-provider-");
const child = spawn("codex", ["app-server"], { cwd, stdio: ["pipe", "pipe", "ignore"] });
let seq = 0;
const pending = new Map();
const done = new Map();
createInterface({ input: child.stdout }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.id !== undefined) {
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.error) p.reject(Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  }
  if (m.method === "turn/completed") done.set(m.params.turn.id, m.params.turn.status);
});
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
const timeout = setTimeout(() => {
  console.error("Provider qualification timed out after 180s");
  child.kill();
  process.exitCode = 1;
}, 180000);
try {
  await call("initialize", {
    clientInfo: { name: "escode_141_qualification", version: "1" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const source = await call("thread/start", {
    cwd,
    sandbox: "read-only",
    approvalPolicy: "never",
    persistExtendedHistory: true,
  });
  const id = source.thread.id;
  const turns = [];
  for (const text of [
    "Remember marker ESCODE_FIRST_141. Reply exactly FIRST. Do not use tools.",
    "Remember marker ESCODE_LATER_141. Reply exactly LATER. Do not use tools.",
  ]) {
    const r = await call("turn/start", { threadId: id, input: [{ type: "text", text }] });
    turns.push(r.turn.id);
    while (!done.has(r.turn.id)) await new Promise((r) => setTimeout(r, 100));
    assert.equal(done.get(r.turn.id), "completed");
  }
  const original = await call("thread/read", { threadId: id, includeTurns: true });
  const fork = await call("thread/fork", {
    threadId: id,
    lastTurnId: turns[0],
    cwd,
    sandbox: "read-only",
    approvalPolicy: "never",
    persistExtendedHistory: true,
  });
  const historical = await call("thread/read", { threadId: fork.thread.id, includeTurns: true });
  assert.deepEqual(
    historical.thread.turns.map((t) => t.id),
    [turns[0]],
  );
  assert.deepEqual(historical.thread.turns, original.thread.turns.slice(0, 1));
  const after = await call("thread/fork", {
    threadId: id,
    lastTurnId: turns[1],
    cwd,
    sandbox: "read-only",
    approvalPolicy: "never",
    persistExtendedHistory: true,
  });
  const complete = await call("thread/read", { threadId: after.thread.id, includeTurns: true });
  assert.deepEqual(complete.thread.turns, original.thread.turns);
  await assert.rejects(
    call("thread/read", { threadId: "00000000-0000-0000-0000-000000000000", includeTurns: true }),
  );
  const unchanged = await call("thread/read", { threadId: id, includeTurns: true });
  assert.deepEqual(unchanged.thread.turns, original.thread.turns);
  console.log(
    JSON.stringify({
      source: id,
      fork: fork.thread.id,
      sourceTurns: original.thread.turns.map((t) => t.id),
      historicalTurns: historical.thread.turns.map((t) => t.id),
      nativeContext:
        "provider persisted first turn retained; later turn excluded; source unchanged; no fork turn started",
    }),
  );
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  child.kill();
  await rm(cwd, { recursive: true, force: true });
}
