// Diagnostic only: run from repository root with Bun; no installed packages required.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir, cpus, totalmem } from "node:os";
import { join } from "node:path";
import { Chats } from "../../../apps/desktop/host/chat";
import { ChatService } from "../../../apps/desktop/host/chat-service";
import { Project } from "../../../apps/desktop/host/project";

const root = realpathSync(mkdtempSync(join(tmpdir(), "escode-foundation-")));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const results: any[] = [];
const source = await Bun.file("apps/desktop/src/chat-state.ts").text();
assert(source.includes('import { useSyncExternalStore } from "react";'));
// Execute the actual store, replacing only its React hook adapter; this measures no React work.
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(source.replace(
  'import { useSyncExternalStore } from "react";',
  'const useSyncExternalStore = (_subscribe: unknown, snapshot: () => unknown) => snapshot();',
));
const { useProjectChats } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
try {
  for (const [name, count, items, subscribers] of [
    ["idle-empty", 0, 0, 1], ["idle-one", 1, 0, 1],
    ["background-25", 25, 0, 25], ["long-stream", 1, 2000, 1],
  ] as const) {
    for (let repeat = 0; repeat < 3; repeat++) {
      const project = join(root, `${name}-${repeat}`);
      mkdirSync(project);
      const records = Array.from({ length: count }, (_, i) => ({
        id: `${i}`, project, checkout: project, threadId: null, draft: "",
      }));
      const file = join(project, "chats.json");
      writeFileSync(file, JSON.stringify(records));
      const saved = new Chats(file);
      const service = new ChatService(saved);
      let reads = 0;
      const list = saved.list.bind(saved);
      saved.list = (...args) => { reads++; return list(...args); };
      if (items) {
        const session = (service as any).session(project, "0");
        session.threadId = "thread"; session.turnId = "turn"; session.busy = true;
        session.items = Array.from({ length: items }, (_, i) => ({
          id: `${i}`, turnId: "turn", type: "agentMessage", text: "x".repeat(1000),
        }));
      }
      let calls = 0, payload = 0, notifications = 0;
      const latency: number[] = [];
      (globalThis as any).window = { escode: { chat: async (op: string, p: string, id: string) => {
        calls++;
        const start = performance.now();
        let value;
        if (op === "list") value = await service.list(p);
        else {
          assert.equal(op, "snapshot");
          // main.ts checks list membership before inspect. Sender/approval checks are excluded.
          assert((await service.list(p)).some((c) => c.id === id));
          value = await service.inspect(p, id);
        }
        latency.push(performance.now() - start);
        payload += bytes(value);
        return value;
      } } };
      const [store] = useProjectChats(project);
      const releases = Array.from({ length: subscribers }, () => store.subscribe(() => notifications++));
      await store.load(); await store.refresh();
      // subscribe also starts an asynchronous load; exclude its completion from the window.
      await wait(50);
      calls = payload = notifications = reads = 0; latency.length = 0;
      Bun.gc(true);
      const heapBefore = process.memoryUsage().heapUsed;
      const start = performance.now();
      const streaming = items ? setInterval(() => (service as any).event(
        (service as any).sessions.get("0"),
        { method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn", itemId: "1999", delta: "y".repeat(100) } },
      ), 20) : undefined;
      await wait(2100);
      if (streaming) clearInterval(streaming);
      // Freeze the sample window, then drain while listeners are still attached.
      clearInterval((store as any).timer);
      while ((store as any).polling) await wait(10);
      releases.forEach((release: () => void) => release());
      const elapsedMs = performance.now() - start;
      Bun.gc(true);
      const heapDelta = process.memoryUsage().heapUsed - heapBefore;
      const after = calls; await wait(350); assert.equal(calls, after, "last unsubscribe must stop polling");
      assert.equal(calls, latency.length, "all counted calls must complete inside the window");
      assert.equal(notifications, latency.length * subscribers);
      latency.sort((a, b) => a - b);
      results.push({ name, repeat, elapsedMs, calls, payload, notifications, reads,
        medianMs: latency[Math.floor(latency.length / 2)] ?? null,
        maxMs: latency.at(-1) ?? null, heapDelta });
    }
  }
  const helper = join(root, "filesystem");
  execFileSync("clang", ["-std=c11", "-framework", "CoreServices", "-Wall", "-Wextra", "-Werror", "-O2", "apps/desktop/host/filesystem.c", "-o", helper]);
  const repo = join(root, "repo"); mkdirSync(repo);
  execFileSync("git", ["init", "-q", repo]);
  for (let i = 0; i < 100; i++) writeFileSync(join(repo, `${i}.txt`), "disk");
  const p = await Project.open(repo, helper);
  try {
    let helpers = 0, git = 0;
    const io = (p as any).io.bind(p);
    (p as any).io = (args: string[], input?: string) => { helpers++; if (args[0] === "git") git++; return io(args, input); };
    for (const op of ["files", "status"] as const) {
      for (let repeat = 0; repeat < 3; repeat++) {
        helpers = git = 0; const start = performance.now();
        const value = await p[op]();
        results.push({ name: op, repeat, elapsedMs: performance.now() - start, helpers, git, payload: bytes(value) });
      }
    }
    for (let repeat = 0; repeat < 3; repeat++) {
      let notifications = 0;
      const release = p.watchFiles([""], (error) => { assert.equal(error, undefined); notifications++; });
      const second = p.watchFiles([""], (error) => assert.equal(error, undefined));
      assert.equal((p as any).watches.size, 1);
      const start = performance.now();
      for (let i = 0; i < 20; i++) writeFileSync(join(repo, `${i}.txt`), `burst-${repeat}`);
      while (!notifications && performance.now() - start < 5000) await wait(10);
      assert(notifications > 0, "native watch must notify");
      const firstMs = performance.now() - start;
      await wait(250);
      release(); assert.equal((p as any).watches.size, 1);
      second(); assert.equal((p as any).watches.size, 0);
      results.push({ name: "watch-burst", repeat, firstMs, notifications, finalWatchers: (p as any).watches.size });
    }
  } finally { p.close(); }
  console.log(JSON.stringify({ environment: { date: new Date().toISOString(), bun: Bun.version,
    node: process.version, arch: process.arch, cpu: cpus()[0].model, totalmem: totalmem(),
    git: execFileSync("git", ["--version"], { encoding: "utf8" }).trim(),
    os: execFileSync("sw_vers", [], { encoding: "utf8" }).trim() }, results }, null, 2));
} finally { rmSync(root, { recursive: true, force: true }); }
