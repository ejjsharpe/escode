import { validateCheckpointFiles } from "./checkpoint-files";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, realpath, mkdir, writeFile, rename, unlink, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Chats, SavedChat } from "./chat";

// No Git index mutation: checkpoint contents become saved working files only.
export async function prepareRestoration(store: Chats, chat: Readonly<SavedChat>, boundary: string, check: () => void) {
  const point = await store.database.command("inspectCheckpoint", { commandId: chat.id, body: { boundary } });
  const validate = async () => {
    check();
    if (!chat.project || chat.checkout === chat.project || chat.checkout === chat.worktree?.source) throw Error("File restoration requires an isolated linked worktree; original checkouts and No project are unavailable");
    store.validateWorktree(chat);
    const invalid = await store.validateDirectory(chat); if (invalid) throw Error(invalid);
    if ((await store.all()).some(other => other.id !== chat.id && !other.removed && (other.checkout === chat.checkout || other.directoryIdentity?.path === chat.directoryIdentity?.path || (other.directoryIdentity && chat.directoryIdentity && other.directoryIdentity.dev === chat.directoryIdentity.dev && other.directoryIdentity.ino === chat.directoryIdentity.ino)))) throw Error("Worktree is shared with another chat");
    if (!point || point.availability !== "available" || !point.files || point.checkout !== chat.checkout || JSON.stringify(point.directoryIdentity) !== JSON.stringify(chat.directoryIdentity)) throw Error("Exact checkpoint files or checkout identity unavailable");
  };
  await validate();
  const git = async (...args: string[]) => (await promisify(execFile)("git", ["--no-optional-locks", "-C", chat.checkout, ...args], { maxBuffer: 4 * 1024 * 1024, timeout: 15000 })).stdout;
  if (!/^[a-f0-9]{40,64}$/.test(point.gitBase ?? "")) throw Error("Recorded Git base unavailable");
  const gitIdentity = async () => JSON.stringify([(await git("rev-parse", "--abbrev-ref", "HEAD")).trim(), (await git("rev-parse", "HEAD")).trim()]);
  const capturedGit = await gitIdentity();
  const authority = async () => {
    if ((await git("rev-parse", "--show-toplevel")).trim() !== chat.checkout || (chat.worktree?.reservation && (await git("rev-parse", "--abbrev-ref", "HEAD")).trim() !== chat.worktree.reservation.branch) || await gitIdentity() !== capturedGit) throw Error("Worktree Git authority changed");
    await git("cat-file", "-e", point.gitBase + "^{commit}");
    const sourceCommon = (await promisify(execFile)("git", ["-C", chat.project!, "rev-parse", "--path-format=absolute", "--git-common-dir"], { timeout: 15000 })).stdout.trim();
    if ((await git("rev-parse", "--path-format=absolute", "--git-common-dir")).trim() !== sourceCommon) throw Error("Worktree repository authority changed");
  };
  await authority();
  validateCheckpointFiles(point.files);
  const current = (await git("ls-files", "--cached", "--others", "--exclude-standard", "-z")).split("\0").filter(Boolean);
  const paths = [...new Set([...current, ...Object.keys(point.files)])].sort();
  if (paths.length > 10000) throw Error("Restoration file capacity exhausted");
  const checkPath = async (path: string) => {
    if (!path || path.startsWith("/") || path.split("/").some(p => !p || p === "." || p === ".." || p === ".git")) throw Error("Invalid restoration path");
    let parent = dirname(path);
    while (parent !== ".") {
      const absolute = join(chat.checkout, parent);
      try {
        if ((await lstat(absolute)).isSymbolicLink()) throw Error("Linked restoration parent");
        if (await realpath(absolute) !== absolute || !(await lstat(absolute)).isDirectory()) throw Error("Linked restoration parent");
        try { await lstat(join(absolute, ".git")); throw Error("Nested repository restoration unavailable"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      parent = dirname(parent);
    }
    try { const info = await lstat(join(chat.checkout, path)); if (!info.isFile() && !info.isSymbolicLink()) throw Error("Restoration path collision"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  };
  for (const path of paths) await checkPath(path);
  return { captured: JSON.stringify([point, paths, capturedGit]), async validate() { await validate(); await authority(); }, async apply() {
    await validate();
    await authority();
    for (const path of paths) {
      await validate(); await checkPath(path);
      const file = join(chat.checkout, path);
      const saved = (Object.hasOwn(point.files, path) ? point.files[path] : null) as { content: string; mode: number } | null | undefined;
      if (!saved) {
        try { await unlink(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      } else {
        await mkdir(dirname(file), { recursive: true });
        await checkPath(path);
        const temporary = join(dirname(file), `.escode-restore-${randomUUID()}`);
        try {
          if (saved.mode === 0o120000) await symlink(Buffer.from(saved.content, "base64").toString(), temporary);
          else await writeFile(temporary, Buffer.from(saved.content, "base64"), { flag: "wx", mode: saved.mode === 0o100755 ? 0o755 : 0o644 });
          await validate(); await checkPath(path);
          await rename(temporary, file);
        } finally { await unlink(temporary).catch(() => {}); }
      }
    }
  } };
}
