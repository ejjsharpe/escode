import { DatabaseSync } from "node:sqlite";
import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";

test("emergency Stop visibly discloses uncertainty in the packaged app", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-history-ui-"));
  const user = join(dir, "user"), tools = join(dir, "tools");
  await mkdir(user); await mkdir(tools);
  await writeFile(join(tools, "codex"), `#!/usr/bin/env node
const {createInterface}=require('node:readline');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0);}
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

  const app = await launchDesktop(user, tools, true);
  let fault: DatabaseSync | undefined;
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Start without a project", exact: true }).click();
    await page.getByRole("textbox", { name: "Message Codex" }).fill("run");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => readFile(join(dir, "effects"), "utf8").catch(() => "")).toBe("turn\n");
    fault = new DatabaseSync(join(user, "durable-chats-v1.sqlite-state-v1/state.sqlite"));
    fault.exec("CREATE TRIGGER deny_stop BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    fault.exec("CREATE TRIGGER deny_results BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("button", { name: "Emergency Stop", exact: true })).toBeVisible();
    expect(await readFile(join(dir, "effects"), "utf8")).toBe("turn\n");
    await page.getByRole("button", { name: "Emergency Stop", exact: true }).click();
    await expect(page.getByText(/Emergency Stop result is not durable/)).toBeVisible();
    await expect(page.getByText(/External effects may remain/)).toBeVisible();
    expect(await readFile(join(dir, "effects"), "utf8")).toBe("turn\nstop\n");
  } finally {
    fault?.close();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
