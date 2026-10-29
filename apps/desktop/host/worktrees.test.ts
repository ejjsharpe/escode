import { test, expect, vi } from "vite-plus/test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  realpathSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import * as child from "node:child_process";
import { build } from "esbuild";
import { promisify } from "node:util";
import { Project } from "./project";
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
}));
vi.mock("node:fs", async (original) => ({ ...(await original<typeof import("node:fs")>()) }));
const git = (root: string, ...args: string[]) =>
  child
    .execFileSync("git", ["-C", root, ...args])
    .toString()
    .trim();
async function fixture(run: (dir: string, root: string, p: Project) => Promise<void>) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "escode-worktrees-")));
  const root = join(dir, "repo");
  mkdirSync(root);
  git(root, "init", "-b", "main");
  writeFileSync(join(root, "tracked"), "committed");
  writeFileSync(join(root, ".gitignore"), "ignored\n");
  git(root, "add", ".");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial");
  const p = await Project.open(root);
  try {
    await run(dir, root, p);
  } finally {
    vi.restoreAllMocks();
    p.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
test("creation uses the displayed commit and preserves every category of local edits; reuse discovers real metadata", () =>
  fixture(async (dir, root, p) => {
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    writeFileSync(join(root, "tracked"), "staged");
    git(root, "add", "tracked");
    writeFileSync(join(root, "tracked"), "unstaged");
    writeFileSync(join(root, "untracked"), "untracked");
    writeFileSync(join(root, "ignored"), "ignored");
    const hookMarker = join(dir, "hook-ran");
    writeFileSync(join(root, ".git/hooks/post-checkout"), `#!/bin/sh\ntouch '${hookMarker}'\n`, {
      mode: 0o755,
    });
    const before = git(root, "status", "--porcelain", "--ignored");
    const options = p.worktreeOptions();
    expect(options.defaultRef).toBe("refs/heads/main");
    const base = options.bases.find((b) => b.ref === options.defaultRef)!;
    const result = p.createWorktree(join(dir, "managed"), base.ref, base.commit);
    expect(result.error).toBeNull();
    expect(existsSync(hookMarker)).toBe(false);
    expect(git(result.root, "rev-parse", "HEAD")).toBe(base.commit);
    expect(git(result.root, "branch", "--show-current")).toBe(result.branch);
    expect(readFileSync(join(result.root, "tracked"), "utf8")).toBe("committed");
    expect(existsSync(join(result.root, "untracked"))).toBe(false);
    expect(existsSync(join(result.root, "ignored"))).toBe(false);
    expect(git(root, "status", "--porcelain", "--ignored")).toBe(before);
    expect(git(root, "show", ":tracked")).toBe("staged");
    expect(readFileSync(join(root, "tracked"), "utf8")).toBe("unstaged");
    expect(readFileSync(join(root, "ignored"), "utf8")).toBe("ignored");
    expect(p.worktreeOptions().checkouts).toContain(result.root);
    const reopened = await Project.open(result.root);
    expect(reopened.repository()).toBe(p.repository());
    reopened.close();
  }));
test("same-name repositories and concurrent requests get separate paths and branches", () =>
  fixture(async (dir, root, p) => {
    const other = join(dir, "other/repo");
    mkdirSync(other, { recursive: true });
    git(other, "init");
    git(other, "fetch", root, "main");
    git(other, "checkout", "-b", "main", "FETCH_HEAD");
    const q = await Project.open(other);
    try {
      const base = p.worktreeOptions().bases[0];
      const bundle = join(dir, "project.cjs");
      await build({
        entryPoints: ["host/project.ts"],
        outfile: bundle,
        bundle: true,
        platform: "node",
        format: "cjs",
      });
      const execute = promisify(child.execFile);
      const worker = `const { Project } = require(process.argv[1]);
      Project.open(process.argv[2]).then(p => {
        const result = p.createWorktree(process.argv[3], process.argv[4], process.argv[5]);
        p.close(); console.log(JSON.stringify(result));
      }).catch(e => { console.error(e); process.exitCode = 1; });`;
      const results = await Promise.all(
        [root, root, other].map(async (source) => {
          const result = await execute(process.execPath, [
            "-e",
            worker,
            bundle,
            source,
            join(dir, "managed"),
            base.ref,
            base.commit,
          ]);
          return JSON.parse(result.stdout) as ReturnType<Project["createWorktree"]>;
        }),
      );
      expect(results.every((r) => !r.error)).toBe(true);
      expect(new Set(results.map((r) => r.root)).size).toBe(3);
      expect(new Set(results.map((r) => r.branch)).size).toBe(3);
      expect(results[0].root.split("/").at(-3)).not.toBe(results[2].root.split("/").at(-3));
    } finally {
      q.close();
    }
  }));
test("missing and moved bases require a new choice before allocating anything", () =>
  fixture(async (dir, root, p) => {
    const base = p.worktreeOptions().bases[0];
    git(
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "next",
    );
    expect(() => p.createWorktree(join(dir, "managed"), base.ref, base.commit)).toThrow(
      "Refresh bases",
    );
    expect(() =>
      p.createWorktree(join(dir, "managed"), "refs/heads/missing", base.commit),
    ).toThrow();
    expect(existsSync(join(dir, "managed"))).toBe(false);
    const empty = join(dir, "empty");
    mkdirSync(empty);
    git(empty, "init");
    const q = await Project.open(empty);
    try {
      expect(q.worktreeOptions().bases).toEqual([]);
    } finally {
      q.close();
    }
  }));
test.each([false, true])(
  "occupied destinations (with files: %s) are preserved and retry reserves a fresh path",
  (nonempty) =>
    fixture(async (dir, _root, p) => {
      const base = p.worktreeOptions().bases[0];
      const allocate = fs.mkdtempSync;
      vi.spyOn(fs, "mkdtempSync").mockImplementation((...args) => {
        const container = allocate(...args);
        const destination = join(String(container), "checkout");
        mkdirSync(destination);
        if (nonempty) writeFileSync(join(destination, "precious"), "keep me");
        return container;
      });
      const failed = p.createWorktree(join(dir, "managed"), base.ref, base.commit);
      expect(failed.error).toContain("residual branch");
      expect(existsSync(failed.root)).toBe(true);
      if (nonempty) expect(readFileSync(join(failed.root, "precious"), "utf8")).toBe("keep me");
      else expect(readdirSync(failed.root)).toEqual([]);
      vi.restoreAllMocks();
      const retry = p.createWorktree(join(dir, "managed"), base.ref, base.commit);
      expect(retry.error).toBeNull();
      expect(retry.root).not.toBe(failed.root);
    }),
);
test("failure after Git creates the worktree retains branch, files and registration", () =>
  fixture(async (dir, root, p) => {
    const base = p.worktreeOptions().bases[0];
    const execute = child.execFileSync;
    vi.spyOn(child, "execFileSync").mockImplementation((...args) => {
      const result = execute(...args);
      if (Array.isArray(args[1]) && args[1].includes("-b") && args[1].includes("worktree"))
        throw Error("lost result");
      return result;
    });
    const failed = p.createWorktree(join(dir, "managed"), base.ref, base.commit);
    expect(failed.error).toContain("lost result");
    expect(readFileSync(join(failed.root, "tracked"), "utf8")).toBe("committed");
    expect(git(root, "show-ref", "--verify", "refs/heads/" + failed.branch)).toContain(base.commit);
    expect(p.checkouts()).toContain(failed.root);
    expect(readdirSync(join(dir, "managed"))).toHaveLength(1);
  }));

test("changed Git metadata cannot redirect creation into another repository", () =>
  fixture(async (dir, root, p) => {
    const base = p.worktreeOptions().bases[0];
    const other = join(dir, "other");
    child.execFileSync("git", ["clone", root, other]);
    const before = git(other, "for-each-ref");
    fs.renameSync(join(root, ".git"), join(root, ".git-original"));
    writeFileSync(join(root, ".git"), `gitdir: ${join(other, ".git")}\n`);
    expect(() => p.createWorktree(join(dir, "managed"), base.ref, base.commit)).toThrow(
      "Repository metadata changed",
    );
    expect(existsSync(join(dir, "managed"))).toBe(false);
    expect(git(other, "for-each-ref")).toBe(before);
    expect(git(other, "worktree", "list", "--porcelain")).not.toContain("managed");
  }));
test("managed paths inside a project checkout, including symlink aliases, are rejected", () =>
  fixture(async (dir, root, p) => {
    const base = p.worktreeOptions().bases[0];
    const managed = join(root, "nested/worktrees");
    expect(() => p.createWorktree(managed, base.ref, base.commit)).toThrow(
      "outside project checkouts",
    );
    expect(existsSync(join(root, "nested"))).toBe(false);
    fs.symlinkSync(root, join(dir, "alias"));
    expect(() => p.createWorktree(join(dir, "alias/managed"), base.ref, base.commit)).toThrow(
      "outside project checkouts",
    );
    expect(existsSync(join(root, "managed"))).toBe(false);
  }));

test("a missing registered sibling does not block creation from a healthy checkout", () =>
  fixture(async (dir, root, p) => {
    const sibling = join(dir, "sibling");
    git(root, "worktree", "add", "-b", "sibling", sibling);
    rmSync(sibling, { recursive: true });
    const options = p.worktreeOptions();
    expect(options.checkouts).toContain(sibling);
    const base = options.bases[0];
    const result = p.createWorktree(join(dir, "managed"), base.ref, base.commit);
    expect(result.error).toBeNull();
    expect(readFileSync(join(result.root, "tracked"), "utf8")).toBe("committed");
    expect(p.checkouts()).toContain(sibling);
  }));

test("confirmed removal retains branch and commits and external worktrees are ineligible", () =>
  fixture(async (dir, root, p) => {
    const managed = join(dir, "managed");
    const base = p.worktreeOptions().bases[0];
    const created = p.createWorktree(managed, base.ref, base.commit);
    expect(p.managedWorktrees(managed).map((r) => r.root)).toContain(created.root);
    expect(() => p.removeWorktree(managed, root, base.commit)).toThrow("Only app-created");
    p.removeWorktree(managed, created.root, base.commit);
    expect(existsSync(created.root)).toBe(false);
    expect(git(root, "rev-parse", "refs/heads/" + created.branch)).toBe(base.commit);
    p.removeWorktree(managed, created.root, base.commit);
  }));
test.each(["tracked", "untracked", "ignored"])(
  "removal blocks %s edits, including changes after inspection, and retries revalidate",
  (file) =>
    fixture(async (dir, _root, p) => {
      const managed = join(dir, "managed");
      const base = p.worktreeOptions().bases[0];
      const created = p.createWorktree(managed, base.ref, base.commit);
      p.removalCheck(managed, created.root);
      writeFileSync(join(created.root, file), "preserve");
      expect(() => p.removeWorktree(managed, created.root, base.commit)).toThrow("need preserving");
      expect(readFileSync(join(created.root, file), "utf8")).toBe("preserve");
      expect(() => p.removeWorktree(managed, created.root, base.commit)).toThrow();
    }),
);
test("changed branch, hidden index entries and failed checks block removal", () =>
  fixture(async (dir, _root, p) => {
    const managed = join(dir, "managed");
    const base = p.worktreeOptions().bases[0];
    const created = p.createWorktree(managed, base.ref, base.commit);
    git(created.root, "update-index", "--assume-unchanged", "tracked");
    expect(() => p.removeWorktree(managed, created.root, base.commit)).toThrow("Uncertain");
    git(created.root, "update-index", "--no-assume-unchanged", "tracked");
    git(created.root, "checkout", "-b", "different");
    expect(() => p.removeWorktree(managed, created.root, base.commit)).toThrow("branch changed");
    expect(existsSync(created.root)).toBe(true);
  }));
test("a failed removal is visible and retryable without forcing or deleting branches", () =>
  fixture(async (dir, root, p) => {
    const managed = join(dir, "managed");
    const base = p.worktreeOptions().bases[0];
    const created = p.createWorktree(managed, base.ref, base.commit);
    git(root, "worktree", "lock", created.root);
    expect(() => p.removeWorktree(managed, created.root, base.commit)).toThrow();
    expect(existsSync(created.root)).toBe(true);
    git(root, "worktree", "unlock", created.root);
    p.removeWorktree(managed, created.root, base.commit);
    expect(git(root, "rev-parse", created.branch)).toBe(base.commit);
  }));

test("retry completes missing-but-registered deletion and retains the branch", () =>
  fixture(async (dir, root, p) => {
    const managed = join(dir, "managed");
    const base = p.worktreeOptions().bases[0];
    const created = p.createWorktree(managed, base.ref, base.commit);
    rmSync(created.root, { recursive: true });
    expect(p.checkouts()).toContain(created.root);
    p.removeWorktree(managed, created.root, base.commit);
    expect(p.checkouts()).not.toContain(created.root);
    expect(git(root, "rev-parse", created.branch)).toBe(base.commit);
  }));


test("VS Code policy: Git can remove an ignored file arriving after the final preservation check", () => fixture(async (dir, _root, p) => {
  const managed = join(dir, "managed");
  const base = p.worktreeOptions().bases[0];
  const created = p.createWorktree(managed, base.ref, base.commit);
  const check = p.removalCheck.bind(p);
  vi.spyOn(p, "removalCheck").mockImplementation((...args) => {
    const result = check(...args);
    writeFileSync(join(created.root, "ignored"), "arrived after final check");
    return result;
  });
  p.removeWorktree(managed, created.root, base.commit);
  expect(existsSync(join(created.root, "ignored"))).toBe(false);
  expect(p.checkouts()).not.toContain(created.root);
}));
