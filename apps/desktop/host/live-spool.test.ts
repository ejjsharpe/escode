import { test, expect } from "vite-plus/test";
import { mkdtemp, readdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveSpool } from "./live-spool";

test("durable chunks retain exact binding through partial writes, corruption and quota exhaustion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-spool-"));
  const spool = new LiveSpool(dir, 20000);
  const item = { id: "body", turnId: "turn", type: "agentMessage", text: "a".repeat(5000) + "😀" };
  try {
    spool.write("chat", "provider", [item], false);
    expect(spool.read("chat", "provider")?.items).toEqual([item]);
    expect(() => spool.read("chat", "other-provider")).toThrow("identity mismatch");
    expect(spool.read("other-chat", "provider")).toBeUndefined();
    await writeFile(join(dir, "interrupted.tmp"), "partial");
    spool.write("chat", "provider", [{ ...item, text: item.text + "tail" }], false);
    expect(await readdir(dir)).not.toContain("interrupted.tmp");
    const bounded = new LiveSpool(dir, 1);
    expect(() => bounded.write("chat", "provider", [item], false)).toThrow("quota");
    expect(spool.read("chat", "provider")?.items[0].text).toBe(item.text + "tail");
    const index = (await readdir(dir)).find(name => name.endsWith(".index"))!;
    const record = JSON.parse(await readFile(join(dir, index), "utf8"));
    await writeFile(join(dir, record.items[0].chunks[0] + ".chunk"), "corrupt");
    expect(() => spool.read("chat", "provider")).toThrow("Incomplete");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
