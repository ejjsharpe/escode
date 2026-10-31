import { test, expect } from "vite-plus/test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { applyHistoricalFiles } from "./historical-files";

test.each([
  { mode: 0o100644, content: "YQ" },
  { mode: 0o100600, content: "YQ==" },
  { mode: 0o100644, content: Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64") },
])("malformed checkpoint content has zero filesystem or index effects", async file => {
  const root = await mkdtemp(join(tmpdir(), "escode-invalid-checkpoint-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "saved"), "original");
    execFileSync("git", ["-C", root, "add", "."]);
    const index = await readFile(join(root, ".git/index"));
    await expect(applyHistoricalFiles(root, { saved: { mode: 0o100644, content: "Yg==" }, later: file })).rejects.toThrow();
    expect(await readFile(join(root, "saved"), "utf8")).toBe("original");
    expect(await readFile(join(root, ".git/index"))).toEqual(index);
    await expect(readFile(join(root, "later"))).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
