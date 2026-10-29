import { test, expect } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "./workspace";
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
