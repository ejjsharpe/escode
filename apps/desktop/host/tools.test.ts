import { expect, test } from "vite-plus/test";
import { findExecutable } from "./tools";
test("missing tools give actionable guidance rather than invoking a shell", async () => {
  await expect(findExecutable("codex", [], [])).rejects.toThrow("Install Codex");
});

import { vi } from "vite-plus/test";
import { mkdtemp, writeFile, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
import { codexVersionProblem, connectCodex, toolStatus } from "./tools";

test.each(["0.163.0", "0.165.0", "0.166.0", "0.200.0", "1.0.0"])(
  "stable Codex %s meets the minimum version",
  (version) => {
    expect(codexVersionProblem("codex-cli " + version)).toBeNull();
  },
);
test.each(["0.162.9", "0.99.0", "0.9.999"])("Codex %s is too old", (version) => {
  expect(codexVersionProblem("codex-cli " + version)).toContain("too old");
});
test.each([
  "codex-cli 0.166.0-alpha",
  "0.165.0",
  "codex-cli unknown",
  "codex-cli 999999999999999999999.0.0",
])("unknown versions are not silently admitted: %s", (output) => {
  expect(codexVersionProblem(output)).not.toBeNull();
});
async function fixture(
  version: string,
  validInitialize: boolean,
  run: (path: string, marker: string) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "escode-codex-version-"));
  const path = join(dir, "codex"),
    marker = join(dir, "started");
  await writeFile(
    path,
    `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
if(process.argv.includes('--version')) {console.log(${JSON.stringify("codex-cli " + version)}); process.exit(0);}
writeFileSync(${JSON.stringify(marker)}, 'started');
createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line); if(!m.id) return;
 let result={};
 if(m.method==='initialize') result=${JSON.stringify(validInitialize ? { userAgent: "codex/" + version } : {})};
 if(m.method==='account/read') result={account:{type:'chatgpt'}};
 if(m.method==='config/read') result={config:{model:'fixture'}};
 process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
});
`,
    { mode: 0o700 },
  );
  try {
    await run(path, marker);
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
}
test("newer stable versions still have to pass protocol initialization", () =>
  fixture("0.200.0", false, async (path, marker) => {
    await expect(
      connectCodex(
        tmpdir(),
        () => {},
        () => {},
        path,
      ),
    ).rejects.toThrow("Incompatible Codex initialize response");
    await access(marker);
  }));
test("old versions report the executable and detected version before starting app-server", () =>
  fixture("0.162.0", true, async (path, marker) => {
    const error = await connectCodex(
      tmpdir(),
      () => {},
      () => {},
      path,
    ).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(path);
    expect(String(error)).toContain("codex-cli 0.162.0");
    await expect(access(marker)).rejects.toThrow();
  }));
test.each(["0.163.0", "0.200.0"])(
  "tool status probes compatible %s and retains diagnostics on failure",
  (version) =>
    fixture(version, true, async (path) => {
      vi.stubEnv("PATH", join(path, ".."));
      const result = await toolStatus();
      expect(result.codex.path).toBe(path);
      expect(result.codex.version).toBe("codex-cli " + version);
      expect(result.codex.guidance).toBeNull();
    }),
);
test("tool status preserves path and version when the protocol probe fails", () =>
  fixture("0.200.0", false, async (path) => {
    vi.stubEnv("PATH", join(path, ".."));
    const result = await toolStatus();
    expect(result.codex.path).toBe(path);
    expect(result.codex.version).toBe("codex-cli 0.200.0");
    expect(result.codex.guidance).toContain("Incompatible Codex initialize response");
  }));

test("malformed thread setup retains the executable/version in the error and chat snapshot", () =>
  fixture("0.200.0", true, async (path) => {
    const root = join(path, "..");
    const service = new ChatService(new Chats(join(root, "chats.json")), (cwd, receive, drop) =>
      connectCodex(cwd, receive, drop, path),
    );
    try {
      const chat = await service.create(root);
      const failure = await service.open(root, chat.id).catch((e: Error) => e);
      expect(String(failure)).toContain("Incompatible Codex thread response");
      expect(String(failure)).toContain(path);
      expect(String(failure)).toContain("codex-cli 0.200.0");
      const error = service.snapshot(root, chat.id).error;
      expect(error).toContain(path);
      expect(error).toContain("codex-cli 0.200.0");
    } finally {
      service.close();
    }
  }));
test("RPC error replies identify the executable and version", () =>
  fixture("0.200.0", true, async (path) => {
    let source = await readFile(path, "utf8");
    source = source.replace(
      "let result={};",
      "if(m.method==='fixture/error') {process.stdout.write(JSON.stringify({id:m.id,error:{code:-32601,message:'Unknown method'}})+'\\n');return;} let result={};",
    );
    await writeFile(path, source);
    const rpc = await connectCodex(
      tmpdir(),
      () => {},
      () => {},
      path,
    );
    try {
      const error = await rpc.request("fixture/error", {}).catch((e: Error) => e);
      expect(String(error)).toContain(path);
      expect(String(error)).toContain("codex-cli 0.200.0");
      expect(String(error)).toContain("Unknown method");
    } finally {
      rpc.close();
    }
  }));

test.each(["oversize", "malformed", "split"])("bounded provider frame decoding: %s", kind =>
  fixture("0.200.0", true, async path => {
    let source = await readFile(path, "utf8");
    const output = kind === "oversize" ? "process.stdout.write('x'.repeat(1048577));"
      : kind === "malformed" ? "process.stdout.write('{bad json}\\n');"
      : "const b=Buffer.from(JSON.stringify({id:m.id,result:{text:'£ saved'}})+'\\n'); const i=b.indexOf(194); process.stdout.write(b.subarray(0,i+1)); setTimeout(()=>process.stdout.write(b.subarray(i+1)),5);";
    source = source.replace("let result={};", `if(m.method==='fixture/frame'){${output}return;} let result={};`);
    await writeFile(path, source);
    const rpc = await connectCodex(tmpdir(), () => {}, () => {}, path);
    try {
      if (kind === "split") expect(await rpc.request("fixture/frame", {})).toEqual({ text: "£ saved" });
      else await expect(rpc.request("fixture/frame", {})).rejects.toThrow(kind === "oversize" ? "exceeds 1 MiB" : "Incompatible Codex protocol");
    } finally { rpc.close(); await rpc.finished; }
  }));
