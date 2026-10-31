import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, lstat, readlink, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { SavedChat } from "./chat";
import type { DurableState } from "./durable-state";
const execute = promisify(execFile);
let capturing = 0;

// Saved disk only: no editor memory, ignored untracked files, empty directories or environment.
export async function captureTurnCheckpoint(database: DurableState, chat: Readonly<SavedChat>, threadId: string | null, commandId?: string, completion?: { id: string; turnId: string; completion: string; createdAt: number }) {
  const boundary = { ...(completion ?? {}), id: completion?.id ?? randomUUID(), kind: completion ? "after-turn" : "before-message", chatId: chat.id, project: chat.project,
    commandId: commandId ?? null, checkout: chat.checkout, directoryIdentity: chat.directoryIdentity, threadId, createdAt: completion?.createdAt ?? Date.now() };
  const deadline = Date.now() + 15000;
  let gitBase: string | null = null;
  let body: object;
  let admitted = false;
  try {
    if (capturing >= 2) throw Error("Checkpoint capture capacity exhausted");
    capturing++;
    admitted = true;
    if (completion && completion.completion !== "completed") throw Error(`Turn ${completion.completion}; completion files unavailable`);
    if (chat.project === null) throw Error("No project file coverage");
    const git = async (...args: string[]) => (await execute("git", ["-C", chat.checkout, ...args],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: Math.max(1, deadline - Date.now()) })).stdout;
    gitBase = (await git("rev-parse", "HEAD")).trim();
    const entries = (await git("ls-files", "--cached", "--others", "--exclude-standard", "-z")).split("\0").filter(Boolean);
    if (entries.length > 10000) throw Error("Checkpoint file count exhausted");
    const files: Record<string, { mode: number; content: string } | null> = Object.create(null);
    let bytes = 0;
    const root = await realpath(chat.checkout);
    const identity = await stat(root);
    if (boundary.directoryIdentity && (boundary.directoryIdentity.path !== root || boundary.directoryIdentity.dev !== identity.dev || boundary.directoryIdentity.ino !== identity.ino)) throw Error("Checkpoint checkout identity changed");
    boundary.directoryIdentity = { path: root, dev: identity.dev, ino: identity.ino };
    const nested = new Set<string>();
    for (const path of new Set(entries)) {
      if (Date.now() > deadline) throw Error("Checkpoint capture time exhausted");
      if (path.endsWith("/")) continue; // Git reports nested untracked repositories as directories.
      if (path.split("/").some(part => part === ".." || part === ".git") || path.startsWith("/")) throw Error("Invalid Git path");
      let parent = dirname(path), excluded = false;
      while (parent !== ".") {
        if (nested.has(parent)) { excluded = true; break; }
        try { await lstat(join(root, parent, ".git")); nested.add(parent); excluded = true; break; }
        catch (error) { if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
        parent = dirname(parent);
      }
      if (excluded) continue;
      const file = join(root, path);
      let info;
      try { info = await lstat(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { files[path] = null; continue; } throw error; }
      if (await realpath(dirname(file)) !== dirname(file)) throw Error("Linked checkpoint parent");
      if (info.isDirectory()) continue; // Includes tracked submodules; never descend into nested repositories.
      if (!info.isFile() && !info.isSymbolicLink()) throw Error("Unsupported checkpoint file");
      if (info.size + bytes > 8 * 1024 * 1024) throw Error("Checkpoint byte capacity exhausted");
      let content: Buffer;
      if (info.isSymbolicLink()) content = Buffer.from(await readlink(file));
      else {
        const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const buffer = Buffer.alloc(Math.min(8 * 1024 * 1024 - bytes + 1, info.size + 1));
          const result = await handle.read(buffer, 0, buffer.length, 0);
          if (result.bytesRead !== info.size) throw Error("Checkpoint file changed during capture");
          content = buffer.subarray(0, result.bytesRead);
        } finally { await handle.close(); }
      }
      bytes += content.length;
      files[path] = { mode: info.isSymbolicLink() ? 0o120000 : info.mode & 0o111 ? 0o100755 : 0o100644, content: content.toString("base64") };
    }
    body = { ...boundary, gitBase, availability: "available", files };
  } catch (error) { body = { ...boundary, gitBase, availability: "unavailable", reason: String(error) }; }
  finally { if (admitted) capturing--; }
  try { await database.command(completion ? "completeCheckpoint" : "checkpoint", { body }); }
  catch (error) {
    // Content exhaustion must retain the same boundary with explicit missing coverage.
    try { await database.command(completion ? "completeCheckpoint" : "checkpoint", { body: { ...boundary, gitBase, availability: "unavailable", reason: String(error) } }); }
    catch (failure) { return `File checkpoint unavailable; boundary persistence failed: ${String(failure)}`; }
    return `File checkpoint unavailable: ${String(error)}`;
  }
  if (chat.project === null) return null;
  return (body as { availability: string; reason?: string }).availability === "unavailable" ? `File checkpoint unavailable: ${(body as { reason: string }).reason}` : null;
}
