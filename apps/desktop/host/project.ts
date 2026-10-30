import { CheckoutRepository } from "./checkout-repository";
import { spawn, execFileSync } from "node:child_process";
import {
  realpathSync,
  openSync,
  closeSync,
  fstatSync,
  constants,
  statSync,
  watch,
  type FSWatcher,
} from "node:fs";
import { resolve, relative, isAbsolute, dirname, join } from "node:path";
import { getSystemErrorName } from "node:util";
import { findExecutable } from "./tools";
import { createHash, randomUUID } from "node:crypto";
// macOS O_NOFOLLOW_ANY rejects symlinks in every path component.
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | 0x20000000;
export const limit = 2 * 1024 * 1024;
export type Document = { text: string; version: string };
export type Change = { path: string; area: "staged" | "unstaged" | "untracked" };
export type SaveResult = ({ kind: "saved"; disk: Document } | { kind: "conflict"; disk: Document }) & { persistencePending?: boolean; message?: string };
export class Checkout {
  readonly repositoryGit: CheckoutRepository;
  private directory: number | undefined;
  private filesOnly = false;
  private constructor(
    readonly root: string,
    private executable: string,
    private readonly helper: string,
    private readonly identity: { dev: number; ino: number },
    directory: number,
  ) {
    this.directory = directory;
    this.repositoryGit = new CheckoutRepository(root, (args) => this.git(args), () => this.executable);
  }
  static async open(path: string, helper = resolve("dist/host/filesystem")) {
    const root = realpathSync(path);
    const executable = await findExecutable("git");
    const fd = openSync(root, directoryFlags);
    try {
      const project = new Checkout(root, executable, helper, fstatSync(fd), fd);
      const top = project
        .io(["git", executable, "rev-parse", "--show-toplevel"])
        .toString("utf8")
        .trim();
      if (realpathSync(top) !== root) throw Error("Choose the repository checkout root.");
      project.repositoryGit.gitDirectory = realpathSync(
        project.git(["rev-parse", "--absolute-git-dir"]).toString().trim(),
      );
      project.repositoryGit.gitIdentity = statSync(project.repositoryGit.gitDirectory);
      project.repositoryGit.repository();
      return project;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  static async restore(path: string, repository: string, helper = resolve("dist/host/filesystem")) {
    try {
      const project = await Checkout.open(path, helper);
      if (project.repositoryGit.repository() !== repository) {
        project.close();
        throw Error("Repository identity changed. Reopen the project.");
      }
      return project;
    } catch (error) {
      let executable = "",
        gitWorks = false;
      try {
        executable = await findExecutable("git");
        execFileSync(executable, ["--version"], { timeout: 5000, stdio: "pipe" });
        gitWorks = true;
      } catch {
        /* Previously approved files remain usable without Git. */
      }
      if (gitWorks) throw error;
      const root = realpathSync(path);
      if (root !== path) throw Error("Checkout path changed. Restore the original directory.");
      const fd = openSync(root, directoryFlags);
      const project = new Checkout(root, executable, helper, fstatSync(fd), fd);
      project.repositoryGit.repositoryIdentity = repository;
      project.filesOnly = true;
      return project;
    }
  }
  private watches = new Map<string, { watcher: FSWatcher; listeners: Set<(error?: string) => void> }>();
  private watchDisposers = new Set<() => void>();
  watchFiles(paths: string[], notify: (error?: string) => void) {
    const releases: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failure: string | undefined;
    let disposed = false;
    const changed = (error?: string) => {
      if (disposed) return;
      failure = error ?? failure;
      if (!timer) timer = setTimeout(() => {
        timer = undefined;
        notify(failure);
        failure = undefined;
      }, 100);
    };
    const dispose = () => {
      disposed = true;
      clearTimeout(timer);
      releases.forEach((release) => release());
      this.watchDisposers.delete(dispose);
    };
    this.watchDisposers.add(dispose);
    for (const path of new Set(paths)) {
      try {
        this.checkoutIdentity();
        if (path && this.path(path) !== path) throw Error("Use an exact directory path.");
        const full = path ? resolve(this.root, path) : this.root;
        // O_NOFOLLOW_ANY checks every ancestor; the watcher never grants read/write authority.
        const fd = openSync(full, directoryFlags);
        let identity: string;
        try {
          const info = fstatSync(fd);
          identity = `${info.dev}:${info.ino}`;
        } finally {
          closeSync(fd);
        }
        const key = path + "\0" + identity;
        let entry = this.watches.get(key);
        if (!entry) {
          const listeners = new Set<(error?: string) => void>();
          const watcher = watch(full, { persistent: false }, () => {
            listeners.forEach((listener) => listener());
          });
          try {
            this.checkoutIdentity();
            const check = openSync(full, directoryFlags);
            try {
              const current = fstatSync(check);
              if (`${current.dev}:${current.ino}` !== identity)
                throw Error("Directory changed while subscribing. Use Refresh to retry.");
            } finally {
              closeSync(check);
            }
          } catch (error) {
            watcher.close();
            throw error;
          }
          entry = { watcher, listeners };
          this.watches.set(key, entry);
          watcher.on("error", (error) => {
            listeners.forEach((listener) => listener(`${full}: ${String(error)}`));
            watcher.close();
            if (this.watches.get(key)?.watcher === watcher) this.watches.delete(key);
          });
        }
        entry.listeners.add(changed);
        const captured = entry;
        releases.push(() => {
          captured.listeners.delete(changed);
          if (!captured.listeners.size) {
            captured.watcher.close();
            if (this.watches.get(key) === captured) this.watches.delete(key);
          }
        });
      } catch (error) {
        changed(`${this.root}/${path}: ${String(error)}`);
      }
    }
    return dispose;
  }
  close() {
    for (const dispose of this.watchDisposers) dispose();
    if (this.directory !== undefined) closeSync(this.directory);
    this.directory = undefined;
  }
  private checkedDirectory() {
    if (this.directory === undefined) throw Error("Project is closed.");
    const fd = openSync(this.root, directoryFlags);
    try {
      const identity = fstatSync(fd);
      if (identity.dev !== this.identity.dev || identity.ino !== this.identity.ino)
        throw Error("Checkout directory was replaced. Reopen the project.");
      return fd;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  private io(args: string[], input?: string) {
    const fd = this.checkedDirectory();
    try {
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
  async filteredFiles(path = "") {
    const entries = await this.files(path);
    try {
      if (this.filesOnly) throw Error("Git unavailable");
      let output: Buffer;
      try {
        output = this.io(
          ["git", this.executable, "--work-tree=.", "check-ignore", "-z", "--stdin"],
          entries.map((e) => e.path).join("\0") + (entries.length ? "\0" : ""),
        );
      } catch (error) {
        if ((error as { status?: number }).status !== 1) throw error;
        output = Buffer.alloc(0);
      }
      return { entries, ignored: output.toString("utf8").split("\0").filter(Boolean) };
    } catch {
      return {
        entries,
        ignored: [],
        filterError:
          "Git ignore filter unavailable. All files are shown. Restore Git or repository access, then Refresh.",
      };
    }
  }
  entryLocation(path: string) {
    if (path) this.operationIdentity(path);
    else this.checkoutIdentity();
    return path ? resolve(this.root, path) : this.root;
  }
  checkoutIdentity() {
    closeSync(this.checkedDirectory());
    return `${this.identity.dev}:${this.identity.ino}`;
  }
  operationIdentity(path: string) {
    this.checkoutIdentity();
    if (
      path !== this.path(path) ||
      relative(this.root, realpathSync(resolve(this.root, path))) !== path
    )
      throw Error("Use the exact checkout-relative path without aliases.");
    return this.io(["identity", this.path(path)]).toString();
  }
  validateName(name: string) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name === "." ||
      name === ".." ||
      /[/\\\0]/.test(name) ||
      name.toLowerCase() === ".git"
    )
      throw Error("Enter one file or folder name without separators or traversal.");
  }
  create(parent: string, name: string, kind: "file" | "folder") {
    this.validateName(name);
    if (kind !== "file" && kind !== "folder") throw Error("Invalid create kind.");
    const scoped = parent ? this.path(parent) : ".";
    if (parent && scoped !== parent) throw Error("Use the exact parent path.");
    const identity = this.io(["identity", scoped]).toString();
    this.io(["create", scoped, name, kind, identity]);
    return parent ? parent + "/" + name : name;
  }
  renameDestination(source: string, name: string) {
    this.validateName(name);
    this.path(source);
    return join(dirname(source), name);
  }
  validateMove(source: string, destination: string) {
    if (source !== this.path(source) || destination !== this.path(destination))
      throw Error("Use exact checkout-relative paths.");
    const parent = dirname(destination);
    if (parent !== "." && relative(this.root, realpathSync(resolve(this.root, parent))) !== parent)
      throw Error("Use the exact destination parent path without aliases.");
    if (destination === source || destination.startsWith(source + "/"))
      throw Error("Choose a different destination outside the source folder.");
  }
  move(source: string, destination: string, identity: string) {
    this.validateMove(source, destination);
    this.io(["move", source, destination, identity]);
    try {
      if (this.operationIdentity(destination) !== identity)
        throw Error("Destination object changed.");
    } catch (error) {
      throw Object.assign(Error(`Move outcome needs reconciliation: ${String(error)}`), {
        uncertain: true,
      });
    }
  }
  async preflightImport(native: import("./native-import").NativeImport) {
    native.validate();
    const fd = this.checkedDirectory();
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(this.helper, ["import-check", native.path, native.parents], {
          stdio: ["ignore", "ignore", "pipe", fd, native.fd],
        });
        let error = "";
        child.stderr!.on("data", (chunk) => {
          error += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(Error(error))));
      });
      native.validate();
    } finally {
      closeSync(fd);
    }
  }
  async copy(
    source: string,
    destination: string,
    identity: string,
    temporary: string,
    native?: import("./native-import").NativeImport,
  ) {
    if (native) {
      this.path(destination);
      native.validate();
      if (native.containsDirectory(resolve(this.root, dirname(destination))))
        throw Error("Choose a destination outside the source folder.");
    } else this.validateMove(source, destination);
    const parent = dirname(destination);
    const parentIdentity =
      parent === "." ? this.checkoutIdentity() : this.operationIdentity(parent);
    const fd = this.checkedDirectory();
    let staging = "";
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          this.helper,
          [
            native ? "import" : "copy",
            source,
            destination,
            identity,
            temporary,
            parentIdentity,
            ...(native ? [native.path, native.parents, this.root] : []),
          ],
          {
            stdio: ["ignore", "pipe", "pipe", fd, ...(native ? [native.fd] : [])],
          },
        );
        child.stdout!.on("data", (chunk) => {
          staging += chunk;
        });
        let errorText = "";
        child.stderr!.on("data", (chunk) => {
          errorText += chunk;
        });
        child.on("error", reject);
        child.on("close", (code, signal) =>
          code === 0
            ? resolve()
            : reject(
                Object.assign(
                  Error(
                    errorText + (staging ? ` Opened copy staging object: ${staging.trim()}` : ""),
                  ),
                  { uncertain: true, signalled: !!signal },
                ),
              ),
        );
      });
      this.checkoutIdentity();
    } catch (error) {
      const absent = (path: string) => {
        try {
          this.operationIdentity(path);
          return false;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === "ENOENT";
        }
      };
      if (staging || (error as { signalled?: boolean }).signalled)
        throw Object.assign(error as Error, { uncertain: true });
      if (absent(destination) && absent(temporary))
        throw Object.assign(error as Error, { uncertain: false });
      throw error;
    } finally {
      closeSync(fd);
    }
  }
  trash(source: string, identity: string) {
    return this.io(["trash", this.path(source), "-", identity]).toString();
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
  async status() {
    let output: Buffer;
    try {
      if (this.filesOnly) {
        const live = await Checkout.open(this.root, this.helper);
        try {
          if (
            live.repositoryGit.repository() !== this.repositoryGit.repository() ||
            live.identity.dev !== this.identity.dev ||
            live.identity.ino !== this.identity.ino
          )
            throw Error("Checkout identity changed. Restore the original checkout.");
          this.executable = live.executable;
          this.repositoryGit.gitDirectory = live.repositoryGit.gitDirectory;
          this.repositoryGit.gitIdentity = live.repositoryGit.gitIdentity;
          this.filesOnly = false;
        } finally {
          live.close();
        }
      }
      output = this.git([
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--no-renames",
      ]);
    } catch (error) {
      if (!this.filesOnly && typeof (error as { status?: unknown }).status !== "number")
        throw error;
      closeSync(this.checkedDirectory());
      return {
        project: this.repositoryGit.repository(),
        root: this.root,
        branch: "Git unavailable",
        changes: [] as Change[],
        gitError:
          "Git unavailable. Restore Git or repository access, then Retry Git. File editing and existing chats remain available.",
      };
    }
    const records = output.toString("utf8").split("\0").filter(Boolean);
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
    return { project: this.repositoryGit.repository(), root: this.root, branch, changes };
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
  (operation: "drag-capture", checkout: string, paths: string[]): Promise<string>;
  (
    operation: "clipboard-capture",
    checkout: string,
    kind: "copy" | "cut",
    paths: string[],
  ): Promise<string>;
  (
    operation: "transfer",
    checkout: string,
    kind: "paste" | "duplicate" | "drag-move" | "drag-copy" | "import",
    parent: string,
    paths: string[],
  ): Promise<{
    results: (import("./file-operations").OperationResult & { source: string })[];
    open: string[];
    requiresAck: boolean;
    message: string;
  }>;

  (
    operation: "trash-selection",
    checkout: string,
    paths: string[],
  ): Promise<{
    results: import("./file-operations").TrashResult[];
    saves: import("./file-operations").SavedFile[];
    requiresAck: boolean;
    message: string;
  }>;

  (
    operation: "file-operation",
    checkout: string,
    kind: "move" | "rename",
    source: string,
    destination: string,
  ): Promise<import("./file-operations").OperationResult>;
  (
    operation: "create-entry",
    checkout: string,
    parent: string,
    name: string,
    kind: "file" | "folder",
  ): Promise<string>;
  (operation: "file-operation-ack", checkout: string): Promise<void>;

  (
    operation: "worktree-managed",
    checkout: string,
  ): Promise<ReturnType<Checkout["repositoryGit"]["managedWorktrees"]>>;
  (operation: "worktree-remove", checkout: string, root: string): Promise<boolean>;
  (operation: "open"): Promise<Awaited<ReturnType<Checkout["status"]>> | null>;
  (
    operation: "worktree-options",
    checkout: string,
  ): Promise<ReturnType<Checkout["repositoryGit"]["worktreeOptions"]>>;
  (operation: "status", checkout: string): ReturnType<Checkout["status"]>;
  (
    operation: "entry-action",
    checkout: string,
    path: string,
    action: "copy-path" | "copy-relative" | "finder",
  ): Promise<void>;
  (operation: "read", checkout: string, path: string): ReturnType<Checkout["read"]>;
  (
    operation: "save",
    checkout: string,
    path: string,
    text: string,
    version: string,
  ): ReturnType<Checkout["save"]>;
  (
    operation: "diff",
    checkout: string,
    path: string,
    area: Change["area"],
  ): ReturnType<Checkout["diff"]>;
}
