import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

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
