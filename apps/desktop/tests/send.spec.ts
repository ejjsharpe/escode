import { readChatFixture } from "./desktop";
import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";

test("durable Send receipts prevent duplicate provider dispatch over authenticated RPC", async () => {
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
 if(m.method==='thread/turns/list')result={data:[{id:'t',items:[{id:'i',type:'agentMessage',text:m.params.cursor===null?'first saved page':'second saved page'}]}],nextCursor:m.params.cursor===null?'second':null};
 const reply=()=>{
  process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
  if(m.method==='turn/start')for(const method of ['turn/started','turn/completed'])process.stdout.write(JSON.stringify({method,params:{threadId:'saved-provider',turn:{id:'sent'}}})+'\\n');
 };
 if(m.method==='turn/start' && m.params.input[0].text==='first') {
  const timer=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(join(dir, "release"))})){clearInterval(timer);reply();}},10);
 } else reply();
});`, { mode: 0o700 });

  let app = await launchDesktop(user, tools);
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "Start without a project", exact: true }).click();
    const message = () => page.getByRole("textbox", { name: "Message Codex" });
    await message().fill("first");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => readFile(join(dir, "effects"), "utf8").catch(() => "")).toBe("turn\n");
    const chat = JSON.parse(await readChatFixture(join(user, "host-chats-v1.json"), "utf8")).chats[0];
    await page.evaluate(id => window.escode.chat("draft", null, id, "newer unsent text"), chat.id);
    await writeFile(join(dir, "release"), "accept");
    await expect(message()).toBeEnabled();
    await expect(message()).toHaveValue("newer unsent text");
    await app.close();
    app = await launchDesktop(user, tools);
    page = await app.firstWindow();
    await expect(message()).toHaveValue("newer unsent text");
    await expect(message()).toBeEnabled();
    const result = await page.evaluate(async (chat) => {
      await window.escode.chat("disconnect", null, chat.id);
      await window.escode.chat("open", null, chat.id);
      const state = await window.escode.sendState(null, chat.id);
      const command = { ...state, commandId: crypto.randomUUID(), project: null, id: chat.id, text: "second" };
      const first = await window.escode.sendMessage(command) as any;
      const repeated = await window.escode.sendMessage(command) as any;
      let conflict = false;
      try { await window.escode.sendMessage({ ...command, text: "changed" }); } catch { conflict = true; }
      const status = await window.escode.sendStatus(command.commandId) as any;
      await window.escode.chat("disconnect", null, chat.id);
      await window.escode.chat("open", null, chat.id);
      const stale = await window.escode.sendMessage({ ...command, commandId: crypto.randomUUID() }) as any;
      if (stale.status !== "uncertain" || !stale.message.includes("state changed")) throw Error("Stale state admitted");
      const key = `escode-send:${JSON.stringify([null, chat.id])}`;
      localStorage.setItem(key, JSON.stringify(command));
      await window.escode.chat("draft", null, chat.id, "keep independent text");
      return { first: first.status, repeated: repeated.status, status: status.status, conflict, id: chat.id };
    }, chat);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    expect(await page.evaluate(async id => {
      await window.escode.chat("resolveSend", null, id);
      return { pending: localStorage.getItem(`escode-send:${JSON.stringify([null, id])}`), text: await window.escode.chat("composer", null, id) };
    }, result.id)).toEqual({ pending: null, text: "keep independent text" });
    expect({ ...result, id: undefined }).toEqual({ first: "accepted", repeated: "accepted", status: "accepted", conflict: true, id: undefined });
    expect((await readFile(join(dir, "effects"), "utf8")).trim().split("\n")).toHaveLength(2);
    expect(await app.evaluate(async ({ ipcMain, BrowserWindow }, id) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      try {
        await (ipcMain as any)._invokeHandlers.get("chat")({ sender: contents, senderFrame: contents.mainFrame }, "send", null, id, "removed route");
        return "unexpected success";
      } catch (error) { return String(error); }
    }, result.id)).toContain("Invalid chat request");
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
