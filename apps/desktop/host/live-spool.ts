import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Schema } from "effect";
import { HistoryItem } from "@escode/contracts";

const Index = Schema.Struct({ version: Schema.Literal(1), chatId: Schema.String, threadId: Schema.String,
  items: Schema.Array(Schema.Struct({ item: HistoryItem, chunks: Schema.Array(Schema.String) })), partial: Schema.Boolean });
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
// No live chunks are evicted to admit work. Quota exhaustion retains the indexed output and provider control.
export class LiveSpool {
  constructor(private directory: string, private quota = 64 * 1024 * 1024) {}
  private sync(path: string) { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
  private atomic(path: string, text: string) {
    writeFileSync(path + ".tmp", text, { mode: 0o600 }); this.sync(path + ".tmp");
    renameSync(path + ".tmp", path); this.sync(this.directory);
  }
  read(chatId: string, threadId: string) {
    const path = join(this.directory, digest(chatId) + ".index");
    if (!existsSync(path)) return undefined;
    if (statSync(path).size > 160 * 1024) throw Error("Live index exceeds capacity");
    const record = Schema.decodeUnknownSync(Index)(JSON.parse(readFileSync(path, "utf8")));
    if (record.chatId !== chatId || record.threadId !== threadId) throw Error("Live spool identity mismatch");
    let bytes = 0;
    const items = record.items.map(({ item, chunks }) => {
      const parts = chunks.map(hash => {
        if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("Invalid live chunk reference");
        const path = join(this.directory, hash + ".chunk");
        if (statSync(path).size > 24 * 1024) throw Error("Live chunk exceeds capacity");
        const text = readFileSync(path, "utf8");
        bytes += Buffer.byteLength(text);
        if (bytes > 128 * 1024 || digest(text) !== hash) throw Error("Incomplete or oversized live spool");
        return JSON.parse(text) as string;
      });
      return { ...item, text: parts.join("") };
    });
    if (Buffer.byteLength(JSON.stringify(items)) > 128 * 1024 || items.length > 1000) throw Error("Live cache exceeds capacity");
    return { items, partial: record.partial };
  }
  write(chatId: string, threadId: string, items: readonly typeof HistoryItem.Type[], partial: boolean) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    // Interrupted unpublished writes are safe to remove; indexed missing/corrupt chunks remain visibly unavailable.
    for (const name of readdirSync(this.directory)) if (name.endsWith(".tmp")) unlinkSync(join(this.directory, name));
    let used = readdirSync(this.directory).reduce((sum, name) => sum + statSync(join(this.directory, name)).size, 0);
    const write = (path: string, text: string) => {
      const bytes = Buffer.byteLength(text);
      if (used + bytes > this.quota) throw Error("Live spool quota exhausted");
      this.atomic(path, text); used += bytes;
    };
    const entries = items.map(item => {
      const chunks: string[] = [];
      // Fixed text segments reuse earlier immutable prefixes as an active body grows.
      for (let offset = 0; offset < item.text.length; offset += 4096) {
        const text = JSON.stringify(item.text.slice(offset, offset + 4096));
        const hash = digest(text), path = join(this.directory, hash + ".chunk");
        if (!existsSync(path)) write(path, text);
        chunks.push(hash);
      }
      return { item: { ...item, text: "" }, chunks };
    });
    const index = JSON.stringify({ version: 1, chatId, threadId, items: entries, partial });
    if (Buffer.byteLength(index) > 160 * 1024) throw Error("Live index exceeds capacity");
    write(join(this.directory, digest(chatId) + ".index"), index);
  }
}
