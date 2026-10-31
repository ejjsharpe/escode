import { execFileSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdirSync } from "node:fs";

mkdirSync("dist/host", { recursive: true });
execFileSync(
  "clang",
  [
    "-std=c11",
    "-framework",
    "CoreServices",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-O2",
    "host/filesystem.c",
    "-o",
    "dist/host/filesystem",
  ],
  { stdio: "inherit" },
);

// Ship the installed native enumerator; runtime never depends on PATH or user rg config.
const rg = process.env.ESCODE_RIPGREP || execFileSync("which", ["rg"], { encoding: "utf8" }).trim();
copyFileSync(rg, "dist/host/ripgrep");
chmodSync("dist/host/ripgrep", 0o755);
