import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const base = realpathSync(mkdtempSync(join(tmpdir(), "escode-native-races-")));
const helper = join(base, "filesystem");
beforeAll(() => {
  // The shipped helper is compiled without this define and has no pause protocol.
  execFileSync("clang", [
    "-std=c11",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-O2",
    "-DESCODE_TEST_PREFLIGHT",
    "host/filesystem.c",
    "-framework",
    "CoreServices",
    "-o",
    helper,
  ]);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
for (const [kind, replacement] of [
  ["move", true],
  ["trash", false],
  ["trash", true],
] as const) {
  test(`${kind} rejects a source ${replacement ? "replaced with protected contents" : "relocated outside the checkout"} during recursive preflight`, async () => {
    const fixture = mkdtempSync(join(base, "fixture-")),
      root = join(fixture, "repo");
    execFileSync("git", ["init", root]);
    const source = join(root, "source"),
      outside = join(fixture, "outside");
    mkdirSync(source);
    writeFileSync(join(source, "edits.txt"), "original disk bytes");
    const original = statSync(source);
    const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | 0x20000000);
    const child = spawn(
      helper,
      [kind, "source", kind === "move" ? "destination" : "-", `${original.dev}:${original.ino}`],
      { stdio: ["ignore", "pipe", "pipe", rootFd, "pipe", "pipe"] },
    );
    closeSync(rootFd);
    const closed = once(child, "close");
    let stdout = "",
      stderr = "";
    child.stdout!.on("data", (bytes) => {
      stdout += bytes;
    });
    child.stderr!.on("data", (bytes) => {
      stderr += bytes;
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await Promise.race([
        once(child.stdio[4]!, "data"),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(Error("Native helper did not reach preflight")), 3000);
        }),
      ]);
      expect(String(ready[0])).toBe("ready");
      // The original source is already open; preflight will continue through that fd.
      renameSync(source, outside);
      if (replacement) {
        mkdirSync(source);
        mkdirSync(join(source, ".git"));
        writeFileSync(join(source, ".git/protected"), "replacement metadata");
      }
      (child.stdio.at(5) as import("node:stream").Writable).end("continue");
      const [code] = await closed;
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/Source changed after preflight|Open checkout path/);
      expect(stdout).toBe("");
      expect(existsSync(join(root, "destination"))).toBe(false);
      expect(statSync(outside).ino).toBe(original.ino);
      expect(readFileSync(join(outside, "edits.txt"), "utf8")).toBe("original disk bytes");
      if (replacement)
        expect(readFileSync(join(source, ".git/protected"), "utf8")).toBe("replacement metadata");
      else expect(existsSync(source)).toBe(false);
    } finally {
      clearTimeout(timeout);
      child.kill("SIGKILL");
      await closed;
      // A failing pre-fix run may actually Trash this test-owned object.
      if (stdout.includes("/.Trash/")) rmSync(stdout, { recursive: true, force: true });
    }
  });
}
