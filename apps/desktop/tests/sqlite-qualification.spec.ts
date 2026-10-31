import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";
test("packaged worker durability readback and recovery write measurement", async () => {
  const user = await mkdtemp(join(tmpdir(), "escode-127-"));
  const runtime = await launchDesktop(user, undefined, true);
  try {
    await runtime.firstWindow();
    const evidence = await runtime.evaluate(async ({ app }, user) => {
      const { Worker } = process.getBuiltinModule("node:worker_threads");
      const { join } = process.getBuiltinModule("node:path");
      const { readdirSync, statSync } = process.getBuiltinModule("node:fs");
      const directory = join(user, "measurement");
      const worker = new Worker(join(app.getAppPath(), "dist/host/sqlite-worker.cjs"), { workerData: directory });
      const receive = () => new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Worker response timeout")), 5000);
        worker.once("error", reject);
        worker.once("message", (m: any) => { clearTimeout(timer); m.error ? reject(Error(m.error)) : resolve(m.value); });
      });
      try {
        const identity = await receive();
        const size = () => readdirSync(directory).reduce((n: number, name: string) => n + statSync(join(directory, name)).size, 0);
        const before = size(), times: number[] = [];
        for (let revision = 0; revision < 100; revision++) {
          const pending = receive(), start = performance.now();
          worker.postMessage({ id: revision + 1, operation: "recoveryWrite", clientId: identity.clientId, kind: "workspace", revision, body: { text: "x".repeat(4096) } });
          await pending;
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return { settings: identity.settings, before, after: size(), samples: 100, medianMs: times[50], p95Ms: times[95], maxMs: times[99] };
      } finally { await worker.terminate(); }
    }, user);
    expect(evidence.settings).toEqual({ journalMode: "wal", synchronous: 1, checkpointFullfsync: 1 });
    console.log("#127 packaged evidence", JSON.stringify(evidence));
  } finally { await runtime.evaluate(({ app }) => app.exit(0)).catch(() => {}); await rm(user, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
