import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { atomicWriteJson } from "./atomic-write";

export type Intent = {
  root: string;
  checkoutIdentity: string;
  source: string;
  destination: string;
  kind: "move" | "trash" | "save" | "copy";
  identity: string;
  completed?: boolean;
  temporary?: string;
  copies?: import("./workspace").WorkspaceState["drafts"];
  saveText?: string;
  savedDisk?: import("./project").Document;
};

export class FileOperationJournal {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string, private owner?: { hostId: string; clientId: string }) {}
  private decode(value: unknown) {
    if (!this.owner) return value;
    const stored = value as { storageVersion?: number; hostId?: string; clientId?: string };
    if (stored?.storageVersion !== 1 || stored.hostId !== this.owner.hostId || stored.clientId !== this.owner.clientId)
      throw Error("Unsupported or wrongly owned client recovery store; retained for inspection.");
    return value;
  }
  async readIntent(): Promise<Intent | null> {
    await this.queue;
    try {
      const v = this.decode(JSON.parse(await readFile(this.file, "utf8"))) as any;
      if (v === null || (this.owner && v.intent === null)) return null;
      if (
        !v ||
        !isAbsolute(v.root) ||
        !["move", "trash", "save", "copy"].includes(v.kind) ||
        typeof v.checkoutIdentity !== "string" ||
        typeof v.identity !== "string" ||
        typeof v.source !== "string" ||
        !v.source ||
        isAbsolute(v.source) ||
        v.source.split("/").some((p: string) => p === ".." || p.toLowerCase() === ".git") ||
        typeof v.destination !== "string" ||
        (["move", "copy"].includes(v.kind) &&
          (!v.destination ||
            isAbsolute(v.destination) ||
            v.destination
              .split("/")
              .some((p: string) => p === ".." || p.toLowerCase() === ".git"))) ||
        (v.kind === "copy" &&
          (!Array.isArray(v.copies) ||
            v.copies.some(
              (d: any) =>
                !d ||
                d.root !== v.root ||
                typeof d.path !== "string" ||
                isAbsolute(d.path) ||
                !(d.path === v.destination || d.path.startsWith(v.destination + "/")) ||
                d.path.split("/").some((p: string) => p === ".." || p.toLowerCase() === ".git") ||
                typeof d.text !== "string" ||
                typeof d.disk?.text !== "string" ||
                typeof d.disk?.version !== "string",
            ))) ||
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
  writeIntent(intent: Intent | null) {
    return this.change(() => this.replace(this.file, intent));
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
