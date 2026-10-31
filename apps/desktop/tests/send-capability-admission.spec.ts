import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, symlink, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop, readChatFixture } from "./desktop";

for (const kind of ["scratch", "worktree"] as const) test(`known unsupported ${kind} Send retains draft until explicit Full access`, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-admission-ui-")));
  const log = join(dir, "calls"), user = join(dir, "user"), root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]).toString();
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial");
  await symlink(process.execPath, join(dir, "node"));
  await writeFile(join(dir, "codex"), `#!/usr/bin/env node
const {createInterface}=require('node:readline'); const {appendFileSync}=require('node:fs');
if(process.argv.includes('--version')) { console.log('codex-cli 0.166.0'); process.exit(0); }
const send=x=>console.log(JSON.stringify(x)); let turnId;
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.method||!m.id)return;
appendFileSync(${JSON.stringify(log)},JSON.stringify({method:m.method})+'\\n'); let result={};
if(m.method==='initialize')result={userAgent:'fixture'};
if(m.method==='model/list')result={data:[{id:'a',hidden:false,isDefault:true,description:'Alpha model',model:'a',displayName:'Alpha',supportedReasoningEfforts:[{description:'Effort',reasoningEffort:'low'},{description:'Effort',reasoningEffort:'high'}],defaultReasoningEffort:'low'},{id:'b',hidden:false,isDefault:false,description:'Beta model',model:'b',displayName:'Beta',supportedReasoningEfforts:[{description:'Effort',reasoningEffort:'medium'}],defaultReasoningEffort:'medium'}],nextCursor:null};
if(m.method==='config/read')result={config:{}};
if(m.method==='configRequirements/read')result={requirements:null};
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:'thread'},cwd:process.cwd(),model:'a',approvalPolicy:m.method==='thread/resume'?'on-request':m.params.approvalPolicy||'on-request',approvalsReviewer:'user',sandbox:m.method==='thread/resume'?{type:'readOnly',networkAccess:false}:m.params.sandbox==='danger-full-access'?{type:'dangerFullAccess'}:m.params.sandbox==='workspace-write'?{type:'workspaceWrite',writableRoots:[],networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false}:{type:'readOnly',networkAccess:false}};
if(m.method==='thread/turns/list')result={data:[],nextCursor:null};
if(m.method==='turn/start'){turnId=require('node:crypto').randomUUID();result={turn:{id:turnId}};send({method:'turn/started',params:{threadId:'thread',turn:{id:turnId}}});}
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId:'thread',turn:{id:m.params.turnId}}});
if(m.method==='thread/start')setTimeout(()=>send({id:m.id,result}),1200);else send({id:m.id,result});});`, { mode: 0o700 });
  const app = await launchDesktop(user, dir);
  try {
    const page = await app.firstWindow();
    if (kind === "worktree") {
      await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await page.getByRole("button", { name: "Chats", exact: true }).click();
      await page.getByRole("button", { name: "New chat on current checkout" }).click();
      await page.getByText("Execution checkout choices", { exact: true }).click();
      await page.getByRole("button", { name: "Use new managed worktree on first Send" }).click();
    } else await page.getByRole("button", { name: "New chat", exact: true }).click();
    const message = page.getByLabel("Message Codex");
    await message.fill("retain rejected draft");
    await page.getByLabel("Next message permissions").selectOption(kind === "scratch" ? "supervised" : "edits");
    const records = async () => JSON.parse(await readChatFixture(join(user, "host-chats-v1.json"), "utf8")).chats;
    await expect.poll(async () => (await records())[0]?.nextPermission).toBe(kind === "scratch" ? "supervised" : "edits");
    const before = (await records())[0];
    const branches = git("branch", "--list"), worktrees = git("worktree", "list", "--porcelain");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "network isolation" }).first()).toBeVisible();
    await expect(message).toHaveValue("retain rejected draft");
    await expect(page.getByLabel("Project context", { exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("escode-send:")))).toEqual([]);
    const after = (await records())[0];
    expect(after).toMatchObject({ id: before.id, checkout: before.checkout, phase: "draft", nextPermission: before.nextPermission });
    expect(after.threadId).toBeNull();
    expect(after.worktree?.reservation).toBeUndefined();
    expect(after.scratch).toBeUndefined();
    expect(git("branch", "--list")).toBe(branches);
    expect(git("worktree", "list", "--porcelain")).toBe(worktrees);
    const calls = async () => (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line).method);
    expect((await calls()).filter(m => m === "thread/start" || m === "turn/start")).toEqual([]);
    await message.fill("explicit unrestricted draft");
    await page.getByLabel("Next message permissions").selectOption("full");
    await expect.poll(async () => (await records())[0]?.nextPermission).toBe("full");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(message).toHaveValue("");
    expect((await calls()).filter(m => m === "thread/start")).toHaveLength(1);
    expect((await calls()).filter(m => m === "turn/start")).toHaveLength(1);
    const sent = (await records())[0];
    expect(sent.phase).toBe("bound");
    expect(existsSync(sent.checkout)).toBe(true);
    expect(kind === "scratch" ? sent.scratch?.ino : sent.worktree?.reservation?.ino).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator("span[role=status]").first()).toHaveText("Ready");
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
