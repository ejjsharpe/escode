import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";
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
if(m.method==='turn/start'){appendFileSync(${JSON.stringify(log)},JSON.stringify(m.params)+'\\n');result={turn:{id:'turn'}};send({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});send({method:'item/agentMessage/delta',params:{threadId:'thread',turnId:'turn',itemId:'answer',delta:${JSON.stringify('## Result\n\n**Ready**\n\n```js\nconst answer = 42;\n```\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)')}}});send({id:99,method:'item/commandExecution/requestApproval',params:{threadId:'thread',turnId:'turn',itemId:'command',command:'fixture approval'}});}
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn'}}});
if(m.method==='thread/start')setTimeout(()=>send({id:m.id,result}),1200);else send({id:m.id,result});});`, { mode: 0o700 });
  const app = await launchDesktop(join(dir, "user"), dir);
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toBeFocused();
    await page.getByLabel("Message Codex").fill("Read this");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Result", exact: true })).toBeVisible();
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
      await page.screenshot({ path: `test-results/conversation-${width}-${zoom}.png` });
    }
    await page.getByRole("button", { name: "Stop", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await app.close(); await rm(dir, { recursive: true, force: true });
  }
});
