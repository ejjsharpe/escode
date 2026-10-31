import { checkpointLoad } from "./checkpoint-load";
import { DatabaseSync } from "node:sqlite";
import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop, readChats } from "./desktop";

for (const phase of ["baseline", "followup", "worker-loss", "worker-loss-superseded"]) test(`emergency Stop visibly discloses uncertainty in the packaged app (${phase})`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-history-ui-"));
  const user = join(dir, "user"), tools = join(dir, "tools");
  await mkdir(user); await mkdir(tools);
  await writeFile(join(tools, "codex"), `#!/usr/bin/env node
const {createInterface}=require('node:readline');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0);}
const timer=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(join(dir, "supersede"))})){clearInterval(timer);process.stdout.write(JSON.stringify({method:'turn/started',params:{threadId:'saved-provider',turn:{id:'newer'}}})+'\\n');require('node:fs').writeFileSync(${JSON.stringify(join(dir, "superseded"))},'yes');}},10);
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(!m.id)return; let result={};
 if(m.method==='initialize')result={userAgent:'fixture'};
 if(m.method==='account/read')result={account:{}};
 if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:m.params.threadId??'saved-provider'},cwd:process.cwd(),model:'fixture',sandbox:{type:'readOnly'},approvalPolicy:'on-request'};
 if(m.method==='turn/start'){require('node:fs').appendFileSync(${JSON.stringify(join(dir, "effects"))},'turn\\n');result={turn:{id:'sent'}};}
 if(m.method==='turn/interrupt')require('node:fs').appendFileSync(${JSON.stringify(join(dir, "effects"))},'stop\\n');
 if(m.method==='thread/turns/list')result={data:[{id:'t',items:[{id:'i',type:'agentMessage',text:m.params.cursor===null?'first saved page':'second saved page'}]}],nextCursor:m.params.cursor===null?'second':null};
 const reply=()=>{
  process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
  if(m.method==='turn/start')for(const method of ['turn/started'])process.stdout.write(JSON.stringify({method,params:{threadId:'saved-provider',turn:{id:'sent'}}})+'\\n');
 };
 if(m.method==='turn/start' && m.params.input[0].text==='first') {
  const timer=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(join(dir, "release"))})){clearInterval(timer);reply();}},10);
 } else reply();
});`, { mode: 0o700 });

  if (phase === "followup") {
    const { Chats } = await import("../host/chat");
    const { emptyWorkspace } = await import("../host/workspace");
    const store = new Chats(join(user, "durable-chats-v1"));
    try { for (let i = 0; i < 32; i++) await store.database.recoveryWrite("measurement-" + i, "workspace", { ...emptyWorkspace(), measurement: "x".repeat(65536) }, 0); }
    finally { await store.database.close(); }
  }
  const app = await launchDesktop(user, tools, true);
  let fault: DatabaseSync | undefined;
  const stopLoad = await checkpointLoad(user);
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Start without a project", exact: true }).click();
    await page.getByRole("textbox", { name: "Message Codex" }).fill("run");
    const sendStart = performance.now();
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => readFile(join(dir, "effects"), "utf8").catch(() => "")).toBe("turn\n");
    // Provider receipt precedes settled Send; wait before capturing the live target.
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("");
    await expect(page.getByRole("status").filter({ hasText: /^Running$/ })).toBeVisible();
    const sendMs = performance.now() - sendStart;
    const stopStart = performance.now();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.poll(() => readFile(join(dir, "effects"), "utf8")).toBe("turn\nstop\n");
    const stopMs = performance.now() - stopStart;
    const liveChat = phase.startsWith("worker-loss") ? (await page.evaluate(readChats, null))[0] : undefined;
    if (phase.startsWith("worker-loss")) {
      await app.evaluate(async () => {
        const { Worker } = process.getBuiltinModule("node:worker_threads");
        const original = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (...args: Parameters<typeof original>) {
          Worker.prototype.postMessage = original;
          void this.terminate();
          return original.apply(this, args);
        };
      });
      await page.evaluate(id => window.escode.chat("composer", null, id).catch(() => {}), liveChat!.id);
    } else {
      fault = new DatabaseSync(join(user, "durable-chats-v1.sqlite-state-v1/state.sqlite"));
      // Fixture DDL competes with the load writer; wait at SQLite lock acquisition, never retry Stop.
      fault.exec("PRAGMA busy_timeout=3000");
      const setupStart = performance.now();
      fault.exec("BEGIN IMMEDIATE");
      fault.exec("CREATE TRIGGER deny_stop BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT, 'disk full'); END");
      fault.exec("CREATE TRIGGER deny_results BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT, 'disk full'); END");
      fault.exec("COMMIT");
      console.log("#139 fault setup ms", performance.now() - setupStart);
    }
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("button", { name: "Emergency Stop", exact: true })).toBeVisible();
    expect(await readFile(join(dir, "effects"), "utf8")).toBe("turn\nstop\n");
    if (phase.startsWith("worker-loss")) {
      const results = await page.evaluate(async id => {
        const state = await window.escode.sendState(null, id);
        const base = { ...state, commandId: crypto.randomUUID(), project: null, id, text: "unrecorded" };
        const attempt = async (command: typeof base & { control?: { operation: "answer"; target: string; token: string; answer: string } }) => {
          try { await window.escode.sendMessage(command); return "dispatched"; } catch { return "blocked"; }
        };
        return Promise.all([
          attempt(base),
          attempt({ ...base, commandId: crypto.randomUUID(), control: { operation: "answer", target: "", token: "forged", answer: "accept" } }),
          window.escode.sendState("/unauthorized", id).then(() => "authorized", () => "blocked"),
        ]);
      }, liveChat!.id);
      expect(results).toEqual(["blocked", "blocked", "blocked"]);
    }
    if (phase === "worker-loss-superseded") {
      await writeFile(join(dir, "supersede"), "yes");
      await expect.poll(() => readFile(join(dir, "superseded"), "utf8").catch(() => "")).toBe("yes");
    }
    const controlStart = performance.now();
    await page.getByRole("button", { name: "Emergency Stop", exact: true }).click();
    if (phase === "worker-loss-superseded") {
      await expect(page.getByRole("alert").filter({ hasText: "Stale Stop target." })).toBeVisible();
      expect(await readFile(join(dir, "effects"), "utf8")).toBe("turn\nstop\n");
      return;
    }
    await expect(page.getByRole("alert").filter({ hasText: "Cancellation requested." })).toBeVisible();
    await expect(page.getByText(/Emergency Stop result is not durable/)).toBeVisible();
    await expect(page.getByText(/External effects may remain/)).toBeVisible();
    expect(await readFile(join(dir, "effects"), "utf8")).toBe("turn\nstop\nstop\n");
    console.log("#127 visible Send/emergency control ms", JSON.stringify({ phase, sendMs, stopMs, controlMs: performance.now() - controlStart }));
  } finally {
    await stopLoad();
    fault?.close();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    if (phase.startsWith("worker-loss")) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    else await app.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
