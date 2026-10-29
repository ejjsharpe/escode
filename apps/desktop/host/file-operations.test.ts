import { test, expect, vi } from "vite-plus/test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
  symlinkSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as child from "node:child_process";
import { Project } from "./project";
import { Workspace } from "./workspace";
import { FileOperations } from "./file-operations";
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
}));
async function fixture(run: (p: Project, store: Workspace, base: string) => Promise<void>) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "escode-operations-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  mkdirSync(join(root, "folder"));
  writeFileSync(join(root, "folder/a.ts"), "disk");
  writeFileSync(join(root, "folder/b.ts"), "second disk");
  const p = await Project.open(root);
  const store = new Workspace(join(base, "workspace.json"));
  await store.write({
    projects: [{ project: root, root }],
    selected: root,
    views: { [root]: { path: "folder/a.ts", directory: "folder" } },
    drafts: await Promise.all(
      ["a", "b"].map(async (name) => ({
        root,
        path: `folder/${name}.ts`,
        text: `${name} unsaved`,
        disk: await p.read(`folder/${name}.ts`),
      })),
    ),
  });
  try {
    await run(p, store, base);
  } finally {
    vi.restoreAllMocks();
    p.close();
    rmSync(base, { recursive: true, force: true });
  }
}
test("real folder move preserves descendant drafts and conflict baseline through a fresh store", async () =>
  fixture(async (p, store, base) => {
    const ops = new FileOperations(store, join(base, "intent.json"));
    await ops.run(p, "move", "folder", "renamed");
    const state = await new Workspace(join(base, "workspace.json")).read();
    expect(state.drafts.map((d) => d.path)).toEqual(["renamed/a.ts", "renamed/b.ts"]);
    expect(state.drafts[0].text).toBe("a unsaved");
    expect(state.views[p.root].files).toEqual({
      expanded: ["renamed"],
      selected: ["renamed/a.ts"],
      focus: "renamed/a.ts",
      scroll: 0,
    });
    expect(readFileSync(join(p.root, "renamed/a.ts"), "utf8")).toBe("disk");
    writeFileSync(join(p.root, "renamed/a.ts"), "external");
    expect((await p.save("renamed/a.ts", "a unsaved", state.drafts[0].disk.version)).kind).toBe(
      "conflict",
    );
    expect(existsSync(join(p.root, "folder"))).toBe(false);
  }));
test("restart reconciles a crash immediately after native rename, before completion is journalled", async () =>
  fixture(async (p, store, base) => {
    const file = join(base, "intent.json");
    const journal = new Workspace(file);
    await journal.writeIntent({
      root: p.root,
      checkoutIdentity: p.checkoutIdentity(),
      source: "folder",
      destination: "moved",
      kind: "move",
      identity: p.operationIdentity("folder"),
    });
    p.move("folder", "moved", p.operationIdentity("folder"));
    const fresh = new FileOperations(new Workspace(join(base, "workspace.json")), file);
    expect(await fresh.recover(async () => p)).toContain("Recovered move");
    expect((await store.read()).drafts[1].path).toBe("moved/b.ts");
    expect((await store.read()).views[p.root].files).toEqual({
      expanded: ["moved"],
      selected: ["moved/a.ts"],
      focus: "moved/a.ts",
      scroll: 0,
    });
    expect(await journal.readIntent()).toBe(null);
  }));
test("persistence failure after mutation returns the actual outcome and restart recovers edits", async () =>
  fixture(async (p, store, base) => {
    const ops = new FileOperations(store, join(base, "intent.json"));
    vi.spyOn(store, "write").mockRejectedValueOnce(Error("injected disk full"));
    const result = await ops.run(p, "move", "folder", "moved");
    expect(result.applied).toBe(true);
    expect(result.message).toContain("persistence");
    expect(
      await new FileOperations(
        new Workspace(join(base, "workspace.json")),
        join(base, "intent.json"),
      ).recover(async () => p),
    ).toContain("Recovered move");
    expect((await store.read()).drafts[0].path).toBe("moved/a.ts");
  }));
test("occupied, traversal, protected metadata, descendant and replaced checkout paths fail safely", async () =>
  fixture(async (p) => {
    writeFileSync(join(p.root, "occupied"), "retain");
    for (const target of ["occupied", "../outside", ".git/new", "folder/child", ""])
      expect(() => p.move("folder", target, p.operationIdentity("folder"))).toThrow();
    expect(() => p.trash(".", "ignored")).toThrow();
    mkdirSync(join(p.root, "folder/.git"));
    expect(() => p.move("folder", "moved", p.operationIdentity("folder"))).toThrow();
    renameSync(p.root, p.root + "-old");
    mkdirSync(p.root);
    expect(() => p.operationIdentity("folder")).toThrow("replaced");
  }));
for (const kind of ["move", "trash"] as const)
  test(`${kind} rejects a symlink-parent swap at native execution`, async () =>
    fixture(async (p, _store, base) => {
      const outside = join(base, "outside");
      mkdirSync(outside);
      writeFileSync(join(outside, "a.ts"), "outside");
      const id = p.operationIdentity("folder/a.ts");
      const execute = child.execFileSync;
      vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
        if (Array.isArray(args[1]) && args[1][0] === kind) {
          renameSync(join(p.root, "folder"), join(p.root, "original"));
          symlinkSync(outside, join(p.root, "folder"));
        }
        return execute(...args);
      });
      expect(() =>
        kind === "move" ? p.move("folder/a.ts", "new", id) : p.trash("folder/a.ts", id),
      ).toThrow();
      expect(readFileSync(join(outside, "a.ts"), "utf8")).toBe("outside");
    }));
test("native macOS Trash returns a recoverable disk object with unchanged bytes", async () =>
  fixture(async (p) => {
    const destination = p.trash("folder", p.operationIdentity("folder"));
    expect(destination).toContain(".Trash/");
    expect(existsSync(join(p.root, "folder"))).toBe(false);
    expect(readFileSync(join(destination, "a.ts"), "utf8")).toBe("disk");
    // Test-owned fixture only; production has no permanent-delete fallback.
    rmSync(destination, { recursive: true });
  }));
test("case-only rename keeps the same object and failed Trash preserves durable drafts", async () =>
  fixture(async (p, store, base) => {
    const id = p.operationIdentity("folder/a.ts");
    p.move("folder/a.ts", "folder/A.ts", id);
    expect(p.operationIdentity("folder/A.ts")).toBe(id);
    const ops = new FileOperations(store, join(base, "intent.json"));
    vi.spyOn(p, "trash").mockImplementationOnce(() => {
      throw Error("injected Trash failure");
    });
    await expect(ops.run(p, "trash", "folder", "")).rejects.toThrow("injected Trash failure");
    expect((await new Workspace(join(base, "workspace.json")).read()).drafts).toHaveLength(2);
    ops.assertIdle();
  }));
test("uncertain native outcome retains drafts and blocks mutations across a fresh store", async () =>
  fixture(async (p, store, base) => {
    const file = join(base, "intent.json");
    const journal = new Workspace(file);
    await journal.writeIntent({
      root: p.root,
      checkoutIdentity: p.checkoutIdentity(),
      source: "folder",
      destination: "moved",
      kind: "move",
      identity: p.operationIdentity("folder"),
    });
    renameSync(join(p.root, "folder"), join(p.root, "external-name"));
    const fresh = new FileOperations(new Workspace(join(base, "workspace.json")), file);
    expect(await fresh.recover(async () => p)).toContain("Uncertain file operation");
    expect(() => fresh.assertIdle()).toThrow("pending reconciliation");
    expect((await store.read()).drafts[0].text).toBe("a unsaved");
    expect(await journal.readIntent()).not.toBe(null);
    expect(existsSync(join(p.root, "folder"))).toBe(false);
  }));
test("destination parent swap cannot overwrite files outside the checkout", async () =>
  fixture(async (p, _store, base) => {
    const outside = join(base, "outside");
    mkdirSync(outside);
    mkdirSync(join(p.root, "target"));
    const execute = child.execFileSync;
    vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
      if (Array.isArray(args[1]) && args[1][0] === "move") {
        renameSync(join(p.root, "target"), join(p.root, "target-old"));
        symlinkSync(outside, join(p.root, "target"));
      }
      return execute(...args);
    });
    expect(() =>
      p.move("folder/a.ts", "target/new.ts", p.operationIdentity("folder/a.ts")),
    ).toThrow();
    expect(existsSync(join(outside, "new.ts"))).toBe(false);
    expect(readFileSync(join(p.root, "folder/a.ts"), "utf8")).toBe("disk");
  }));
test("origin is revalidated after durable intent and before filesystem mutation", async () =>
  fixture(async (p, store, base) => {
    const file = join(base, "intent.json");
    const ops = new FileOperations(store, file);
    await expect(
      ops.run(p, "move", "folder", "moved", () => {
        throw Error("origin closed while intent persisted");
      }),
    ).rejects.toThrow("origin closed");
    expect(readFileSync(join(p.root, "folder/a.ts"), "utf8")).toBe("disk");
    expect((await store.read()).drafts[0].text).toBe("a unsaved");
    ops.assertIdle();
  }));
test("case-only dirty folder move maps descendants without mistaking them for destination drafts", async () =>
  fixture(async (p, store, base) => {
    await new FileOperations(store, join(base, "intent.json")).run(p, "move", "folder", "FOLDER");
    expect((await store.read()).drafts.map((d) => d.path)).toEqual(["FOLDER/a.ts", "FOLDER/b.ts"]);
  }));
