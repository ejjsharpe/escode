import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Document } from "./project";
export type RecoveryDraft = { root: string; path: string; text: string; disk: Document };
export type FilesMemory = { expanded: string[]; selected: string[]; focus: string; scroll: number };
export type ViewMemory = {
  files?: FilesMemory;
  mode?: string;
  checkout?: string;
  roots?: string[];
  path?: string;
  directory?: string;
  change?: { path: string; area: "staged" | "unstaged" | "untracked" };
  chat?: string;
};
export type WorkspaceState = {
  projects: { project: string; root: string }[];
  savedProjects?: { project: string; root: string }[];
  agentsChat?: string;
  selected: string;
  views: Record<string, ViewMemory>;
  drafts: RecoveryDraft[];
};
export type RestoredStatus = {
  project: string;
  root: string;
  branch: string;
  changes: import("./project").Change[];
  gitError?: string;
  approvalRequired?: boolean;
};
export interface LifecycleBridge {
  (
    operation: "load",
  ): Promise<{ state: WorkspaceState; restored: RestoredStatus[]; errors: string[] }>;
  (operation: "persist", state: WorkspaceState): Promise<void>;
  (operation: "dirty", path: string): Promise<0 | 1 | 2>;
  (operation: "prepare", project?: string): Promise<boolean>;
  (operation: "finish", project?: string): Promise<void>;
}
export const emptyWorkspace = (): WorkspaceState => ({
  projects: [],
  selected: "",
  views: {},
  drafts: [],
});
function validate(value: unknown): asserts value is WorkspaceState {
  const s = value as WorkspaceState;
  if (
    !s ||
    !Array.isArray(s.projects) ||
    !Array.isArray(s.drafts) ||
    typeof s.selected !== "string" ||
    !s.views ||
    typeof s.views !== "object" ||
    Array.isArray(s.views)
  )
    throw Error("Invalid workspace");
  if (
    (s.savedProjects !== undefined && !Array.isArray(s.savedProjects)) ||
    (s.agentsChat !== undefined && typeof s.agentsChat !== "string") ||
    [...s.projects, ...(s.savedProjects ?? [])].some(
      (p) =>
        !p ||
        typeof p.project !== "string" ||
        !isAbsolute(p.project) ||
        typeof p.root !== "string" ||
        !isAbsolute(p.root),
    )
  )
    throw Error("Invalid project memory");
  for (const d of s.drafts) {
    if (
      !d ||
      typeof d.root !== "string" ||
      !isAbsolute(d.root) ||
      typeof d.path !== "string" ||
      !d.path ||
      isAbsolute(d.path) ||
      d.path.split("/").includes("..") ||
      typeof d.text !== "string" ||
      typeof d.disk?.text !== "string" ||
      typeof d.disk.version !== "string"
    )
      throw Error("Invalid recovery draft");
  }
  for (const v of Object.values(s.views)) {
    if (
      v?.files !== undefined &&
      (!v.files ||
        typeof v.files !== "object" ||
        !Array.isArray(v.files.expanded) ||
        !Array.isArray(v.files.selected) ||
        [...v.files.expanded, ...v.files.selected, v.files.focus].some(
          (p) =>
            typeof p !== "string" ||
            p.startsWith("/") ||
            p.split("/").some((c) => c === ".." || c.toLowerCase() === ".git"),
        ) ||
        !Number.isFinite(v.files.scroll) ||
        v.files.scroll < 0)
    )
      throw Error("Invalid Files memory");
    if (
      !v ||
      typeof v !== "object" ||
      (v.mode !== undefined && !["Files", "Source Control", "Chats"].includes(v.mode)) ||
      [v.checkout, v.path, v.directory, v.chat].some(
        (x) => x !== undefined && typeof x !== "string",
      ) ||
      (v.roots !== undefined &&
        (!Array.isArray(v.roots) || v.roots.some((x) => typeof x !== "string"))) ||
      (v.change !== undefined &&
        (typeof v.change.path !== "string" ||
          !["staged", "unstaged", "untracked"].includes(v.change.area)))
    )
      throw Error("Invalid view memory");
  }
}
export class Workspace {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  private async readApprovals(): Promise<{ project: string; root: string }[]> {
    try {
      const value = JSON.parse(
        await readFile(join(dirname(this.file), "approved-projects.json"), "utf8"),
      );
      if (
        !Array.isArray(value) ||
        value.some(
          (p) =>
            !p ||
            typeof p.project !== "string" ||
            !isAbsolute(p.project) ||
            typeof p.root !== "string" ||
            !isAbsolute(p.root),
        )
      )
        throw Error("Invalid project approvals. Existing data is retained.");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async approved() {
    await this.queue;
    return this.readApprovals();
  }
  approve(project: string, root: string) {
    return this.change(async () => {
      if (!isAbsolute(project) || !isAbsolute(root)) throw Error("Invalid project approval");
      const approved = await this.readApprovals();
      if (!approved.some((p) => p.project === project && p.root === root)) {
        approved.push({ project, root });
        await this.replace(join(dirname(this.file), "approved-projects.json"), approved);
      }
    });
  }
  async read(): Promise<WorkspaceState> {
    await this.queue;
    try {
      const state: unknown = JSON.parse(await readFile(this.file, "utf8"));
      validate(state);
      for (const view of Object.values(state.views)) {
        if (!view.files) {
          const ancestors = (path: string) => {
            const parts = path.split("/").filter(Boolean);
            return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
          };
          view.files = {
            expanded: [
              ...new Set([
                ...ancestors(view.directory || ""),
                ...ancestors((view.path || "").split("/").slice(0, -1).join("/")),
              ]),
            ],
            selected: view.path ? [view.path] : [],
            focus: view.path || view.directory || "",
            scroll: 0,
          };
        }
      }
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyWorkspace();
      throw error;
    }
  }
  write(state: unknown, reconcileState?: (state: WorkspaceState) => void) {
    return this.change(async () => {
      validate(state);
      reconcileState?.(state);
      await this.replace(this.file, state);
    });
  }
  async readIntent(): Promise<import("./file-operations").Intent | null> {
    await this.queue;
    try {
      const v = JSON.parse(await readFile(this.file, "utf8"));
      if (v === null) return null;
      if (
        !v ||
        !isAbsolute(v.root) ||
        !["move", "trash", "save"].includes(v.kind) ||
        typeof v.checkoutIdentity !== "string" ||
        typeof v.identity !== "string" ||
        typeof v.source !== "string" ||
        !v.source ||
        isAbsolute(v.source) ||
        v.source.split("/").some((p: string) => p === ".." || p.toLowerCase() === ".git") ||
        typeof v.destination !== "string" ||
        (v.kind === "move" &&
          (!v.destination ||
            isAbsolute(v.destination) ||
            v.destination
              .split("/")
              .some((p: string) => p === ".." || p.toLowerCase() === ".git"))) ||
        (v.completed !== undefined && typeof v.completed !== "boolean") ||
        (v.kind === "save" &&
          (typeof v.saveText !== "string" ||
            (v.completed && !v.savedDisk) ||
            (v.savedDisk !== undefined &&
              (!v.savedDisk ||
                typeof v.savedDisk.text !== "string" ||
                typeof v.savedDisk.version !== "string"))))
      )
        throw Error("Invalid operation journal; retained for inspection.");
      return v;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  writeIntent(intent: import("./file-operations").Intent | null) {
    return this.change(() => this.replace(this.file, intent));
  }
  private change(edit: () => Promise<void>) {
    const task = this.queue.then(edit);
    this.queue = task.catch(() => {});
    return task;
  }
  private async replace(file: string, value: unknown) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + ".tmp";
    const fd = await open(temporary, "w", 0o600);
    try {
      await fd.writeFile(JSON.stringify(value));
      await fd.sync();
    } finally {
      await fd.close();
    }
    await rename(temporary, file);
    const directory = await open(dirname(file), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
