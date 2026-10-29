import { test, expect } from "vite-plus/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Project } from "./project";
test("save detects external changes, preserves disk, and requires the compared version for overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a.txt"), "one");
    const project = await Project.open(root);
    const loaded = await project.read("a.txt");
    await writeFile(join(root, "a.txt"), "external");
    const conflict = await project.save("a.txt", "mine", loaded.version);
    expect(conflict.kind).toBe("conflict");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("external");
    if (conflict.kind !== "conflict") throw Error("Expected conflict");
    await writeFile(join(root, "a.txt"), "changed again");
    expect((await project.save("a.txt", "mine", conflict.disk.version)).kind).toBe("conflict");
    const current = await project.read("a.txt");
    expect((await project.save("a.txt", "mine", current.version)).kind).toBe("saved");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("mine");
    await expect(project.read("../outside")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Git diffs use HEAD, index and disk and refresh after external changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-git-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]);
  try {
    git("init");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    await writeFile(join(root, "a.txt"), "head\n");
    git("add", ".");
    git("commit", "-m", "initial");
    await writeFile(join(root, "a.txt"), "index\n");
    git("add", ".");
    await writeFile(join(root, "a.txt"), "disk\n");
    await writeFile(join(root, "new.txt"), "new\n");
    const project = await Project.open(root);
    expect((await project.status()).changes).toEqual(
      expect.arrayContaining([
        { path: "a.txt", area: "staged" },
        { path: "a.txt", area: "unstaged" },
        { path: "new.txt", area: "untracked" },
      ]),
    );
    expect(await project.diff({ path: "a.txt", area: "staged" })).toEqual({
      original: "head\n",
      modified: "index\n",
    });
    expect(await project.diff({ path: "a.txt", area: "unstaged" })).toEqual({
      original: "index\n",
      modified: "disk\n",
    });
    expect(await project.diff({ path: "new.txt", area: "untracked" })).toEqual({
      original: "",
      modified: "new\n",
    });
    git("add", ".");
    expect((await project.status()).changes.every((c) => c.area === "staged")).toBe(true);
    await writeFile(join(root, "binary"), Buffer.from([0, 1]));
    await expect(project.diff({ path: "binary", area: "untracked" })).rejects.toThrow("binary");
    await writeFile(join(root, "large"), "x".repeat(2 * 1024 * 1024 + 1));
    await expect(project.read("large")).rejects.toThrow("2 MiB");
    await rm(join(root, "a.txt"));
    await expect(project.save("a.txt", "mine", "old")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("unborn HEAD and literal wildcard filenames have correct baselines", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-literal-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a*.txt"), "literal");
    await writeFile(join(root, "ab.txt"), "other");
    execFileSync("git", ["-C", root, "add", "."]);
    const project = await Project.open(root);
    expect(await project.diff({ path: "a*.txt", area: "staged" })).toEqual({
      original: "",
      modified: "literal",
    });
    await writeFile(join(root, "a*.txt"), "edited");
    expect(await project.diff({ path: "a*.txt", area: "unstaged" })).toEqual({
      original: "literal",
      modified: "edited",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("concurrent saves recheck versions and failed saves retain the last disk contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-save-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a"), "start");
    const project = await Project.open(root);
    const loaded = await project.read("a");
    const results = await Promise.all([
      project.save("a", "first", loaded.version),
      project.save("a", "second", loaded.version),
    ]);
    expect(results.map((r) => r.kind)).toEqual(["saved", "conflict"]);
    expect((await project.read("a")).text).toBe("first");
    await expect(
      project.save("a", "x".repeat(2 * 1024 * 1024 + 1), loaded.version),
    ).rejects.toThrow();
    expect((await project.read("a")).text).toBe("first");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
