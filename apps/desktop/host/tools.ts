import { fromReadable } from "@effect/platform-node/NodeStream";
import { fromWritable } from "@effect/platform-node/NodeSink";
import { systemError } from "effect/PlatformError";
import { Effect, Exit, Scope, Sink, Stdio, Deferred } from "effect";
import { makeCodexAppServerPatchedProtocol } from "./vendor/codex/src/protocol";
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
  const scope = Scope.makeUnsafe();
  let closed = false;
  const replies = new Map<string | number, Deferred.Deferred<unknown>>();
  const fail = (error: Error) => {
    if (closed) return;
    closed = true;
    error = Error(codexDiagnostic(path, version, error.message));
    void Effect.runPromise(Scope.close(scope, Exit.void));
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
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("exit", () => fail(Error("Codex disconnected. Retry connection; work was not resent.")));
  const stdio = Stdio.make({
    args: Effect.succeed([]),
    stdin: fromReadable({ evaluate: () => child.stdout, onError: cause => systemError({ module: "Stdio", method: "stdin", _tag: "Unknown", cause }) }),
    stdout: () => fromWritable({ evaluate: () => child.stdin, endOnDone: false,
      onError: cause => systemError({ module: "Stdio", method: "stdout", _tag: "Unknown", cause }) }),
    stderr: () => Sink.drain,
  });
  const protocol = await Effect.runPromise(makeCodexAppServerPatchedProtocol({
    stdio, maxIncomingMessageBytes: 1024 * 1024,
    onNotification: event => Effect.sync(() => receive(event)),
    onRequest: event => Effect.gen(function* () {
      const reply = yield* Deferred.make<unknown>();
      replies.set(event.id, reply);
      receive(event);
      return yield* Deferred.await(reply).pipe(Effect.ensuring(Effect.sync(() => { replies.delete(event.id); })));
    }),
    onTermination: error => Effect.sync(() => fail(Error(String(error)))),
  }).pipe(Effect.provideService(Scope.Scope, scope)));
  const rpc: CodexConnection = {
    finished,
    installation: { path, version },
    async request(method, params) {
      if (closed) throw Error("Codex disconnected. Retry connection; work was not resent.");
      try {
        return await Effect.runPromise(protocol.request(method, params).pipe(Effect.timeout("30 seconds")));
      } catch (error) {
        const problem = error as { _tag?: string; operation?: string; cause?: unknown };
        const detail = problem.operation === "decode-wire-message" ? "Incompatible Codex protocol" :
          String(problem.cause).includes("exceeded 1048576") ? "Provider frame exceeds 1 MiB" : String(error);
        const failure = Object.assign(Error(codexDiagnostic(path, version, detail)), { rejected: problem._tag === "CodexAppServerRequestError" });
        fail(failure);
        throw failure;
      }
    },
    respond(id, result) {
      const reply = replies.get(id);
      if (!reply || closed) throw Error("Expired provider request");
      Effect.runSync(Deferred.succeed(reply, result));
    },
    close() { fail(Error("Connection closed. Reopen to load saved history.")); },
  };
  try {
    const initialized = await rpc.request("initialize", {
      clientInfo: { name: "escode", version: "0.1.0" },
      capabilities: {},
    });
    if (typeof initialized?.userAgent !== "string")
      throw Error("Incompatible Codex initialize response. Update Codex or escode and retry.");
    await Effect.runPromise(protocol.notify("initialized"));
    return rpc;
  } catch (error) {
    rpc.close();
    await rpc.finished;
    throw Error(
      codexDiagnostic(path, version, error instanceof Error ? error.message : String(error)),
    );
  }
}

export async function draftSettings(cwd: string) {
  const rpc = await connectCodex(cwd, () => {}, () => {});
  try {
    const { config } = await rpc.request("config/read", { cwd, includeLayers: false });
    return { model: config.model ?? null, reasoning: config.model_reasoning_effort ?? null,
      approval: config.approval_policy ?? null, sandbox: config.sandbox_mode ?? null };
  } finally { rpc.close(); }
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
