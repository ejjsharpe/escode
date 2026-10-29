import { execFileSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  realpathSync,
  lstatSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { resolve, relative, isAbsolute, dirname, join } from "node:path";
import { findExecutable } from "./tools";
import { createHash, randomUUID } from "node:crypto";
export const limit = 2 * 1024 * 1024;
export type Document = { text: string; version: string };
export type Change = { path: string; area: "staged" | "unstaged" | "untracked" };
export type SaveResult = { kind: "saved"; disk: Document } | { kind: "conflict"; disk: Document };
export class Project {
  private constructor(
    readonly root: string,
    private readonly executable: string,
  ) {}
  static async open(path: string) {
    const root = realpathSync(path);
    const executable = await findExecutable("git");
    const top = execFileSync(executable, ["-C", root, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    if (realpathSync(top) !== root) throw Error("Choose the repository checkout root.");
    return new Project(root, executable);
  }
  private git(args: string[]) {
    return execFileSync(this.executable, ["--literal-pathspecs", "-C", this.root, ...args], {
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  private path(path: string) {
    if (
      typeof path !== "string" ||
      !path ||
      isAbsolute(path) ||
      path.split(/[\\/]/).includes(".git")
    )
      throw Error("Invalid project path");
    const full = resolve(this.root, path);
    const rel = relative(this.root, full);
    if (rel.startsWith("../") || isAbsolute(rel) || !rel) throw Error("Path outside checkout");
    const real = realpathSync(full);
    if (real !== full || lstatSync(full).isSymbolicLink())
      throw Error("Symbolic links are unavailable");
    return full;
  }
  async files(path = ""): Promise<{ path: string; directory: boolean }[]> {
    const full = path ? this.path(path) : this.root;
    return readdirSync(full, { withFileTypes: true })
      .filter((e) => e.name !== ".git" && !e.isSymbolicLink())
      .map((e) => ({ path: path ? path + "/" + e.name : e.name, directory: e.isDirectory() }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.path.localeCompare(b.path));
  }
  private document(bytes: Buffer): Document {
    if (bytes.length > limit) throw Error("Text unavailable: file exceeds 2 MiB.");
    if (bytes.includes(0)) throw Error("Text unavailable: binary file.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, version: createHash("sha256").update(bytes).digest("hex") };
  }
  private readDisk(path: string) {
    const full = this.path(path);
    if (statSync(full).size > limit) throw Error("Text unavailable: file exceeds 2 MiB.");
    return this.document(readFileSync(full));
  }
  async read(path: string) {
    return this.readDisk(path);
  }
  async save(path: string, text: string, version: string): Promise<SaveResult> {
    if (typeof text !== "string" || Buffer.byteLength(text) > limit || typeof version !== "string")
      throw Error("Invalid save");
    const saved = this.document(Buffer.from(text));
    const full = this.path(path);
    const disk = this.readDisk(path);
    if (disk.version !== version) return { kind: "conflict", disk };
    const temp = join(dirname(full), ".escode-" + randomUUID());
    try {
      writeFileSync(temp, text, { flag: "wx", mode: statSync(full).mode });
      const current = this.readDisk(path);
      if (current.version !== version) return { kind: "conflict", disk: current };
      // shortcut: portable filesystems lack compare-and-swap rename; an external writer
      // can still race the final check/rename. Revisit with platform coordination.
      renameSync(temp, full);
      return { kind: "saved", disk: saved };
    } finally {
      try {
        unlinkSync(temp);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
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
    return { root: this.root, branch, changes };
  }
  async diff(change: Change) {
    if (!["staged", "unstaged", "untracked"].includes(change.area))
      throw Error("Invalid diff area");
    // Validate lexical scope even when a deleted path no longer exists.
    if (isAbsolute(change.path) || change.path.split("/").some((p) => p === ".." || p === ".git"))
      throw Error("Invalid diff path");
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
  (operation: "status"): ReturnType<Project["status"]>;
  (operation: "files", path: string): ReturnType<Project["files"]>;
  (operation: "read", path: string): ReturnType<Project["read"]>;
  (operation: "save", path: string, text: string, version: string): ReturnType<Project["save"]>;
  (operation: "diff", path: string, area: Change["area"]): ReturnType<Project["diff"]>;
}
