import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { codexCommand, findExecutable, supportedCodexVersion } from "./tools";
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
): Promise<CodexConnection> {
  const path = await findExecutable("codex");
  const version = await codexCommand(path, ["--version"]);
  const output = await promisify(execFile)(version.executable, version.args, {
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
