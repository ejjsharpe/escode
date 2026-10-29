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
export type WireMessage = {
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string };
};
export interface CodexConnection {
  request(method: string, params: unknown): Promise<any>;
  respond(id: number | string, result: unknown): void;
  close(): void;
}
export async function connectCodex(
  cwd: string,
  receive: (event: WireMessage) => void,
  disconnected: (error: Error) => void,
  providedPath?: string,
): Promise<CodexConnection> {
  const path = providedPath ?? (await findExecutable("codex"));
  const version = await codexCommand(path, ["--version"]);
  const output = await execute(version.executable, version.args, {
    env: version.env,
    timeout: 5000,
  });
  if (output.stdout.trim() !== `codex-cli ${supportedCodexVersion}`)
    throw Error(
      `Install supported Codex ${supportedCodexVersion} externally, then Retry connection.`,
    );
  const command = await codexCommand(path, ["app-server", "--listen", "stdio://"]);
  const child = spawn(command.executable, command.args, {
    cwd,
    env: command.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  let sequence = 0,
    closed = false;
  const pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const fail = (error: Error) => {
    if (closed) return;
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
    lines.close();
    child.kill();
    disconnected(error);
  };
  const write = (value: unknown) => {
    if (closed) throw Error("Codex disconnected. Retry connection; send work explicitly.");
    child.stdin.write(JSON.stringify(value) + "\n");
  };
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.stdout.on("error", fail);
  lines.on("close", () =>
    fail(Error("Codex protocol connection closed. Retry connection; work was not resent.")),
  );
  child.on("exit", () =>
    fail(
      Error(
        "Codex disconnected. Check installation/authentication, then Retry connection. Work was not resent.",
      ),
    ),
  );
  lines.on("line", (line) => {
    try {
      const message: WireMessage = JSON.parse(line);
      if (message.method) receive(message);
      else if (typeof message.id === "number") {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(Error(message.error.message));
        else entry.resolve(message.result);
      }
    } catch {
      fail(Error("Incompatible Codex protocol. Check supported CLI and Retry connection."));
    }
  });
  const rpc: CodexConnection = {
    request(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(
          () => fail(Error("Codex request timed out. Retry connection; work was not resent.")),
          30000,
        );
        pending.set(id, { resolve, reject, timer });
        try {
          write({ id, method, params });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },
    respond(id, result) {
      write({ id, result });
    },
    close() {
      fail(Error("Connection closed. Reopen to load saved history."));
    },
  };
  try {
    await rpc.request("initialize", {
      clientInfo: { name: "escode", version: "0.1.0" },
      capabilities: {},
    });
    write({ method: "initialized" });
    return rpc;
  } catch (error) {
    rpc.close();
    throw error;
  }
}

export async function probeCodex(path: string) {
  const rpc = await connectCodex(
    homedir(),
    () => {},
    () => {},
    path,
  );
  try {
    const account = await rpc.request("account/read", { refreshToken: false });
    const result = await rpc.request("config/read", { includeLayers: false });
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
    rpc.close();
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
