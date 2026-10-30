import { access, open } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const minimumCodexVersion = "0.163.0";
export const testedCodexVersion = "0.165.0";
export function codexVersionProblem(output: string): string | null {
  const match = /^codex-cli (\d+)\.(\d+)\.(\d+)$/.exec(output);
  if (!match)
    return "Unrecognized or prerelease Codex version. Install a stable release and retry.";
  const actual = match.slice(1).map(Number);
  if (!actual.every(Number.isSafeInteger))
    return "Invalid Codex version. Install a stable release and retry.";
  const minimum = minimumCodexVersion.split(".").map(Number);
  for (let i = 0; i < minimum.length; i++) {
    if (actual[i] > minimum[i]) return null;
    if (actual[i] < minimum[i])
      return `Codex is too old. Install ${minimumCodexVersion} or newer and retry.`;
  }
  return null;
}
async function inspectCodex(path: string) {
  const command = await codexCommand(path, ["--version"]);
  const version = (
    await execute(command.executable, command.args, { env: command.env, timeout: 5000 })
  ).stdout.trim();
  return { path, version, problem: codexVersionProblem(version) };
}
export function codexDiagnostic(path: string, version: string | undefined, message: string) {
  if (message.startsWith(`Codex at ${path} (`)) return message;
  return `Codex at ${path} (${version ? version.slice(0, 160) : "version unavailable"}): ${message}`;
}
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
      : `Install Codex externally, run codex login, then retry. Requires ${minimumCodexVersion} or newer; tested baseline ${testedCodexVersion}.`,
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
  installation?: { path: string; version: string };
  request(method: string, params: unknown): Promise<any>;
  respond(id: number | string, result: unknown): void;
  close(): void;
  finished?: Promise<void>;
}
export async function connectCodex(
  cwd: string,
  receive: (event: WireMessage) => void,
  disconnected: (error: Error) => void,
  providedPath?: string,
): Promise<CodexConnection> {
  const path = providedPath ?? (await findExecutable("codex"));
  let version = "";
  try {
    const inspected = await inspectCodex(path);
    version = inspected.version;
    if (inspected.problem) throw Error(inspected.problem);
  } catch (error) {
    throw Error(
      codexDiagnostic(path, version, error instanceof Error ? error.message : String(error)),
    );
  }
  const command = await codexCommand(path, ["app-server", "--listen", "stdio://"]);
  const child = spawn(command.executable, command.args, {
    cwd,
    detached: true,
    env: command.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  // A private process group includes ordinary tool descendants, even after the server exits.
  const killGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // macOS may report EPERM for a group whose final process has just exited.
      if (code === "ESRCH") return;
      if (
        code === "EPERM" &&
        !execFileSync("/bin/ps", ["-axo", "pgid=,stat="], { encoding: "utf8" })
          .split("\n")
          .some((line) => {
            const [group, state] = line.trim().split(/\s+/);
            return Number(group) === child.pid && !state?.startsWith("Z");
          })
      )
        return;
      throw error;
    }
  };
  let finish: () => void;
  let terminationFailed: (error: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    finish = resolve;
    terminationFailed = reject;
  });
  void finished.catch(() => {});
  let input = Buffer.alloc(0);
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
    error = Error(codexDiagnostic(path, version, error.message));
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
    input = Buffer.alloc(0);
    try {
      killGroup("SIGTERM");
    } catch {
      /* Retry with escalation below. */
    }
    setTimeout(() => {
      try {
        killGroup("SIGKILL");
        finish();
      } catch (error) {
        terminationFailed(error);
      }
    }, 300);
    disconnected(error);
  };
  const write = (value: unknown) => {
    if (closed) throw Error("Codex disconnected. Retry connection; send work explicitly.");
    child.stdin.write(JSON.stringify(value) + "\n");
  };
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.stdout.on("error", fail);
  child.stdout.on("end", () => fail(Error("Codex protocol connection closed. Retry connection; work was not resent.")));
  child.on("exit", () =>
    fail(
      Error(
        "Codex disconnected. Check installation/authentication, then Retry connection. Work was not resent.",
      ),
    ),
  );
  const line = (line: string) => {
    try {
      const message: WireMessage = JSON.parse(line);
      if (message.method) receive(message);
      else if (typeof message.id === "number") {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error)
          entry.reject(
            Object.assign(Error(codexDiagnostic(path, version, message.error.message)), {
              rejected: true,
            }),
          );
        else entry.resolve(message.result);
      }
    } catch {
      fail(Error("Incompatible Codex protocol. Check supported CLI and Retry connection."));
    }
  };
  // Reject before concatenation/JSON decoding, including unknown provider payloads.
  child.stdout.on("data", (chunk: Buffer) => {
    if (closed) return;
    let start = 0;
    while (start < chunk.length && !closed) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      if (input.length + end - start > 1024 * 1024) {
        fail(Error("Provider frame exceeds 1 MiB. History unavailable; identity retained. Retry explicitly."));
        return;
      }
      input = Buffer.concat([input, chunk.subarray(start, end)]);
      if (newline < 0) return;
      const frame = input.toString("utf8");
      input = Buffer.alloc(0);
      line(frame);
      start = newline + 1;
    }
  });
  const rpc: CodexConnection = {
    finished,
    installation: { path, version },
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
    const initialized = await rpc.request("initialize", {
      clientInfo: { name: "escode", version: "0.1.0" },
      capabilities: {},
    });
    if (typeof initialized?.userAgent !== "string")
      throw Error("Incompatible Codex initialize response. Update Codex or escode and retry.");
    write({ method: "initialized" });
    return rpc;
  } catch (error) {
    rpc.close();
    await rpc.finished;
    throw Error(
      codexDiagnostic(path, version, error instanceof Error ? error.message : String(error)),
    );
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
    let path: string | undefined;
    let version: string | undefined;
    try {
      path = await findExecutable("codex");
      const inspected = await inspectCodex(path);
      version = inspected.version;
      if (inspected.problem)
        return { path, version, guidance: codexDiagnostic(path, version, inspected.problem) };
      return { path, version, ...(await probeCodex(path)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        path,
        version,
        guidance: path ? codexDiagnostic(path, version, message) : message,
      };
    }
  })();
  return { git, codex };
}
