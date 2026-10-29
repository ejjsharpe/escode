import { access, open } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
const execute = promisify(execFile);
export const supportedCodexVersion = "0.165.0";
export async function findExecutable(
  name: "git" | "codex",
  paths = (process.env.PATH ?? "").split(":"),
  fallback = [
    join(homedir(), ".bun/bin"),
    join(homedir(), ".cargo/bin"),
    join(homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ],
) {
  for (const dir of [...paths, ...fallback].filter(Boolean)) {
    const candidate = join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Try the next conventional install location. */
    }
  }
  throw new Error(
    name === "git"
      ? "Install Git with xcode-select --install, then retry."
      : `Install Codex externally, run codex login, then retry. Supported build: ${supportedCodexVersion}.`,
  );
}
export async function codexCommand(path: string, args: string[]) {
  const file = await open(path, "r");
  const header = Buffer.alloc(64);
  try {
    await file.read(header, 0, 64, 0);
  } finally {
    await file.close();
  }
  // npm/Bun's Codex launcher requires Node; Electron supplies it outside shell PATH.
  return header.toString().startsWith("#!/usr/bin/env node")
    ? {
        executable: process.execPath,
        args: [path, ...args],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      }
    : { executable: path, args, env: process.env };
}
export async function probeCodex(path: string) {
  const command = await codexCommand(path, ["app-server", "--listen", "stdio://"]);
  const child = spawn(command.executable, command.args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: homedir(),
    env: command.env,
  });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  const fail = (error: Error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", () =>
    fail(new Error("Codex disconnected. Retry after checking the installed CLI.")),
  );
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        if (message.error)
          request.reject(
            new Error("Codex rejected compatibility request. Check configuration and retry."),
          );
        else request.resolve(message.result);
      }
    } catch {
      fail(new Error("Invalid Codex protocol response."));
    }
  });
  const timer = setTimeout(() => {
    fail(new Error("Codex compatibility check timed out. Check configuration and retry."));
    child.kill();
  }, 15000);
  const request = (method: string, params: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  try {
    await request("initialize", {
      clientInfo: { name: "escode", version: "0.1.0" },
      capabilities: {},
    });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const account = await request("account/read", { refreshToken: false });
    const result = await request("config/read", { includeLayers: false });
    const config = result.config;
    return {
      authenticated: Boolean(account.account),
      settings: {
        model: config.model ?? null,
        effort: config.model_reasoning_effort ?? null,
        approval: config.approval_policy ?? null,
        sandbox: config.sandbox_mode ?? null,
      },
      guidance: account.account ? null : "Run codex login externally, then retry.",
    };
  } finally {
    clearTimeout(timer);
    lines.close();
    child.kill();
  }
}
export async function toolStatus() {
  const git = await (async () => {
    try {
      const path = await findExecutable("git");
      return {
        path,
        version: (await execute(path, ["--version"], { timeout: 5000 })).stdout.trim(),
      };
    } catch {
      return { guidance: "Install Git with xcode-select --install, then retry." };
    }
  })();
  const codex = await (async () => {
    try {
      const path = await findExecutable("codex");
      const command = await codexCommand(path, ["--version"]);
      const version = (
        await execute(command.executable, command.args, { timeout: 5000, env: command.env })
      ).stdout.trim();
      if (version !== `codex-cli ${supportedCodexVersion}`)
        return {
          path,
          version,
          guidance: `Unsupported Codex build. Install tested version ${supportedCodexVersion} externally, then retry.`,
        };
      return { path, version, ...(await probeCodex(path)) };
    } catch {
      return {
        guidance: `Codex unavailable. Install version ${supportedCodexVersion}, run codex login and check configuration externally, then retry.`,
      };
    }
  })();
  return { git, codex };
}
