import { join } from "node:path";
import { stat } from "node:fs/promises";

// Opt-in actual SQLite load for packaged editor/command qualification.
export async function checkpointLoad(user: string, app: import("@playwright/test").ElectronApplication) {
  if (!process.env.ESCODE_CHECKPOINT_LOAD) return async () => {};
  let sequence = -1;
  const command = async (operation: string, fields: object) => app.evaluate((_, { operation, fields, id }) => new Promise<any>((resolve, reject) => {
        const worker = (globalThis as any).__hostStorageWorker;
        if (!worker) return reject(Error("Host storage worker not observed"));
        const receive = (reply: any) => {
          if (reply.id !== id) return;
          worker.off("message", receive);
          if (reply.error) reject(Error(reply.error)); else resolve(reply.value);
        };
        worker.on("message", receive);
        worker.postMessage({ id, operation, ...fields });
      }), { operation, fields, id: sequence-- });
  let stopped = false;
  const point = { chatId: "capacity-measurement", createdAt: 1, availability: "available", files: { a: { mode: 33188, content: "a".repeat(1024 * 1024) } } };
  let cycle = 0;
  let loaded!: () => void;
  const firstCycle = new Promise<void>(resolve => { loaded = resolve; });
  const run = (async () => {
    while (!stopped) {
      const start = performance.now();
      let count = 0;
      for (; count < 48 && !stopped; count++) {
        try { await command("checkpoint", { body: { ...point, id: `load-${cycle}-${count}` } }); }
        catch (error) { if (!String(error).includes("capacity exhausted")) throw error; break; }
      }
      const path = join(user, "durable-chats-v1.sqlite-state-v1/state.sqlite");
      const before = (await stat(path)).size;
      const reclaimed = await command("expireCheckpoints", { body: { now: Date.now() + 31 * 86400000, active: [] } });
      if (count || reclaimed || cycle === 0) console.log("#139 packaged checkpoint load", JSON.stringify({ cycle, count, reclaimed, ms: performance.now() - start, databaseBytes: before, walBytes: (await stat(path + "-wal")).size }));
      cycle++;
      loaded();
      // Protected recovery can prevent progress; avoid a no-progress busy loop.
      if (!count && !reclaimed) await new Promise(resolve => setTimeout(resolve, 100));
    }
  })();
  // Keep rejection observed until the caller joins and reports it.
  void run.catch(() => {});
  await Promise.race([firstCycle, run]);
  return async () => { stopped = true; await run; };
}
