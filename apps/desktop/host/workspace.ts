import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { atomicWriteJson } from "./atomic-write";
export type WorkspaceState = import("@escode/contracts").Mutable<import("@escode/contracts").WorkspaceState>;
export type RecoveryDraft = WorkspaceState["drafts"][number];
export type ViewMemory = WorkspaceState["views"][string];
export type FilesMemory = NonNullable<ViewMemory["files"]>;
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
  if (s.projectUse !== undefined && (
    !Array.isArray(s.projectUse) || s.projectUse.some(p => !p || typeof p.project !== "string" || !isAbsolute(p.project)
      || (p.checkout !== undefined && (typeof p.checkout !== "string" || !isAbsolute(p.checkout))))
    || new Set(s.projectUse.map(p => p.project)).size !== s.projectUse.length
  )) throw Error("Invalid project use");
  if (new Set(s.projects.map(p => p.root)).size !== s.projects.length)
    throw Error("Duplicate checkout memory");
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
        (v.files.hideIgnored !== undefined && typeof v.files.hideIgnored !== "boolean") ||
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
  constructor(private file: string, private owner?: { hostId: string; clientId: string }) {}
  private decode(value: unknown) {
    if (!this.owner) return value;
    const stored = value as { storageVersion?: number; hostId?: string; clientId?: string };
    if (stored?.storageVersion !== 1 || stored.hostId !== this.owner.hostId || stored.clientId !== this.owner.clientId)
      throw Error("Unsupported or wrongly owned client recovery store; retained for inspection.");
    return value;
  }
  private async readApprovals(): Promise<{ project: string; root: string; directoryIdentity?: string }[]> {
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
            !isAbsolute(p.root) ||
            (p.directoryIdentity !== undefined && !/^\d+:\d+$/.test(p.directoryIdentity)),
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
  approve(project: string, root: string, directoryIdentity?: string) {
    return this.change(async () => {
      if (!isAbsolute(project) || !isAbsolute(root)) throw Error("Invalid project approval");
      const approved = await this.readApprovals();
      if (directoryIdentity !== undefined && !/^\d+:\d+$/.test(directoryIdentity))
        throw Error("Invalid checkout identity");
      const previous = approved.find((p) => p.project === project && p.root === root);
      if (previous?.directoryIdentity && directoryIdentity && previous.directoryIdentity !== directoryIdentity)
        throw Error("Checkout identity changed. Restore the original directory.");
      if (!previous || directoryIdentity && !previous.directoryIdentity) {
        if (previous) previous.directoryIdentity = directoryIdentity;
        else approved.push({ project, root, ...(directoryIdentity ? { directoryIdentity } : {}) });
        await this.replace(join(dirname(this.file), "approved-projects.json"), approved);
      }
    });
  }
  async read(): Promise<WorkspaceState> {
    await this.queue;
    try {
      const state: unknown = this.decode(JSON.parse(await readFile(this.file, "utf8")));
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
  private change(edit: () => Promise<void>) {
    const task = this.queue.then(edit);
    this.queue = task.catch(() => {});
    return task;
  }
  private replace(file: string, value: unknown) {
    return atomicWriteJson(file, () => this.owner && file === this.file
      ? { ...(value === null ? { intent: null } : value as object), storageVersion: 1, ...this.owner }
      : value);
  }
}
