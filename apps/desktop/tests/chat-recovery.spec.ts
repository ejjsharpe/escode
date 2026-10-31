import { test, expect } from "@playwright/test";
import { mkdtemp, realpath, mkdir, rename, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop, readChats } from "./desktop";

test("Agents retains closed unavailable contexts, Stop and exact-path Retry through restart without Git", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-chat-recovery-")));
  const root = join(dir, "repo"),
    user = join(dir, "user"),
    wire = join(dir, "wire");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "retained file");
  await writeFile(join(dir, "git"), '#!/bin/sh\nexec /usr/bin/git "$@"\n', { mode: 0o700 });
  await writeFile(
    join(dir, "codex"),
    `#!/usr/bin/env node
const fs=require('node:fs'),{createInterface}=require('node:readline');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit()}
const threadId=process.cwd(),send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id||!m.method)return;
fs.appendFileSync(${JSON.stringify(wire)},JSON.stringify({cwd:process.cwd(),...m})+'\\n');
let result={};if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
if(m.method==='config/read')result={config:{}};
if(m.method==='configRequirements/read')result={requirements:null};
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:threadId},cwd:threadId,model:'fixture',sandbox:m.params.sandbox==='danger-full-access'?{type:'dangerFullAccess'}:{type:'readOnly',networkAccess:false},approvalPolicy:m.params.approvalPolicy||'on-request',approvalsReviewer:'user'};
if(m.method==='thread/turns/list')result={data:[{id:'turn',items:[{id:'reply',type:'agentMessage',text:'retained history'}]}],nextCursor:null};
if(m.method==='turn/start'){result={turn:{id:'turn'}};send({method:'turn/started',params:{threadId,turn:{id:'turn'}}});send({method:'item/completed',params:{threadId,turnId:'turn',item:{id:'reply',type:'agentMessage',text:'retained history'}}});send({id:99,method:'item/commandExecution/requestApproval',params:{threadId,turnId:'turn',command:'fixture'}})}
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId,turn:{id:'turn'}}});
send({id:m.id,result});});`,
    { mode: 0o700 },
  );
  let app = await launchDesktop(user, dir);
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("treeitem", { name: "a.txt", exact: true })).toBeVisible();
    const ids = await page.evaluate(async (root) => {
      const a = await window.escode.chat("create", root, root);
      await window.escode.chat("open", root, a.id);
      await window.escode.chat("send", root, a.id, "first");
      const b = await window.escode.chat("createDraft", null);
      await window.escode.chat("send", null, b.id, "scratch");
      return { a: a.id, b: b.id };
    }, root);
    await page
      .getByRole("navigation", { name: "Projects", exact: true })
      .getByRole("button", { name: /^repo/ })
      .click({ button: "middle" });
    await page.locator(".agent-row").filter({ hasText: "repo" }).click();
    await page.getByLabel("Message Codex").fill("keep project draft");
    await rename(root, root + "-away");
    await expect(page.getByRole("alert")).toContainText(root);
    await expect(page.getByRole("alert")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
    await page.screenshot({ path: "test-results/escode-36-unavailable.png" });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ root, id }) => ((project: string | null, id: string) => new Promise<import("../host/chat-service").ChatSnapshot>((resolve, reject) => { const off = window.escode.chatLive(project, id, value => { off(); resolve({ ...value, items: [...value.items], requests: [...value.requests] }); }, message => { off(); reject(Error(message)); }); }))( root, id).then((s) => s.busy),
          { root, id: ids.a },
        ),
      )
      .toBe(false);
    expect(
      (await page.evaluate((id) => ((project: string | null, id: string) => new Promise<import("../host/chat-service").ChatSnapshot>((resolve, reject) => { const off = window.escode.chatLive(project, id, value => { off(); resolve({ ...value, items: [...value.items], requests: [...value.requests] }); }, message => { off(); reject(Error(message)); }); }))( null, id), ids.b)).busy,
    ).toBe(true);
    await page.evaluate((id) => new Promise<void>((resolve, reject) => { const off = window.escode.chatLive(null, id, snapshot => { off(); window.escode.chat("stop", null, id, snapshot.controlTarget).then(() => resolve(), reject); }, reject); }), ids.b);
    await app.close();
    await mkdir(root);
    await writeFile(join(dir, "git"), "#!/bin/sh\nexit 127\n", { mode: 0o700 });
    app = await launchDesktop(user, dir);
    page = await app.firstWindow();
    await expect(page.getByLabel("Message Codex")).toHaveValue("keep project draft");
    const retry = page.getByRole("button", { name: "Retry connection / reload history" });
    await retry.click();
    await expect(page.getByRole("alert")).toContainText(root);
    await rm(root, { recursive: true });
    await rename(root + "-away", root);
    await page.getByText("Chat actions", { exact: true }).click();
    await page.getByRole("button", { name: "Reload history", exact: true }).click();
    await page.getByText("Chat actions", { exact: true }).click();
    await expect(page.locator(".chat-actions [role=status]")).toHaveText("Ready");
    await expect(page.getByLabel("Conversation history")).toContainText("retained history");
    await expect(page.getByLabel("Message Codex")).toHaveValue("keep project draft");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.locator(".agent-row").filter({ hasText: "No project" }).click();
    await page.getByLabel("Message Codex").fill("keep scratch draft");
    const scratch = (await page.evaluate(readChats, null))[0].checkout;
    await rename(scratch, scratch + "-away");
    await retry.click();
    await expect(page.getByRole("alert")).toContainText(scratch);
    await expect(page.getByLabel("Message Codex")).toHaveValue("keep scratch draft");
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
    await rename(scratch + "-away", scratch);
    await page.getByText("Chat actions", { exact: true }).click();
    await page.getByRole("button", { name: "Reload history", exact: true }).click();
    await page.getByText("Chat actions", { exact: true }).click();
    await expect(page.locator(".chat-actions [role=status]")).toHaveText("Ready");
    await expect(page.getByLabel("Message Codex")).toHaveValue("keep scratch draft");
    const calls = (await readFile(wire, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.filter((c) => c.method === "turn/start")).toHaveLength(3);
    expect(calls.filter((c) => c.method === "thread/start")).toHaveLength(2);
    expect(
      calls
        .filter((c) => c.method === "thread/resume")
        .every((c) => c.cwd === root || c.cwd === scratch),
    ).toBe(true);
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      })
      .catch(() => {});
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
