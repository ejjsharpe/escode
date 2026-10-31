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

test("closed editor membership persists independently of catalogue, checkout memories, recovery and approvals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-closed-workspace-"));
  try {
    const file = join(dir, "workspace.json"),
      store = new Workspace(file);
    const project = join(dir, "project"),
      checkout = join(dir, "worktree");
    await store.approve(project, project);
    const state = {
      projects: [{ project, root: project }],
      savedProjects: [{ project, root: project }],
      selected: project,
      agentsChat: "global-chat",
      views: {
        [project]: {
          mode: "Source Control",
          checkout,
          roots: [project, checkout],
          chat: "local-chat",
        },
        [checkout]: {
          path: "folder/a.ts",
          directory: "folder",
          files: {
            expanded: ["folder"],
            selected: ["folder/a.ts"],
            focus: "folder/a.ts",
            scroll: 0,
            hideIgnored: true,
          },
          change: { path: "folder/a.ts", area: "unstaged" as const },
        },
      },
      drafts: [
        {
          root: checkout,
          path: "folder/a.ts",
          text: "recovered",
          disk: { text: "disk", version: "loaded" },
        },
      ],
    };
    await store.write(state);
    const closed = { ...state, projects: [], selected: "agents" };
    await store.write(closed);
    const restarted = new Workspace(file);
    const migrated = {
      ...closed,
      views: {
        [project]: {
          ...closed.views[project],
          files: { expanded: [], selected: [], focus: "", scroll: 0 },
        },
        [checkout]: {
          ...closed.views[checkout],
          files: {
            expanded: ["folder"],
            selected: ["folder/a.ts"],
            focus: "folder/a.ts",
            scroll: 0,
            hideIgnored: true,
          },
        },
      },
    };
    expect(await restarted.read()).toEqual(migrated);
    expect(await restarted.approved()).toEqual(state.savedProjects);
    // Invalid membership cannot erase an acknowledged closed-project recovery draft.
    await expect(restarted.write({ ...closed, projects: [state.projects[0], state.projects[0]] }))
      .rejects.toThrow("Duplicate checkout memory");
    expect(await restarted.read()).toEqual(migrated);
    // Invalid updates cannot erase an acknowledged closed-project recovery draft.
    await expect(
      restarted.write({ ...closed, drafts: [{ ...state.drafts[0], path: "../outside" }] }),
    ).rejects.toThrow("Invalid recovery draft");
    expect(await restarted.read()).toEqual(migrated);
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
    migrated.views[dir].files!.hideIgnored = true;
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

test("fresh client recovery retains ownership and rejects unsupported or other-client stores", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-client-recovery-"));
  try {
    const file = join(dir, "client-workspace-v1.json");
    const owner = { hostId: "host", clientId: "client" };
    const store = new Workspace(file, owner);
    await store.write({ projects: [], selected: "", views: {}, drafts: [{
      root: dir, path: "a", text: "available edit", disk: { text: "loaded disk", version: "loaded hash" },
    }] });
    expect((await new Workspace(file, owner).read()).drafts[0]).toMatchObject({
      text: "available edit", disk: { text: "loaded disk", version: "loaded hash" },
    });
    await expect(new Workspace(file, { ...owner, clientId: "other" }).read()).rejects.toThrow("wrongly owned");
    const { readFile, writeFile } = await import("node:fs/promises");
    const bytes = await readFile(file, "utf8");
    await writeFile(file, JSON.stringify({ ...JSON.parse(bytes), storageVersion: 2 }));
    await expect(new Workspace(file, owner).read()).rejects.toThrow("Unsupported");
    expect((await readFile(file, "utf8"))).toContain("available edit");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("checkout approvals retain the native directory identity independently of client membership", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-checkout-approval-"));
  try {
    const store = new Workspace(join(dir, "workspace.json"));
    await store.approve(dir, dir, "1:42");
    await store.write({ projects: [], selected: "agents", views: {}, drafts: [] });
    await expect(store.approve(dir, dir, "1:43")).rejects.toThrow("Checkout identity changed");
    expect(await new Workspace(join(dir, "workspace.json")).approved()).toEqual([
      { project: dir, root: dir, directoryIdentity: "1:42" },
    ]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
