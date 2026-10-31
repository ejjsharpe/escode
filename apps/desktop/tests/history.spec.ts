import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

for (const mode of ["navigation", "streaming"] as const) test(`saved new-format history: ${mode}`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-history-ui-"));
  const user = join(dir, "user"), root = join(dir, "project"), tools = join(dir, "tools");
  await mkdir(user); await mkdir(tools); execFileSync("git", ["init", root]);
  await writeFile(join(tools, "codex"), `#!/usr/bin/env node
const {createInterface}=require('node:readline');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0);}
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(!m.id)return; let result={};
 if(m.method==='initialize')result={userAgent:'fixture'};
 if(m.method==='account/read')result={account:{}};
 if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:m.params.threadId??'saved-provider'},cwd:process.cwd(),model:'fixture',sandbox:{type:'readOnly'},approvalPolicy:'on-request'};
 if(m.method==='thread/fork')result={thread:{id:'historical-provider'}};
 if(m.method==='turn/start')result={turn:{id:'sent',status:'completed'}};
 if(m.method==='thread/turns/list')result={data:[{id:${mode === 'streaming' ? "'t'" : "(m.params.cursor===null?'sent':'later')"},items:[{id:'i',type:'agentMessage',text:m.params.cursor===null?'first saved page':'second saved page'}]}],nextCursor:m.params.cursor===null?'second':null};
 if(m.method==='thread/turns/list' && require('node:fs').existsSync(${JSON.stringify(join(dir, 'lost-history'))}))result={data:[],nextCursor:null};
 const reply=()=>{process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
 if(${mode === 'streaming'} && m.method==='thread/turns/list' && m.params.cursor==='second')setTimeout(()=>{for(const event of [{method:'turn/started',params:{threadId:'saved-provider',turn:{id:'t'}}},{method:'item/agentMessage/delta',params:{threadId:'saved-provider',turnId:'t',itemId:'i',delta:' live delta'}}])process.stdout.write(JSON.stringify(event)+'\\n');setTimeout(()=>{for(const event of [{method:'item/completed',params:{threadId:'saved-provider',turnId:'t',item:{id:'i',type:'agentMessage',text:'newest live body'}}},{method:'turn/completed',params:{threadId:'saved-provider',turn:{id:'t'}}}])process.stdout.write(JSON.stringify(event)+'\\n');},1200);},200);
 };
 if(m.method==='thread/turns/list' && m.params.cursor==='second')setTimeout(reply,1000);else reply();
 if(m.method==='turn/start')for(const method of ['turn/started','turn/completed'])process.stdout.write(JSON.stringify({method,params:{threadId:'saved-provider',turn:{id:'sent',status:'completed'}}})+'\\n');
});`, { mode: 0o700 });
  const app = await launchDesktop(user, tools, true);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: "project", exact: true })).toHaveAttribute("aria-pressed", "true");
    const chatId = await page.evaluate(async () => {
      const draft = await window.escode.chat("createDraft", null);
      await window.escode.chat("send", null, draft.id, "fixture first send");
      await window.escode.chat("disconnect", null, draft.id);
      return draft.id;
    });
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.locator(".agent-row").click();
    await expect(page.getByText("first saved page", { exact: true })).toBeVisible();
    expect(await page.evaluate(id => window.escode.chat("send", null, id, "fixture follow-up"), chatId)).toBe("");
    if (mode === "navigation") {
      const composer = page.getByRole("textbox", { name: "Message Codex" });
      await composer.fill("retained unsent text");
      await page.getByText("Historical boundaries", { exact: true }).click();
      const load = page.getByRole("button", { name: "Load boundaries", exact: true });
      await load.focus(); await page.keyboard.press("Enter");
      const after = page.getByRole("button", { name: /^After turn/ }).first();
      await expect(after).toBeVisible();
      await after.focus(); await page.keyboard.press("Enter");
      const inspection = page.getByRole("region", { name: "Boundary inspection", exact: true });
      await expect(inspection).toBeFocused();
      await expect(inspection.getByText("first saved page", { exact: true })).toBeVisible();
      await expect(inspection.getByText(/Saved files: unavailable.*No project/)).toBeVisible();
      await page.screenshot({ path: "test-results/boundary-inspection.png" });
      await page.getByRole("button", { name: /^Before message/ }).first().click();
      await expect(inspection).toBeFocused();
      await expect(inspection.getByText("first saved page", { exact: true })).toHaveCount(0);
      await writeFile(join(dir, "lost-history"), "lost");
      await after.click();
      await expect(inspection.getByText(/Provider history lost/)).toBeVisible();
      await page.screenshot({ path: "test-results/boundary-unavailable.png" });
      await rm(join(dir, "lost-history"));
      await after.click();
      await inspection.getByRole("button", { name: "Rewind conversation only…" }).click();
      const rewind = page.getByRole("region", { name: "Conversation rewind", exact: true });
      await expect(rewind).toBeFocused();
      await expect(rewind).toContainText("Later restore points may be abandoned");
      await rewind.getByRole("button", { name: "Cancel rewind" }).click();
      await expect(inspection.getByRole("button", { name: "Rewind conversation only…" })).toBeFocused();
      await inspection.getByRole("button", { name: "Rewind conversation only…" }).click();
      await rewind.getByRole("button", { name: "Confirm rewind and keep current files" }).click();
      await expect(rewind).toContainText("Conversation rewound");
      await expect(rewind).toBeFocused();
      await expect(composer).toHaveValue("retained unsent text");
      await page.screenshot({ path: "test-results/conversation-rewind.png" });
      await page.keyboard.press("Escape");
      await expect(page.getByText("Historical boundaries", { exact: true })).toBeFocused();
      await expect(inspection).not.toBeVisible();
      await expect(composer).toHaveValue("retained unsent text");
    }
    const next = page.getByRole("button", { name: "Next history page" });
    await next.focus(); await page.keyboard.press("Enter");
    if (mode === "streaming") {
      await expect(page.getByText("first saved page live delta", { exact: true })).toBeVisible();
      await expect(page.getByText("newest live body", { exact: true })).toBeVisible();
      await expect(page.getByText("second saved page", { exact: true })).toHaveCount(0);
      return;
    }
    await expect(page.getByText("second saved page", { exact: true })).toBeVisible();
    await expect(page.getByText("first saved page", { exact: true })).toHaveCount(0);
    await expect(next).toBeDisabled();
    await page.getByRole("button", { name: "Retry connection / reload history" }).click();
    await expect(page.getByText("first saved page", { exact: true })).toBeVisible();
    await expect(page.getByText("second saved page", { exact: true })).toHaveCount(0);
    await next.click();
    await expect(next).toBeDisabled();
    await expect(page.getByText("Showing one history page. Other portions are not loaded.")).toBeVisible();
    await page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: "project", exact: true }).click();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await expect(page.getByText("first saved page", { exact: true })).toBeVisible();
    await expect(page.getByText("second saved page", { exact: true })).toHaveCount(0);
    await page.waitForTimeout(1200); // Let the old view's delayed page arrive after remount.
    await expect(page.getByText("second saved page", { exact: true })).toHaveCount(0);
    for (const operation of ["open", "snapshot"]) {
      await expect(app.evaluate(async ({ ipcMain, webContents }, { operation, id }) => {
        const contents = webContents.getAllWebContents().find(w => w.getURL().includes("index.html"))!;
        const handler = (ipcMain as any)._invokeHandlers.get("chat");
        return handler({ sender: contents, senderFrame: contents.mainFrame }, operation, null, id);
      }, { operation, id: chatId })).rejects.toThrow("Invalid chat request");
    }
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
