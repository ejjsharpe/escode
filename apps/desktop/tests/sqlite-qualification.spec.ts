import { checkpointLoad } from "./checkpoint-load";
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

 test("packaged editing and Save baseline and loaded-store followup", async () => {
  const { execFileSync } = await import("node:child_process");
  const { writeFile, readFile, realpath } = await import("node:fs/promises");
  const { Chats } = await import("../host/chat");
  const { emptyWorkspace } = await import("../host/workspace");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-latency-")));
  const root = join(dir, "repo"), user = join(dir, "user");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "initial");
  const app = await launchDesktop(user, undefined, true);
  try {
    const page = await app.firstWindow();
    await app.evaluate(() => {
      const { Worker } = process.getBuiltinModule("node:worker_threads");
      const native = process.getBuiltinModule("node:child_process");
      const exec = native.execFileSync;
      (globalThis as any).__nativeTimings = [];
      native.execFileSync = (function (this: any, ...args: any[]) {
        const start = performance.now();
        try { return (exec as any).apply(this, args); }
        finally { (globalThis as any).__nativeTimings.push({ operation: args[1]?.[0], ms: performance.now() - start }); }
      }) as typeof exec;
      const original = Worker.prototype.postMessage;
      const samples: { operation: string; ms: number }[] = [];
      (globalThis as any).__storageTimings = samples;
      Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
        if (message.operation === "recoveryRead" || message.operation === "recoveryWrite") (globalThis as any).__hostStorageWorker = this;
        const start = performance.now();
        const listener = (reply: any) => {
          if (reply.id !== message.id) return;
          this.off("message", listener);
          samples.push({ operation: message.operation, ms: performance.now() - start });
        };
        this.on("message", listener);
        return original.call(this, message, ...rest);
      };
    });
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    const stopLoad = await checkpointLoad(user, app);
    try {
    for (const phase of ["baseline", "followup"]) {
      if (phase === "followup") {
        const db = new Chats(join(user, "durable-chats-v1"));
        try { for (let i = 0; i < 32; i++) await db.database.recoveryWrite("measurement-" + i, "workspace", { ...emptyWorkspace(), measurement: "x".repeat(65536) }, 0); }
        finally { await db.database.close(); }
      }
      const start = performance.now();
      await page.locator(".monaco-editor:visible").click();
      await page.keyboard.press("Meta+a");
      await page.keyboard.type(phase);
      await expect(page.locator(".monaco-editor:visible")).toContainText(phase);
      const editMs = performance.now() - start, saveStart = performance.now();
      // Observe completion in the renderer so assertion polling is reported separately.
      await page.getByRole("button", { name: "Save ⌘S", exact: true }).evaluate(button => {
        const measurement = { start: 0, complete: 0 };
        (window as any).__saveMeasurement = measurement;
        button.addEventListener("click", () => { measurement.start = performance.now(); }, { once: true });
        const observer = new MutationObserver(() => {
          if (measurement.start && !(button as HTMLButtonElement).disabled) {
            measurement.complete = performance.now();
            observer.disconnect();
          }
        });
        observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
      });
      await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
      await expect.poll(() => readFile(join(root, "a.txt"), "utf8")).toBe(phase);
      await expect(page.getByRole("button", { name: "Save ⌘S", exact: true })).toBeEnabled();
      const saveMs = performance.now() - saveStart;
      const rendererSaveMs = await page.evaluate(() => {
        const m = (window as any).__saveMeasurement;
        return m.complete - m.start;
      });
      expect(rendererSaveMs).toBeGreaterThan(0);
      console.log("#127 packaged editing/Save ms", JSON.stringify({ phase, editMs, saveMs, rendererSaveMs }));
    }
    } finally {
      await stopLoad();
      console.log("#139 native helper timings", JSON.stringify(await app.evaluate(() => (globalThis as any).__nativeTimings.sort((a: any, b: any) => b.ms - a.ms).slice(0, 10))));
      console.log("#139 app worker slowest requests", JSON.stringify(await app.evaluate(() =>
        (globalThis as any).__storageTimings.sort((a: any, b: any) => b.ms - a.ms).slice(0, 10))));
    }
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await rm(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
