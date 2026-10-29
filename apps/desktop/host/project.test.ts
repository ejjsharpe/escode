import { test, expect, vi, afterEach } from "vite-plus/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as child from "node:child_process";
import { Project } from "./project";
import * as fs from "node:fs";
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
}));
const projects: Project[] = [];
async function openProject(root: string) {
  const project = await Project.open(root);
  projects.push(project);
  return project;
}
afterEach(() => {
  for (const project of projects) project.close();
  projects.length = 0;
});

test("the agreed check-before-save policy permits an unrelated write after the final check", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-final-race-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a"), "loaded");
    const project = await openProject(root);
    const loaded = await project.read("a");
    const execute = child.execFileSync;
    let injected = false;
    vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
      if (Array.isArray(args[1]) && args[1][0] === "replace") {
        injected = true;
        execute(process.execPath, [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1], 'external at replacement')",
          join(root, "a"),
        ]);
      }
      return execute(...args);
    });
    const result = await project.save("a", "my buffer", loaded.version);
    expect(injected).toBe(true);
    expect(result.kind).toBe("saved");
    expect(await readFile(join(root, "a"), "utf8")).toBe("my buffer");
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});

test("a parent symlink introduced at replacement cannot redirect the save outside the checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-scope-race-"));
  const outside = await mkdtemp(join(tmpdir(), "escode-outside-"));
  try {
    execFileSync("git", ["init", root]);
    fs.mkdirSync(join(root, "dir"));
    await writeFile(join(root, "dir/a"), "loaded");
    await writeFile(join(outside, "a"), "outside");
    const project = await openProject(root);
    const loaded = await project.read("dir/a");
    const execute = child.execFileSync;
    vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
      if (Array.isArray(args[1]) && args[1][0] === "replace") {
        fs.renameSync(join(root, "dir"), join(root, "original"));
        fs.symlinkSync(outside, join(root, "dir"));
        const temp = args[1][2].split("/").at(-1)!;
        fs.renameSync(join(root, "original", temp), join(outside, temp));
      }
      return execute(...args);
    });
    await expect(project.save("dir/a", "my buffer", loaded.version)).rejects.toThrow();
    expect(await readFile(join(outside, "a"), "utf8")).toBe("outside");
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("an external write during save staging returns a conflict and removes temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-race-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a"), "loaded");
    const project = await openProject(root);
    const loaded = await project.read("a");
    const execute = child.execFileSync;
    vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
      const result = execute(...args);
      if (Array.isArray(args[1]) && args[1][0] === "stage")
        execute(process.execPath, [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1], 'external during staging')",
          join(root, "a"),
        ]);
      return result;
    });
    const result = await project.save("a", "my buffer", loaded.version);
    expect(result).toEqual({ kind: "conflict", disk: await project.read("a") });
    expect((await project.read("a")).text).toBe("external during staging");
    expect((await project.files()).map((f) => f.path)).toEqual(["a"]);
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});

test("replacement failures preserve disk and remove the staged file", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-replace-error-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a"), "loaded");
    const project = await openProject(root);
    const loaded = await project.read("a");
    const execute = child.execFileSync;
    vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
      if (Array.isArray(args[1]) && args[1][0] === "replace") fs.unlinkSync(join(root, args[1][2]));
      return execute(...args);
    });
    await expect(project.save("a", "mine", loaded.version)).rejects.toThrow("ENOENT");
    expect(await project.read("a")).toEqual(loaded);
    expect(await project.files()).toEqual([{ path: "a", directory: false }]);
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});

test("a staging-name collision preserves the pre-existing file", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-collision-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a"), "loaded");
    const project = await openProject(root);
    const loaded = await project.read("a");
    const execute = child.execFileSync;
    let collision = "";
    vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
      if (Array.isArray(args[1]) && args[1][0] === "stage") {
        collision = join(root, args[1][2]);
        fs.writeFileSync(collision, "external file");
      }
      return execute(...args);
    });
    await expect(project.save("a", "mine", loaded.version)).rejects.toThrow("EEXIST");
    expect(collision).not.toBe("");
    expect(await readFile(collision, "utf8")).toBe("external file");
    expect(await project.read("a")).toEqual(loaded);
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});

test("a partial staging failure removes its own temporary file and preserves disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-stage-error-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a"), "loaded");
    const project = await openProject(root);
    const loaded = await project.read("a");
    const execute = child.execFileSync;
    vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
      if (Array.isArray(args[1]) && args[1][0] === "stage")
        return execute(args[0], args[1], { ...args[2], input: "x".repeat(2 * 1024 * 1024 + 1) });
      return execute(...args);
    });
    await expect(project.save("a", "mine", loaded.version)).rejects.toThrow("2 MiB");
    expect(await project.read("a")).toEqual(loaded);
    expect(await project.files()).toEqual([{ path: "a", directory: false }]);
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});

test("saves preserve mode and extended attributes and refuse hard-linked files", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-metadata-"));
  try {
    execFileSync("git", ["init", root]);
    const path = join(root, "a");
    await writeFile(path, "loaded");
    fs.chmodSync(path, 0o751);
    execFileSync("/usr/bin/xattr", ["-w", "com.escode.test", "retained", path]);
    const project = await openProject(root);
    const loaded = await project.read("a");
    expect((await project.save("a", "mine", loaded.version)).kind).toBe("saved");
    expect(fs.statSync(path).mode & 0o777).toBe(0o751);
    expect(
      execFileSync("/usr/bin/xattr", ["-p", "com.escode.test", path], { encoding: "utf8" }).trim(),
    ).toBe("retained");
    fs.linkSync(path, join(root, "alias"));
    const current = await project.read("a");
    await expect(project.save("a", "break links", current.version)).rejects.toThrow("hard links");
    expect(await readFile(path, "utf8")).toBe("mine");
    expect(fs.statSync(path).ino).toBe(fs.statSync(join(root, "alias")).ino);
    expect((await project.files()).map((file) => file.path)).toEqual(["a", "alias"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads and browsing reject symlinks and special files and preserve literal names", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-read-scope-"));
  const outside = await mkdtemp(join(tmpdir(), "escode-read-outside-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(outside, "secret"), "outside");
    fs.symlinkSync(outside, join(root, "link"));
    execFileSync("/usr/bin/mkfifo", [join(root, "pipe")]);
    const name = "literal\n\tfile";
    await writeFile(join(root, name), "text");
    const project = await openProject(root);
    await expect(project.read("link/secret")).rejects.toThrow();
    await expect(project.files("link")).rejects.toThrow();
    await expect(project.read("pipe")).rejects.toThrow("not a regular file");
    await expect(project.read(".GIT/config")).rejects.toThrow("Invalid project path");
    expect(await project.files()).toEqual([{ path: name, directory: false }]);
    expect((await project.read(name)).text).toBe("text");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("a replaced checkout is unavailable for file and Git operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-root-"));
  const moved = root + "-moved";
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a"), "loaded");
    const project = await openProject(root);
    const loaded = await project.read("a");
    fs.renameSync(root, moved);
    fs.mkdirSync(root);
    await writeFile(join(root, "a"), "replacement checkout");
    for (const operation of [
      () => project.files(),
      () => project.read("a"),
      () => project.save("a", "mine", loaded.version),
      () => project.status(),
    ])
      await expect(operation()).rejects.toThrow("Checkout directory was replaced");
    expect(await readFile(join(root, "a"), "utf8")).toBe("replacement checkout");
    expect(await readFile(join(moved, "a"), "utf8")).toBe("loaded");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(moved, { recursive: true, force: true });
  }
});

test("losing Git leaves file editing available and status retry recovers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-git-loss-"));
  const root = join(dir, "repo"),
    bin = join(dir, "bin");
  fs.mkdirSync(bin);
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a"), "original");
  const executable = join(bin, "git");
  await writeFile(executable, '#!/bin/sh\nexec /usr/bin/git "$@"\n', { mode: 0o700 });
  vi.stubEnv("PATH", bin);
  try {
    let project = await openProject(root);
    const loaded = await project.read("a");
    const repository = project.repository();
    await rm(executable);
    expect((await project.status()).gitError).toMatch(/retry/i);
    project.close();
    await writeFile(executable, "#!/bin/sh\nexit 127\n", { mode: 0o700 });
    project = await Project.restore(project.root, repository);
    projects.push(project);
    const unavailable = await project.status();
    expect(unavailable).toMatchObject({
      branch: "Git unavailable",
      changes: [],
      gitError: expect.stringMatching(/retry/i),
    });
    expect(await project.files()).toEqual([{ path: "a", directory: false }]);
    expect((await project.save("a", "saved without Git", loaded.version)).kind).toBe("saved");
    await writeFile(executable, '#!/bin/sh\nexec /usr/bin/git "$@"\n', { mode: 0o700 });
    expect((await project.status()).changes).toEqual([{ path: "a", area: "untracked" }]);
    expect((await project.read("a")).text).toBe("saved without Git");
    expect(project.worktreeOptions().checkouts).toContain(project.root);
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Git stays in the opened checkout when external configuration changes its work tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-git-scope-"));
  const outside = await mkdtemp(join(tmpdir(), "escode-git-outside-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "inside"), "checkout");
    await writeFile(join(outside, "outside"), "other directory");
    fs.mkdirSync(join(root, "subdir"));
    await expect(Project.open(join(root, "subdir"))).rejects.toThrow("checkout root");
    const project = await openProject(root);
    execFileSync("git", ["-C", root, "config", "core.worktree", outside]);
    expect((await project.status()).changes).toEqual([{ path: "inside", area: "untracked" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("invalid binary editor content fails before modifying disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-invalid-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a"), "original");
    const project = await openProject(root);
    const loaded = await project.read("a");
    await expect(project.save("a", "contains\0nul", loaded.version)).rejects.toThrow("binary");
    expect(await project.read("a")).toEqual(loaded);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("save detects external changes, preserves disk, and requires the compared version for overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-"));
  try {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a.txt"), "one");
    const project = await openProject(root);
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
    const project = await openProject(root);
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
    const project = await openProject(root);
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
    const project = await openProject(root);
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

test("ignore filtering batches NUL-delimited real filenames and respects tracked entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-46-ignore-"));
  try {
    execFileSync("git", ["init", root]);
    const names = ["space name.log", "line\nbreak.log", "-dash.log", "tracked.log", "visible.txt"];
    for (const name of names) await writeFile(join(root, name), "disk");
    fs.mkdirSync(join(root, "ignored folder"));
    await writeFile(join(root, "ignored folder/child"), "ignored child");
    execFileSync("git", ["-C", root, "add", "tracked.log"]);
    await writeFile(join(root, ".gitignore"), "*.log\nignored folder/\n");
    const project = await openProject(root);
    const execute = child.execFileSync;
    const calls: string[][] = [];
    vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
      if (Array.isArray(args[1])) calls.push(args[1] as string[]);
      return execute(...args);
    });
    const result = await project.filteredFiles();
    expect(result.filterError).toBeUndefined();
    expect(result.ignored.sort()).toEqual(
      ["space name.log", "line\nbreak.log", "-dash.log", "ignored folder"].sort(),
    );
    expect(result.entries.some((e) => e.path === ".git")).toBe(false);
    expect(calls.filter((c) => c.includes("check-ignore"))).toHaveLength(1);
    expect(calls.filter((c) => c[0] === "list")).toEqual([["list", "."]]);
    vi.restoreAllMocks();
    await writeFile(join(root, ".gitignore"), "");
    expect((await project.filteredFiles()).ignored).toEqual([]);
    const spy = vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
      if (Array.isArray(args[1]) && args[1].includes("check-ignore"))
        throw Object.assign(Error("Git unavailable"), { status: 128 });
      return execute(...args);
    });
    const failed = await project.filteredFiles();
    expect(failed.entries).toEqual(result.entries);
    expect(failed.ignored).toEqual([]);
    expect(failed.filterError).toContain("All files are shown");
    spy.mockRestore();
    expect((await project.filteredFiles()).filterError).toBeUndefined();
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});

test("entry locations validate canonical paths, no-follow ancestry and checkout identity", async () => {
  const root = fs.realpathSync(await mkdtemp(join(tmpdir(), "escode-46-location-")));
  const outside = fs.realpathSync(await mkdtemp(join(tmpdir(), "escode-46-outside-")));
  try {
    execFileSync("git", ["init", root]);
    fs.mkdirSync(join(root, "folder"));
    await writeFile(join(root, "folder/a"), "disk");
    fs.symlinkSync(outside, join(root, "link"));
    const project = await openProject(root);
    expect(project.entryLocation("")).toBe(root);
    expect(project.entryLocation("folder/a")).toBe(join(root, "folder/a"));
    for (const path of [
      ".git",
      "../outside",
      "/tmp",
      "folder/../folder/a",
      "./folder/a",
      "folder/a\0",
      "link",
    ]) {
      expect(() => project.entryLocation(path)).toThrow();
    }
    fs.renameSync(root, root + "-old");
    fs.mkdirSync(root);
    expect(() => project.entryLocation("")).toThrow(/replaced/);
    expect(() => project.entryLocation("folder/a")).toThrow(/replaced/);
    fs.rmdirSync(root);
    fs.renameSync(root + "-old", root);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("large root ignore checks stay batched without listing collapsed descendants", async () => {
  const root = await mkdtemp(join(tmpdir(), "escode-46-large-"));
  try {
    execFileSync("git", ["init", root]);
    for (let i = 0; i < 2000; i++)
      fs.writeFileSync(join(root, `file-${i}.${i % 2 ? "txt" : "log"}`), "disk");
    fs.mkdirSync(join(root, "collapsed"));
    fs.writeFileSync(join(root, "collapsed/child"), "not listed");
    fs.writeFileSync(join(root, ".gitignore"), "*.log\n");
    const project = await openProject(root);
    const execute = child.execFileSync;
    const calls: string[][] = [];
    vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
      if (Array.isArray(args[1])) calls.push(args[1] as string[]);
      return execute(...args);
    });
    const start = performance.now();
    const result = await project.filteredFiles();
    console.log(
      `2002 root entries: batched listing/ignore check ${Math.round(performance.now() - start)} ms`,
    );
    expect(result.entries).toHaveLength(2002);
    expect(result.ignored).toHaveLength(1000);
    expect(result.filterError).toBeUndefined();
    expect(calls.filter((c) => c.includes("check-ignore"))).toHaveLength(1);
    expect(calls.filter((c) => c[0] === "list")).toEqual([["list", "."]]);
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});
