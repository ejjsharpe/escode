import { execFileSync } from "node:child_process";
import {
  realpathSync,
  openSync,
  closeSync,
  fstatSync,
  constants,
  mkdirSync,
  mkdtempSync,
  statSync,
} from "node:fs";
import { resolve, relative, isAbsolute, dirname, join, basename } from "node:path";
import { getSystemErrorName } from "node:util";
import { findExecutable } from "./tools";
import { createHash, randomUUID } from "node:crypto";
// macOS O_NOFOLLOW_ANY rejects symlinks in every path component.
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | 0x20000000;
export const limit = 2 * 1024 * 1024;
export type Document = { text: string; version: string };
export type Change = { path: string; area: "staged" | "unstaged" | "untracked" };
export type SaveResult = { kind: "saved"; disk: Document } | { kind: "conflict"; disk: Document };
export class Project {
  private directory: number | undefined;
  private gitDirectory = "";
  private gitIdentity?: { dev: number; ino: number };
  private constructor(
    readonly root: string,
    private readonly executable: string,
    private readonly helper: string,
    private readonly identity: { dev: number; ino: number },
    directory: number,
  ) {
    this.directory = directory;
  }
  static async open(path: string, helper = resolve("dist/host/filesystem")) {
    const root = realpathSync(path);
    const executable = await findExecutable("git");
    const fd = openSync(root, directoryFlags);
    try {
      const project = new Project(root, executable, helper, fstatSync(fd), fd);
      const top = project
        .io(["git", executable, "rev-parse", "--show-toplevel"])
        .toString("utf8")
        .trim();
      if (realpathSync(top) !== root) throw Error("Choose the repository checkout root.");
      project.gitDirectory = realpathSync(
        project.git(["rev-parse", "--absolute-git-dir"]).toString().trim(),
      );
      project.gitIdentity = statSync(project.gitDirectory);
      project.repository();
      return project;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  close() {
    if (this.directory !== undefined) closeSync(this.directory);
    this.directory = undefined;
  }
  private io(args: string[], input?: string) {
    if (this.directory === undefined) throw Error("Project is closed.");
    const fd = openSync(this.root, directoryFlags);
    try {
      const identity = fstatSync(fd);
      if (identity.dev !== this.identity.dev || identity.ino !== this.identity.ino)
        throw Error("Checkout directory was replaced. Reopen the project.");
      try {
        return execFileSync(this.helper, args, {
          input,
          maxBuffer: 16 * 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe", this.directory],
        });
      } catch (error) {
        const stderr = (error as { stderr?: Buffer }).stderr?.toString();
        if (!stderr || args[0] === "git") throw error;
        const number = Number(stderr.split(":", 1)[0]);
        const code = number > 0 ? getSystemErrorName(-number) : undefined;
        throw Object.assign(
          Error((code ? code + ": " : "") + stderr.slice(stderr.indexOf(":") + 1).trim()),
          { code },
        );
      }
    } finally {
      closeSync(fd);
    }
  }
  private git(args: string[]) {
    return this.io(["git", this.executable, "--literal-pathspecs", "--work-tree=.", ...args]);
  }
  private path(path: string) {
    if (
      typeof path !== "string" ||
      !path ||
      isAbsolute(path) ||
      path.includes("\0") ||
      path.split("/").some((part) => part === ".." || part.toLowerCase() === ".git")
    )
      throw Error("Invalid project path");
    const full = resolve(this.root, path);
    const rel = relative(this.root, full);
    if (rel.startsWith("../") || isAbsolute(rel) || !rel) throw Error("Path outside checkout");
    return rel;
  }
  async files(path = ""): Promise<{ path: string; directory: boolean }[]> {
    const scoped = path ? this.path(path) : ".";
    return this.io(["list", scoped])
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((entry) => ({
        path: path ? path + "/" + entry.slice(1) : entry.slice(1),
        directory: entry[0] === "d",
      }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.path.localeCompare(b.path));
  }
  private document(bytes: Buffer): Document {
    if (bytes.length > limit) throw Error("Text unavailable: file exceeds 2 MiB.");
    if (bytes.includes(0)) throw Error("Text unavailable: binary file.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, version: createHash("sha256").update(bytes).digest("hex") };
  }
  private readDisk(path: string) {
    return this.document(this.io(["read", this.path(path)]));
  }
  async read(path: string) {
    return this.readDisk(path);
  }
  async save(path: string, text: string, version: string): Promise<SaveResult> {
    if (typeof text !== "string" || Buffer.byteLength(text) > limit || typeof version !== "string")
      throw Error("Invalid save");
    const saved = this.document(Buffer.from(text));
    const scoped = this.path(path);
    const disk = this.readDisk(path);
    if (disk.version !== version) return { kind: "conflict", disk };
    const temp = join(dirname(scoped), ".escode-" + randomUUID());
    let staged = false;
    try {
      this.io(["stage", scoped, temp], text);
      staged = true;
      const current = this.readDisk(path);
      if (current.version !== version) return { kind: "conflict", disk: current };
      // shortcut: VS Code's check-before-save guarantee accepts an unrelated writer
      // between this check and replacement; upgrade only if the save policy changes.
      this.io(["replace", scoped, temp]);
      return { kind: "saved", disk: saved };
    } finally {
      if (staged) this.io(["remove", temp]);
    }
  }
  private repositoryIdentity?: string;
  checkouts() {
    return this.git(["worktree", "list", "--porcelain", "-z"])
      .toString()
      .split("\0")
      .filter((record) => record.startsWith("worktree "))
      .map((record) => record.slice(9));
  }
  repository() {
    if (!this.repositoryIdentity) {
      const first = this.checkouts()[0];
      if (!first) throw Error("Cannot identify repository.");
      this.repositoryIdentity = realpathSync(first);
    }
    return this.repositoryIdentity;
  }
  validateRepository() {
    const liveDirectory = realpathSync(
      this.git(["rev-parse", "--absolute-git-dir"]).toString().trim(),
    );
    const identity = statSync(liveDirectory);
    const checkouts = this.checkouts();
    if (
      liveDirectory !== this.gitDirectory ||
      identity.dev !== this.gitIdentity?.dev ||
      identity.ino !== this.gitIdentity?.ino ||
      !checkouts.includes(this.root) ||
      !checkouts[0] ||
      realpathSync(checkouts[0]) !== this.repository()
    )
      throw Error(
        "Repository metadata changed. Reopen the project before creating or reusing worktrees.",
      );
    return checkouts;
  }
  worktreeOptions() {
    const checkouts = this.validateRepository();
    const branches = this.git(["for-each-ref", "--format=%(refname)", "refs/heads/"])
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    const resolveBase = (ref: string) => {
      try {
        return this.git(["rev-parse", "--verify", "--end-of-options", ref + "^{commit}"])
          .toString()
          .trim();
      } catch {
        return null;
      }
    };
    const bases = [...branches, "HEAD"].flatMap((ref) => {
      const commit = resolveBase(ref);
      return commit ? [{ ref, commit }] : [];
    });
    let defaultRef = "HEAD";
    try {
      const remote = this.git(["symbolic-ref", "refs/remotes/origin/HEAD"]).toString().trim();
      const local = "refs/heads/" + remote.slice("refs/remotes/origin/".length);
      defaultRef = bases.some((b) => b.ref === local) ? local : remote;
      const commit = resolveBase(defaultRef);
      if (commit && !bases.some((b) => b.ref === defaultRef))
        bases.push({ ref: defaultRef, commit });
    } catch {
      // Without local default-branch metadata, HEAD is the only reliable fallback.
    }
    if (!bases.some((b) => b.ref === defaultRef)) defaultRef = "HEAD";
    return { bases, defaultRef, checkouts };
  }
  createWorktree(managedRoot: string, ref: string, commit: string) {
    const base = this.worktreeOptions().bases.find((b) => b.ref === ref);
    if (!base || base.commit !== commit)
      throw Error(
        "Base is missing or changed. Refresh bases and choose again. Empty repositories need a first commit.",
      );
    let ancestor = resolve(managedRoot);
    const missing: string[] = [];
    while (true) {
      try {
        ancestor = realpathSync(ancestor);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        missing.unshift(basename(ancestor));
        ancestor = dirname(ancestor);
      }
    }
    const canonicalRoot = join(ancestor, ...missing);
    for (const checkout of this.checkouts()) {
      let canonicalCheckout: string;
      try { canonicalCheckout = realpathSync(checkout); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const rel = relative(canonicalCheckout, canonicalRoot);
      if (!rel || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel)))
        throw Error(
          "Managed worktrees must be outside project checkouts. Relaunch escode with --user-data-dir pointing outside this repository.",
        );
    }
    const repository = createHash("sha256").update(this.repository()).digest("hex");
    const parent = join(canonicalRoot, repository);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    // Reserve a unique container; Git gets a never-before-used child path.
    const container = mkdtempSync(join(parent, "worktree-"));
    const root = join(container, "checkout");
    const branch = "escode/" + randomUUID().slice(0, 12);
    try {
      // Git accepts an existing empty path, so reserve it exclusively ourselves.
      mkdirSync(root, { mode: 0o700 });
      this.validateRepository();
      this.git([
        "--git-dir=" + this.gitDirectory,
        "-c",
        "core.hooksPath=/dev/null",
        "worktree",
        "add",
        "-b",
        branch,
        root,
        commit,
      ]);
      return { root, branch, commit, error: null };
    } catch (error) {
      // Preserve all leftovers: even an empty directory may now belong to another writer.
      return {
        root,
        branch,
        commit,
        error: `Creation failed. No chat started. Inspect possible residual branch ${branch} and directory ${container} externally; both are retained. Refresh and retry creates a new destination. ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  async status() {
    const records = this.git([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--no-renames",
    ])
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
    const changes: Change[] = [];
    for (const row of records) {
      const path = row.slice(3);
      if (row.startsWith("??")) changes.push({ path, area: "untracked" });
      else {
        if (row[0] !== " ") changes.push({ path, area: "staged" });
        if (row[1] !== " ") changes.push({ path, area: "unstaged" });
      }
    }
    let branch: string;
    try {
      branch = this.git(["symbolic-ref", "--short", "HEAD"]).toString().trim();
    } catch {
      branch = this.git(["rev-parse", "--short", "HEAD"]).toString().trim() + " (detached)";
    }
    return { project: this.repository(), root: this.root, branch, changes };
  }
  async diff(change: Change) {
    if (!["staged", "unstaged", "untracked"].includes(change.area))
      throw Error("Invalid diff area");
    // Validate lexical scope even when a deleted path no longer exists.
    this.path(change.path);
    const blob = (ref: string) => {
      try {
        this.git(["rev-parse", "--verify", ref]);
      } catch {
        return "";
      }
      try {
        return this.document(this.git(["show", ref + ":" + change.path])).text;
      } catch (error) {
        const exists = this.git(["ls-tree", "-z", ref, "--", change.path]).length;
        if (!exists) return "";
        throw error;
      }
    };
    const index = () => {
      const entries = this.git(["ls-files", "--stage", "-z", "--", change.path]).toString();
      if (!entries) return "";
      const oid = entries.split(" ")[1];
      return this.document(this.git(["cat-file", "blob", oid])).text;
    };
    const disk = async () => {
      try {
        return (await this.read(change.path)).text;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw e;
      }
    };
    return {
      original:
        change.area === "untracked" ? "" : change.area === "staged" ? blob("HEAD") : index(),
      modified: change.area === "staged" ? index() : await disk(),
    };
  }
}

export interface ProjectBridge {
  (operation: "open"): Promise<Awaited<ReturnType<Project["status"]>> | null>;
  (
    operation: "worktree-options",
    checkout: string,
  ): Promise<ReturnType<Project["worktreeOptions"]>>;
  (
    operation: "worktree-create",
    checkout: string,
    ref: string,
    commit: string,
  ): Promise<ReturnType<Project["createWorktree"]>>;
  (operation: "status", checkout: string): ReturnType<Project["status"]>;
  (operation: "files", checkout: string, path: string): ReturnType<Project["files"]>;
  (operation: "read", checkout: string, path: string): ReturnType<Project["read"]>;
  (
    operation: "save",
    checkout: string,
    path: string,
    text: string,
    version: string,
  ): ReturnType<Project["save"]>;
  (
    operation: "diff",
    checkout: string,
    path: string,
    area: Change["area"],
  ): ReturnType<Project["diff"]>;
}
