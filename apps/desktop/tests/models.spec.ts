import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";
test("next message model persists and changing a running turn never queues work", async () => {
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
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:'thread'},cwd:process.cwd(),model:'a',approvalPolicy:'on-request',sandbox:{type:'readOnly'}};
if(m.method==='thread/turns/list')result={data:[],nextCursor:null};
if(m.method==='turn/start'){appendFileSync(${JSON.stringify(log)},JSON.stringify(m.params)+'\\n');result={turn:{id:'turn'}};send({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});}
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn'}}});
if(m.method==='thread/start')setTimeout(()=>send({id:m.id,result}),1200);else send({id:m.id,result});});`, { mode: 0o700 });
  let app = await launchDesktop(join(dir, "user"), dir);
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "No project", exact: true }).click();
    await page.getByLabel("Message Codex").fill("retain my text");
    await page.getByLabel("Next message model").selectOption("a");
    await page.getByLabel("Next message effort").selectOption("high");
    await page.getByLabel("Next message model").selectOption("b");
    await expect(page.getByLabel("Next message effort")).toHaveValue("medium");
    await page.getByLabel("Next message model").selectOption("a");
    await expect(page.getByLabel("Next message effort")).toHaveValue("high");
    await expect(page.getByLabel("Message Codex")).toHaveValue("retain my text");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.locator("span[role=status]")).toHaveText("Preparing…");
    await page.getByLabel("Next message model").selectOption("b");
    await expect(page.getByLabel("Next message effort")).toHaveValue("medium");
    await expect(page.locator("span[role=status]")).toHaveText("Running");
    await page.getByLabel("Next message model").selectOption("b");
    expect((await readFile(log, "utf8")).trim().split("\n").map(x => JSON.parse(x))).toEqual([expect.objectContaining({ model: "a", effort: "high" })]);
    await expect(page.getByLabel("Next message effort")).toHaveValue("medium");
    await expect(page.getByLabel("Message Codex")).toHaveValue("");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator("span[role=status]")).toHaveText("Ready");
    await app.close();
    app = await launchDesktop(join(dir, "user"), dir);
    page = await app.firstWindow();
    await expect(page.getByLabel("Next message model")).toHaveValue("b");
    await expect(page.getByLabel("Next message effort")).toHaveValue("medium");
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);
    await page.getByLabel("Message Codex").fill("explicit follow-up");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("");
    const turns = (await readFile(log, "utf8")).trim().split("\n").map(x => JSON.parse(x));
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ model: "b", effort: "medium" });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator("span[role=status]")).toHaveText("Ready");
    await page.screenshot({ path: "test-results/models.png" });
  } finally { await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); }); await app.close(); await rm(dir, { recursive: true, force: true }); }
});
