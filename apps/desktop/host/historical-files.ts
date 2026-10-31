import { validateCheckpointFiles } from "./checkpoint-files";
import { lstat, mkdir, rmdir, unlink, writeFile, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

// Only called in a newly reserved managed checkout; never write through Git-base symlinks.
export async function applyHistoricalFiles(root: string, files: Record<string, { mode: number; content: string } | null>) {
  validateCheckpointFiles(files);
  const tracked = (await promisify(execFile)("git", ["-C", root, "ls-files", "--stage", "-z"], { maxBuffer: 4 * 1024 * 1024, timeout: 10000 })).stdout;
  files = { ...files };
  for (const entry of tracked.split("\0").filter(Boolean)) {
    const separator = entry.indexOf("\t");
    const metadata = entry.slice(0, separator), path = entry.slice(separator + 1);
    if (!metadata.startsWith("160000 ") && !Object.hasOwn(files, path)) files[path] = null;
  }
  // Remove tracked leaves before creating their replacements, then empty base directories.
  const deletions = Object.entries(files).filter(([, file]) => file === null).sort(([a], [b]) => b.length - a.length);
  deletion: for (const [path] of deletions) {
    let parent = root;
    for (const part of path.split("/").slice(0, -1)) {
      parent = join(parent, part);
      let info;
      try { info = await lstat(parent); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue deletion; throw error; }
      if (info.isSymbolicLink()) throw Error("Unsafe historical parent");
      if (info.isFile()) continue deletion;
      if (!info.isDirectory()) throw Error("Unsafe historical parent");
      try { await lstat(join(parent, ".git")); throw Error("Nested repository historical parent"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const target = join(root, path);
    try { await unlink(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  for (const [path, file] of Object.entries(files).filter(([, file]) => file !== null)) {
    if (!path || path.startsWith("/") || path.split("/").some(p => !p || p === "." || p === ".." || p === ".git")) throw Error("Invalid historical path");
    let parent = root;
    for (const part of path.split("/").slice(0, -1)) {
      parent = join(parent, part);
      try { const info = await lstat(parent); if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Unsafe historical parent"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await mkdir(parent); }
      try { await lstat(join(parent, ".git")); throw Error("Nested repository historical parent"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const target = join(root, path);
    try {
      if ((await lstat(target)).isDirectory()) {
        // Only remove empty directories; never recursively delete excluded contents.
        const parents = deletions.map(([p]) => p.split("/").slice(0, -1)).flatMap(parts => parts.map((_, i) => parts.slice(0, i + 1).join("/")));
        for (const parent of [...new Set(parents)].filter(p => p === path || p.startsWith(path + "/")).sort((a, b) => b.length - a.length)) await rmdir(join(root, parent));
      } else await unlink(target);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!file) continue;
    const content = Buffer.from(file.content, "base64");
    if (file.mode === 0o120000) await symlink(content.toString(), target);
    else if (file.mode === 0o100644 || file.mode === 0o100755) await writeFile(target, content, { flag: "wx", mode: file.mode & 0o777 });
    else throw Error("Unsupported historical mode");
  }
}
