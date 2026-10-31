import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Schema } from "effect";
import { HistoryItem } from "@escode/contracts";

const Index = Schema.Struct({ version: Schema.Literal(1), chatId: Schema.String, threadId: Schema.String,
  items: Schema.Array(Schema.Struct({ item: HistoryItem, chunks: Schema.Array(Schema.String) })), partial: Schema.Boolean });
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
// No live chunks are evicted to admit work. Quota exhaustion retains the indexed output and provider control.
export class LiveSpool {
  private queuedBytes = 0;
  private queued = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string, private quota = 64 * 1024 * 1024) {}
  private async sync(path: string) { const fd = await open(path, "r"); try { await fd.sync(); } finally { await fd.close(); } }
  private async atomic(path: string, text: string) {
    await writeFile(path + ".tmp", text, { mode: 0o600 }); await this.sync(path + ".tmp");
    await rename(path + ".tmp", path); await this.sync(this.directory);
  }
  async read(chatId: string, threadId: string) {
    const path = join(this.directory, digest(chatId) + ".index");
    let size: number;
    try { size = (await stat(path)).size; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    if (size > 160 * 1024) throw Error("Live index exceeds capacity");
    const record = Schema.decodeUnknownSync(Index)(JSON.parse(await readFile(path, "utf8")));
    if (record.chatId !== chatId || record.threadId !== threadId) throw Error("Live spool identity mismatch");
    let bytes = 0;
    if (record.items.length > 1000) throw Error("Live cache exceeds capacity");
    const items: typeof HistoryItem.Type[] = [];
    for (const { item, chunks } of record.items) {
      const parts = [];
      for (const hash of chunks) {
        if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("Invalid live chunk reference");
        const path = join(this.directory, hash + ".chunk");
        if ((await stat(path)).size > 24 * 1024) throw Error("Live chunk exceeds capacity");
        const text = await readFile(path, "utf8");
        bytes += Buffer.byteLength(text);
        if (bytes > 128 * 1024 || digest(text) !== hash) throw Error("Incomplete or oversized live spool");
        const value: unknown = JSON.parse(text);
        if (typeof value !== "string") throw Error("Invalid live chunk body");
        parts.push(value);
      }
      items.push({ ...item, text: parts.join("") });
    }
    if (Buffer.byteLength(JSON.stringify(items)) > 128 * 1024 || items.length > 1000) throw Error("Live cache exceeds capacity");
    return { items, partial: record.partial };
  }
  write(chatId: string, threadId: string, items: readonly typeof HistoryItem.Type[], partial: boolean) {
    const bytes = Buffer.byteLength(JSON.stringify([chatId, threadId, items, partial]));
    if (this.queued >= 64 || this.queuedBytes + bytes > 8 * 1024 * 1024) return Promise.reject(Error("Live spool queue capacity exhausted"));
    const captured = structuredClone(items);
    this.queued++; this.queuedBytes += bytes;
    const task = this.queue.then(() => this.persist(chatId, threadId, captured, partial)).finally(() => { this.queued--; this.queuedBytes -= bytes; });
    this.queue = task.catch(() => {});
    return task;
  }
  private async persist(chatId: string, threadId: string, items: readonly typeof HistoryItem.Type[], partial: boolean) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // Interrupted unpublished writes are safe to remove; indexed missing/corrupt chunks remain visibly unavailable.
    for (const name of await readdir(this.directory)) if (name.endsWith(".tmp")) await unlink(join(this.directory, name));
    let used = 0;
    for (const name of await readdir(this.directory)) used += (await stat(join(this.directory, name))).size;
    const write = async (path: string, text: string) => {
      const bytes = Buffer.byteLength(text);
      if (used + bytes > this.quota) throw Error("Live spool quota exhausted");
      await this.atomic(path, text); used += bytes;
    };
    const entries = [];
    for (const item of items) {
      const chunks: string[] = [];
      // Fixed text segments reuse earlier immutable prefixes as an active body grows.
      for (let offset = 0; offset < item.text.length; offset += 4096) {
        const text = JSON.stringify(item.text.slice(offset, offset + 4096));
        const hash = digest(text), path = join(this.directory, hash + ".chunk");
        try { await stat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await write(path, text); }
        chunks.push(hash);
      }
      entries.push({ item: { ...item, text: "" }, chunks });
    }
    const index = JSON.stringify({ version: 1, chatId, threadId, items: entries, partial });
    if (Buffer.byteLength(index) > 160 * 1024) throw Error("Live index exceeds capacity");
    await write(join(this.directory, digest(chatId) + ".index"), index);
  }
}
