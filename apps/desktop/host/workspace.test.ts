import { test, expect } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "./workspace";
test("renderer workspace data cannot change host project approvals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-approvals-"));
  try {
    const store = new Workspace(join(dir, "workspace.json"));
    await store.approve(dir, dir);
    await store.write({
      projects: [{ project: "/unapproved", root: "/unapproved" }],
      selected: "/unapproved",
      views: {},
      drafts: [],
    });
    expect(await new Workspace(join(dir, "workspace.json")).approved()).toEqual([
      { project: dir, root: dir },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("acknowledged recovery survives a fresh store; discard cannot resurrect it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-recovery-"));
  try {
    const file = join(dir, "workspace.json");
    const store = new Workspace(file);
    const state = {
      projects: [{ project: dir, root: dir }],
      selected: dir,
      views: {},
      drafts: [
        {
          root: dir,
          path: "a.txt",
          text: "edits",
          disk: { text: "original", version: "baseline" },
        },
      ],
    };
    // Recovery must retain even edits too large to save as a supported file.
    const oversized = {
      ...state.drafts[0],
      path: "large.txt",
      text: "é".repeat(2 * 1024 * 1024 + 1),
    };
    await store.write({ ...state, drafts: [oversized] });
    await store.write({ ...state, drafts: [oversized, state.drafts[0]] });
    expect((await new Workspace(file).read()).drafts[1].text).toBe("edits");
    await store.write(state);
    expect(await new Workspace(file).read()).toEqual(state);
    await store.write({ ...state, drafts: [] });
    expect((await new Workspace(file).read()).drafts).toEqual([]);
    await expect(store.write({ drafts: "bad" })).rejects.toThrow();
    expect((await store.read()).drafts).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("legacy Files navigation migrates through a fresh store while drafts and approvals survive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-tree-migration-"));
  try {
    const file = join(dir, "workspace.json");
    const store = new Workspace(file);
    await store.approve(dir, dir);
    const draft = {
      root: dir,
      path: "src/deep/a.ts",
      text: "unsaved",
      disk: { text: "disk", version: "baseline" },
    };
    await store.write({
      projects: [{ project: dir, root: dir }],
      selected: dir,
      views: { [dir]: { directory: "src/deep", path: draft.path } },
      drafts: [draft],
    });
    const migrated = await new Workspace(file).read();
    expect(migrated.views[dir].files).toEqual({
      expanded: ["src", "src/deep"],
      focus: draft.path,
      selected: [draft.path],
      scroll: 0,
    });
    migrated.views[dir].files!.scroll = 140;
    await store.write(migrated);
    const fresh = new Workspace(file);
    expect(await fresh.read()).toEqual(migrated);
    expect((await fresh.read()).drafts).toEqual([draft]);
    expect(await fresh.approved()).toEqual([{ project: dir, root: dir }]);
    await expect(
      store.write({
        ...migrated,
        views: {
          [dir]: { files: { expanded: ["../outside"], selected: [], focus: "", scroll: 0 } },
        },
      }),
    ).rejects.toThrow("Invalid Files memory");
    expect((await fresh.read()).drafts).toEqual([draft]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
