import { test, expect } from "vite-plus/test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createFileWorkflow } from "./file-workflow";
import { FoundationState } from "./foundation-state";
import { Workspace } from "./workspace";
import { Project } from "./project";

test("collision consent shares the mutation gate and Keep Both preserves existing files", async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "escode-workflow-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  mkdirSync(join(root, "target"));
  writeFileSync(join(root, "a.txt"), "source");
  writeFileSync(join(root, "target/a.txt"), "destination");
  const project = await Project.open(root);
  const foundation = FoundationState.open(join(base, "foundation"));
  const workspace = new Workspace(join(base, "workspace.json"), foundation.read());
  let dialogs = 0;
  const files = createFileWorkflow({
    userData: base,
    workspace,
    foundation,
    projects: new Map([[root, project]]),
    projectSessions: new Map([[project.repository(), {}]]),
    removing: new Set(),
    checkout: async () => project,
    isQuitting: () => false,
    clipboard: { read: async () => [] },
    writeClipboard: async () => {},
    showMessageBox: async (options) => {
      dialogs++;
      expect(options.message).toContain("Destination occupied");
      expect(() => files.assertIdle()).toThrow("awaiting confirmation");
      await expect(
        files.hostActions.moveEntry({ root, action: "move", source: "a.txt", target: "b.txt" }),
      ).rejects.toThrow("Another file operation");
      return { response: options.buttons!.indexOf("Keep Both"), checkboxChecked: false };
    },
  });
  try {
    const token = await files.hostActions.transferAction({
      root,
      operation: "drag-capture",
      paths: ["a.txt"],
    });
    const result = await files.hostActions.transferAction({
      root,
      operation: "transfer",
      kind: "drag-copy",
      paths: [token as string],
      parent: "target",
    });
    expect(dialogs).toBe(1);
    expect(result).toMatchObject({ results: [{ applied: true }], requiresAck: true });
    expect(readFileSync(join(root, "target/a.txt"), "utf8")).toBe("destination");
    expect(readFileSync(join(root, "target/a copy.txt"), "utf8")).toBe("source");
    await files.hostActions.ackFileOperation(root);
    files.assertIdle();
  } finally {
    files.clearImports();
    project.close();
    foundation.close();
    rmSync(base, { recursive: true, force: true });
  }
});
