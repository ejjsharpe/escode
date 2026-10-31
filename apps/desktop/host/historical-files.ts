import { lstat, mkdir, unlink, writeFile, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

// Only called in a newly reserved managed checkout; never write through Git-base symlinks.
export async function applyHistoricalFiles(root: string, files: Record<string, { mode: number; content: string } | null>) {
  if (Object.keys(files).length > 10000) throw Error("Historical file capacity exhausted");
  const tracked = (await promisify(execFile)("git", ["-C", root, "ls-files", "--stage", "-z"], { maxBuffer: 4 * 1024 * 1024, timeout: 10000 })).stdout;
  files = { ...files };
  for (const entry of tracked.split("\0").filter(Boolean)) {
    const separator = entry.indexOf("\t");
    const metadata = entry.slice(0, separator), path = entry.slice(separator + 1);
    if (!metadata.startsWith("160000 ") && !Object.hasOwn(files, path)) files[path] = null;
  }
  let bytes = 0;
  for (const [path, file] of Object.entries(files)) {
    if (!path || path.startsWith("/") || path.split("/").some(p => !p || p === "." || p === ".." || p === ".git")) throw Error("Invalid historical path");
    let parent = root;
    for (const part of path.split("/").slice(0, -1)) {
      parent = join(parent, part);
      try { const info = await lstat(parent); if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Unsafe historical parent"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await mkdir(parent); }
    }
    const target = join(root, path);
    try { await unlink(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!file) continue;
    const content = Buffer.from(file.content, "base64"); bytes += content.length;
    if (bytes > 8 * 1024 * 1024) throw Error("Historical byte capacity exhausted");
    if (file.mode === 0o120000) await symlink(content.toString(), target);
    else if (file.mode === 0o100644 || file.mode === 0o100755) await writeFile(target, content, { flag: "wx", mode: file.mode & 0o777 });
    else throw Error("Unsupported historical mode");
  }
}
