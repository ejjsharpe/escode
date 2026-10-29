import { Project } from "./project";
import { Workspace } from "./workspace";
export type Intent = {
  root: string;
  checkoutIdentity: string;
  source: string;
  destination: string;
  kind: "move" | "trash";
  identity: string;
  completed?: boolean;
};
export type OperationResult = { applied: boolean; message: string; intent?: Intent };
import { affected, reconcile } from "./file-operation-state";
// One journal survives the disk/workspace handoff. Never infer success from absence alone.
export class FileOperations {
  private journal: Workspace;
  private pending?: Intent;
  busy = false;
  constructor(
    private workspace: Workspace,
    file: string,
  ) {
    this.journal = new Workspace(file);
  }
  async recover(project: (root: string) => Promise<Project>) {
    const record = await this.journal.readIntent();
    if (!record) return "";
    this.pending = record;
    try {
      const p = await project(record.root);
      if (p.checkoutIdentity() !== record.checkoutIdentity) throw Error("Checkout replaced");
      const identity = (path: string) => {
        try {
          return p.operationIdentity(path);
        } catch {
          return "";
        }
      };
      const source = identity(record.source),
        destination = record.kind === "move" ? identity(record.destination) : "";
      if (
        record.completed ||
        (record.kind === "move" && destination === record.identity && source !== record.identity)
      ) {
        const state = await this.workspace.read();
        reconcile(state, record);
        await this.workspace.write(state);
        await this.ack();
        return `Recovered ${record.kind}: ${record.root}/${record.source} → ${record.destination || "macOS Trash"}. Earlier text undo history was reset.`;
      }
      if (source === record.identity && destination !== record.identity) {
        await this.ack();
        return "Interrupted operation did not move its source; drafts retained.";
      }
    } catch {
      /* Unavailable or replaced checkout: retain journal and drafts. */
    }
    return `Uncertain file operation: inspect ${record.root}/${record.source} and ${record.destination || "Finder Trash"}. Available drafts retained; file mutations are blocked until the original paths can be reconciled on restart.`;
  }
  assertIdle() {
    if (this.busy || this.pending)
      throw Error(
        "File operation pending reconciliation. Restart to reconcile actual paths; available edits are retained.",
      );
  }
  async run(
    p: Project,
    kind: Intent["kind"],
    source: string,
    destination: string,
    validateOrigin: () => void = () => {},
  ): Promise<OperationResult> {
    this.assertIdle();
    this.busy = true;
    try {
      if (kind === "move") p.validateMove(source, destination);
      const intent: Intent = {
        root: p.root,
        checkoutIdentity: p.checkoutIdentity(),
        kind,
        source,
        destination,
        identity: p.operationIdentity(source),
      };
      if (kind === "move") {
        const state = await this.workspace.read();
        if (
          state.drafts.some(
            (d) =>
              d.root === p.root &&
              !affected(d.path, source) &&
              affected(
                d.path.normalize("NFC").toLowerCase(),
                destination.normalize("NFC").toLowerCase(),
              ),
          )
        )
          throw Error("Destination recovery drafts need preserving. Choose a free destination.");
      }
      await this.journal.writeIntent(intent);
      this.pending = intent;
      try {
        validateOrigin();
        if (kind === "move") p.move(source, destination, intent.identity);
        else p.trash(source, intent.identity);
      } catch (error) {
        // Only a still-identical source proves a failed mutation. Otherwise retain intent.
        let unchanged = false;
        try {
          unchanged = p.operationIdentity(source) === intent.identity;
        } catch {
          /* Keep uncertain intent. */
        }
        if (unchanged && !(error as { uncertain?: boolean }).uncertain) {
          await this.ack();
          throw error;
        }
        throw Error(
          `Uncertain ${kind}: inspect ${p.root}/${source} and ${destination || "Finder Trash"}. Available edits and intent retained; restart to reconcile actual paths. ${String(error)}`,
        );
      }
      intent.completed = true;
      try {
        await this.journal.writeIntent(intent);
        const state = await this.workspace.read();
        reconcile(state, intent);
        await this.workspace.write(state);
      } catch (error) {
        return {
          applied: true,
          intent,
          message: `Disk operation completed; recovery persistence needs retry: ${String(error)}`,
        };
      }
      return {
        applied: true,
        intent,
        message:
          kind === "move"
            ? "Moved. Earlier text undo history was reset; new edits support undo."
            : "Moved to macOS Trash.",
      };
    } finally {
      this.busy = false;
    }
  }
  async ack(root?: string) {
    if (root && this.busy) throw Error("File operation still running.");
    if (root && this.pending?.root !== root) throw Error("Operation belongs to another checkout.");
    await this.journal.writeIntent(null);
    this.pending = undefined;
  }
}
