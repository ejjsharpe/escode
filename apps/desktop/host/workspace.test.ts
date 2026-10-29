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
    expect(await restarted.read()).toEqual(closed);
    expect(await restarted.approved()).toEqual(state.savedProjects);
    // Invalid updates cannot erase an acknowledged closed-project recovery draft.
    await expect(
      restarted.write({ ...closed, drafts: [{ ...state.drafts[0], path: "../outside" }] }),
    ).rejects.toThrow("Invalid recovery draft");
    expect(await restarted.read()).toEqual(closed);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
