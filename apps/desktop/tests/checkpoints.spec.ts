import { writeApprovalFixture } from "./desktop";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";

test("packaged Send captures fresh saved bytes and permits unavailable coverage", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-checkpoint-ui-")));
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
 if(m.method==='turn/start'){require('node:fs').appendFileSync(${JSON.stringify(join(dir, "effects"))},'turn\\n');result={turn:{id:'sent',status:'completed'}};}
 if(m.method==='thread/turns/list')result={data:[{id:'t',items:[{id:'i',type:'agentMessage',text:m.params.cursor===null?'first saved page':'second saved page'}]}],nextCursor:m.params.cursor===null?'second':null};
 const reply=()=>{
  process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
  if(m.method==='turn/start')for(const method of ['turn/started','turn/completed'])process.stdout.write(JSON.stringify({method,params:{threadId:'saved-provider',turn:{id:'sent',status:'completed'}}})+'\\n');
 };
 reply();
});`, { mode: 0o700 });

  const root = join(dir, "project");
  execFileSync("git", ["init", root]);
  execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "base"]);
  await symlink(process.execPath, join(tools, "node"));
  await writeApprovalFixture(user, [{ project: root, root }]);
  await writeFile(join(root, "saved"), "before first");
  let app = await launchDesktop(user, tools, true);
  const db = new DatabaseSync(join(user, "durable-chats-v1.sqlite-state-v1/state.sqlite"));
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "Open project…" })).toBeVisible();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("region", { name: root, exact: true })).toBeVisible();
    const chat = await page.evaluate(root => window.escode.chat("createDraft", root), root);
    const send = async (text: string) => {
      if (text !== "one") await expect.poll(() => page.evaluate(async ({ root, id }) => (await window.escode.chat("open", root, id)).busy, { root, id: chat.id })).toBe(false);
      return page.evaluate(async ({ root, id, text }) => {
      const state = await window.escode.sendState(root, id);
      return await window.escode.sendMessage({ ...state, project: root, id, text, commandId: crypto.randomUUID() }) as { status: string };
    }, { root, id: chat.id, text });
    };
    const allCheckpoints = () => db.prepare("SELECT body FROM checkpoints ORDER BY rowid").all().map(row => JSON.parse(String(row.body)));
    const checkpoints = () => db.prepare("SELECT body FROM checkpoints ORDER BY rowid").all().map(row => JSON.parse(String(row.body))).filter(c => c.kind === "before-message");
    const started = performance.now();
    expect((await send("one")).status).toBe("accepted");
    expect(checkpoints()[0].commandId).toEqual(expect.any(String));
    expect(checkpoints()[0].files.saved.content).toBe(Buffer.from("before first").toString("base64"));
    await expect.poll(() => allCheckpoints().find(c => c.kind === "after-turn")?.availability).toBe("available");
    expect(allCheckpoints().find(c => c.kind === "after-turn")).toMatchObject({ turnId: "sent", threadId: "saved-provider", completion: "completed", files: { saved: { content: Buffer.from("before first").toString("base64") } } });
    await writeFile(join(root, "saved"), "manual save between turns");
    expect((await send("two")).status).toBe("accepted");
    expect(checkpoints()[1].files.saved.content).toBe(Buffer.from("manual save between turns").toString("base64"));
    db.exec("CREATE TRIGGER no_capture BEFORE INSERT ON checkpoints WHEN json_extract(NEW.body, '$.availability')='available' BEGIN SELECT RAISE(ABORT, 'capture disk full'); END");
    expect((await send("three")).status).toBe("accepted");
    expect(checkpoints()[2]).toMatchObject({ availability: "unavailable", threadId: "saved-provider", checkout: root });
    await expect.poll(() => allCheckpoints().filter(c => c.kind === "after-turn" && c.completion === "completed").length).toBe(3);
    db.exec("CREATE TRIGGER no_intent BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT, 'intent disk full'); END");
    await expect(send("refused")).rejects.toThrow();
    expect(await readFile(join(dir, "effects"), "utf8")).toBe("turn\nturn\nturn\n");
    const retained = allCheckpoints();
    const exited = new Promise<void>(resolve => app.process().once("exit", () => resolve()));
    app.process().kill("SIGKILL");
    await exited;
    app = await launchDesktop(user, tools, true);
    const reopened = await app.firstWindow();
    await reopened.waitForFunction(() => !!window.escode);
    expect(allCheckpoints()).toEqual(retained);
    expect(await readFile(join(dir, "effects"), "utf8")).toBe("turn\nturn\nturn\n");
    console.log(JSON.stringify({ threeSendsMs: performance.now() - started, checkpoints: checkpoints().map(c => c.availability) }));
  } finally { db.close(); app.process().kill("SIGKILL"); await rm(dir, { recursive: true, force: true }); }
});
