import { test, expect } from "vite-plus/test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createFileWorkflow } from "./file-workflow";
import { FoundationState } from "./foundation-state";
import { Workspace } from "./workspace";
import { Checkout } from "./project";

test("collision consent shares the mutation gate and Keep Both preserves existing files", async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "escode-workflow-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  mkdirSync(join(root, "target"));
  writeFileSync(join(root, "a.txt"), "source");
  writeFileSync(join(root, "target/a.txt"), "destination");
  const project = await Checkout.open(root);
  const foundation = FoundationState.open(join(base, "foundation"));
  const workspace = new Workspace(join(base, "workspace.json"), foundation.read());
  let dialogs = 0;
  const files = createFileWorkflow({
    userData: base,
    workspace,
    foundation,
    projects: new Map([[root, project]]),
    projectSessions: new Map([[project.repositoryGit.repository(), {}]]),
    removing: new Set(),
    checkout: async () => project,
    isQuitting: () => false,
    clipboard: { read: async () => [] },
    writeClipboard: async () => {},
    showMessageBox: async (options) => {
      dialogs++;
      expect(options.message).toContain("Destination occupied");
      await expect(
        files.hostActions.saveFile!(root, "a.txt", "blocked", "unused"),
      ).rejects.toThrow("awaiting confirmation");
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
    const disk = await files.hostActions.readFile!(root, "a.txt");
    await files.hostActions.saveFile!(root, "a.txt", "saved", disk.version);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("saved");
  } finally {
    files.clearImports();
    project.close();
    foundation.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("exact lookup accepts deliberate excluded paths only in its approved checkout and bounds input", async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "escode-exact-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "node_modules/known.txt"), "deliberate");
  const project = await Checkout.open(root);
  const foundation = FoundationState.open(join(base, "foundation"));
  const files = createFileWorkflow({
    userData: join(base, "user"), workspace: new Workspace(join(base, "workspace.json"), foundation.read()),
    foundation, projects: new Map([[root, project]]),
    projectSessions: new Map([[project.repositoryGit.repository(), {}]]), removing: new Set(),
    checkout: async () => project, isQuitting: () => false,
    clipboard: { read: async () => [] }, writeClipboard: async () => {},
    showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
  });
  try {
    expect(await files.hostActions.lookupFile!(root, "node_modules/known.txt")).toBe("node_modules/known.txt");
    expect(await files.hostActions.lookupFile!(root, join(root, "node_modules/known.txt"))).toBe("node_modules/known.txt");
    for (const query of ["../repo/node_modules/known.txt", join(base, "outside"), "x".repeat(4097), "a\0b", ""]) {
      await expect(files.hostActions.lookupFile!(root, query)).rejects.toThrow();
    }
    await expect(files.hostActions.lookupFile!(base, "known.txt")).rejects.toThrow("approve");
    symlinkSync(join(root, "node_modules"), join(root, "linked"));
    await expect(files.hostActions.lookupFile!(root, "linked/known.txt")).rejects.toThrow();
    renameSync(root, root + "-old");
    mkdirSync(root);
    await expect(files.hostActions.lookupFile!(root, "node_modules/known.txt")).rejects.toThrow();

  } finally {
    files.clearImports(); project.close(); foundation.close(); rmSync(base, { recursive: true, force: true });
  }
});
