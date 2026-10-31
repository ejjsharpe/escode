import { Chats } from "../host/chat";
import { join } from "node:path";
import { stat } from "node:fs/promises";

// Opt-in actual SQLite load for packaged editor/command qualification.
export async function checkpointLoad(user: string) {
  if (!process.env.ESCODE_CHECKPOINT_LOAD) return async () => {};
  const store = new Chats(join(user, "durable-chats-v1"));
  let stopped = false;
  const point = { chatId: "capacity-measurement", createdAt: 1, availability: "available", files: { a: { mode: 33188, content: "a".repeat(1024 * 1024) } } };
  let cycle = 0;
  const run = (async () => {
    while (!stopped) {
      const start = performance.now();
      let count = 0;
      for (; count < 48 && !stopped; count++) {
        try { await store.database.command("checkpoint", { body: { ...point, id: `load-${cycle}-${count}` } }); }
        catch (error) { if (!String(error).includes("capacity exhausted")) throw error; break; }
      }
      const path = join(user, "durable-chats-v1.sqlite-state-v1/state.sqlite");
      const before = (await stat(path)).size;
      const reclaimed = await store.database.command("expireCheckpoints", { body: { now: Date.now() + 31 * 86400000, active: [] } });
      if (count || reclaimed || cycle === 0) console.log("#139 packaged checkpoint load", JSON.stringify({ cycle, count, reclaimed, ms: performance.now() - start, databaseBytes: before, walBytes: (await stat(path + "-wal")).size }));
      cycle++;
    }
  })();
  // Keep rejection observed until the caller joins and reports it.
  void run.catch(() => {});
  return async () => { stopped = true; try { await run; } finally { await store.database.close(); } };
}
