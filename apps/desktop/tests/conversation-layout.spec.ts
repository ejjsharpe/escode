import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop, auditTextContrast } from "./desktop";
test("readable conversation retains composition and keyboard Stop in constrained windows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-model-ui-"));
  const log = join(dir, "turns");
  await writeFile(join(dir, "codex"), `#!/usr/bin/env node
const {createInterface}=require('node:readline'); const {appendFileSync}=require('node:fs');
if(process.argv.includes('--version')) { console.log('codex-cli 0.165.0'); process.exit(0); }
const send=x=>console.log(JSON.stringify(x));
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.method||!m.id)return;
let result={};
if(m.method==='initialize')result={userAgent:'fixture'};
if(m.method==='model/list')result={data:[{id:'a',hidden:false,isDefault:true,description:'Alpha model',model:'a',displayName:'Alpha',supportedReasoningEfforts:[{description:'Effort',reasoningEffort:'low'},{description:'Effort',reasoningEffort:'high'}],defaultReasoningEffort:'low'},{id:'b',hidden:false,isDefault:false,description:'Beta model',model:'b',displayName:'Beta',supportedReasoningEfforts:[{description:'Effort',reasoningEffort:'medium'}],defaultReasoningEffort:'medium'}],nextCursor:null};
if(m.method==='config/read')result={config:{}};
if(m.method==='configRequirements/read')result={requirements:null};
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:'thread'},cwd:process.cwd(),model:'a',approvalPolicy:m.params.approvalPolicy||'on-request',approvalsReviewer:'user',sandbox:m.params.sandbox==='danger-full-access'?{type:'dangerFullAccess'}:{type:'readOnly',networkAccess:false}};
if(m.method==='thread/turns/list')result={data:[],nextCursor:null};
if(m.method==='turn/start'){appendFileSync(${JSON.stringify(log)},JSON.stringify(m.params)+'\\n');result={turn:{id:'turn'}};send({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});send({method:'item/agentMessage/delta',params:{threadId:'thread',turnId:'turn',itemId:'answer',delta:${JSON.stringify('## Result\n\n' + 'Readable transcript paragraph.\n\n'.repeat(40) + '**Ready**\n\n```js\nconst answer = 42;\n```\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)')}}});send({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'tool',type:'commandExecution',command:'echo inspected',aggregatedOutput:'tool output'}}});send({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{id:'failure',type:'commandExecution',command:'failed command',aggregatedOutput:'visible failure'}}});send({id:99,method:'item/commandExecution/requestApproval',params:{threadId:'thread',turnId:'turn',itemId:'command',command:'fixture approval'}});send({id:100,method:'item/tool/requestUserInput',params:{threadId:'thread',turnId:'turn',itemId:'input',questions:[{id:'answer',header:'Question',question:'Qualification answer',isOther:false,isSecret:false,options:null}]}});}
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn'}}});
if(m.method==='thread/start')setTimeout(()=>send({id:m.id,result}),1200);else send({id:m.id,result});});`, { mode: 0o700 });
  const app = await launchDesktop(join(dir, "user"), dir);
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toBeFocused();
    const empty = await page.locator(".conversation-layout").boundingBox();
    const compose = await page.locator(".chat-compose").boundingBox();
    expect(Math.abs(compose!.y + compose!.height / 2 - (empty!.y + empty!.height / 2))).toBeLessThan(100);
    for (const [width, height, zoom] of [[1000, 700, 1], [800, 500, 1], [1200, 900, 2]]) {
      await page.setViewportSize({ width, height });
      await app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom);
      await expect(page.getByLabel("Message Codex")).toBeInViewport();
      console.log("contrast", JSON.stringify(await auditTextContrast(page)));
      await page.screenshot({ path: `test-results/empty-native-${width}-${zoom}.png` });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.getByLabel("Message Codex").fill("Read this");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Result", exact: true })).toBeVisible();
    const composerBeforeScroll = await page.getByLabel("Message Codex").boundingBox();
    const scrolling = await page.getByLabel("Conversation history").evaluate(element => {
      element.scrollTop = element.scrollHeight;
      return { height: element.clientHeight, content: element.scrollHeight, top: element.scrollTop };
    });
    expect(scrolling.content).toBeGreaterThan(scrolling.height);
    expect(scrolling.top).toBeGreaterThan(0);
    expect((await page.getByLabel("Message Codex").boundingBox())!.y).toBe(composerBeforeScroll!.y);
    await expect(page.getByText("Tool activity · commandExecution", { exact: true })).toBeVisible();
    await expect(page.getByText("tool output", { exact: false })).toBeHidden();
    await page.getByText("Tool activity · commandExecution", { exact: true }).click();
    await expect(page.getByText("tool output", { exact: false })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "visible failure" })).toBeVisible();
    await expect(page.locator(".chat-compose + *")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reload history", exact: true })).toBeHidden();
    await page.getByText("Chat actions", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Reload history", exact: true })).toBeVisible();
    await expect(page.getByText(/Effective Codex settings/)).toBeVisible();
    await page.getByText("Chat actions", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Codex requests permission" })).toBeVisible();
    await expect(page.locator(".conversation-text script")).toHaveCount(0);
    await expect(page.locator(".conversation-text a")).not.toHaveAttribute("href", /^javascript:/);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].focus(); BrowserWindow.getAllWindows()[0].webContents.focus(); });
    await page.getByRole("button", { name: "Copy code", exact: true }).click();
    await expect(page.locator(".code-block")).toContainText("Copied");
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe("const answer = 42;");
    for (const [width, height, zoom] of [[1000,700,1], [800,500,1], [1200,900,2]]) {
      await page.setViewportSize({ width: Math.floor(width / zoom), height: Math.floor(height / zoom) });
      await expect(page.getByLabel("Message Codex")).toBeInViewport();
      await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeInViewport();
      console.log("contrast", JSON.stringify(await auditTextContrast(page)));
      await page.screenshot({ path: `test-results/conversation-${width}-${zoom}.png` });
    }
    await page.setViewportSize({ width: 1200, height: 900 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
    await expect(page.getByLabel("Message Codex")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeInViewport();
    expect((await page.getByLabel("Conversation history").boundingBox())!.height).toBeGreaterThanOrEqual(60);
    await page.getByRole("heading", { name: "Codex requests permission" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "Codex requests permission" })).toBeInViewport();
    console.log("contrast", JSON.stringify(await auditTextContrast(page)));
    await page.screenshot({ path: "test-results/conversation-native-200.png" });
    for (const [width, height, zoom] of [[1000,700,1], [600,700,1], [1000,450,1], [1200,900,2]]) {
      await page.setViewportSize({ width, height });
      await app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom);
      await page.getByRole("button", { name: "Allow once", exact: true }).focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      for (const name of ["Allow once", "Decline", "Cancel request"]) {
        const action = page.getByRole("button", { name, exact: true });
        await expect(action).toBeFocused();
        await expect(action).toBeInViewport();
        await page.keyboard.press("Tab");
      }
      const answer = page.getByRole("textbox", { name: "Qualification answer", exact: true });
      await answer.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(answer).toBeFocused();
      await expect(answer).toBeInViewport();
      await answer.fill("Retained keyboard answer");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Send answers", exact: true })).toBeFocused();
      await expect(page.getByRole("button", { name: "Send answers", exact: true })).toBeInViewport();
      expect(await auditTextContrast(page)).toEqual([]);
      await page.screenshot({ path: `test-results/request-keyboard-${width}-${height}-${zoom}.png` });
    }
    await page.getByRole("button", { name: "Stop", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await app.close(); await rm(dir, { recursive: true, force: true });
  }
});
