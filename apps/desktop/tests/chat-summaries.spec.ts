import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop, writeApprovalFixture, writeRecoveryFixture } from "./desktop";

test("fresh summaries exclude old metadata and bodies, release detail polling during navigation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "escode-summaries-"));
  const user = join(directory, "user");
  const root = join(directory, "project");
  execFileSync("git", ["init", root]);
  await mkdir(user);
  const legacy = '[{"id":"old-chat","draft":"legacy secret"}]';
  await writeFile(join(user, "chats.json"), legacy);
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await app.evaluate(async ({ dialog, webContents }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      (globalThis as any).detailCalls = {};
      const debugger_ = webContents.getAllWebContents()[0].debugger;
      debugger_.attach("1.3");
      await debugger_.sendCommand("Network.enable");
      debugger_.on("message", (_event: unknown, method: string, params: any) => {
        if (method !== "Network.webSocketFrameSent") return;
        try {
          const request = JSON.parse(params.response.payloadData);
          if (request.tag !== "chatLive") return;
          const counts = (globalThis as any).detailCalls;
          counts[request.payload.id] = (counts[request.payload.id] ?? 0) + 1;
        } catch { /* Ignore other transport frames. */ }
      });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: "project", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await expect(page.getByText("No saved chats. Start without a project or open a project.")).toBeVisible();
    const draft = await page.evaluate(() => window.escode.chat("createDraft", null));
    await page.evaluate(id => window.escode.chat("draft", null, id, "private composer"), draft.id);
    await expect(page.locator(".agent-row")).toHaveCount(1);
    const payload = await page.evaluate(() => new Promise<string>((resolve, reject) => {
      const off = window.escode.chatSummaries(value => { off(); resolve(JSON.stringify(value)); }, reject);
    }));
    expect(payload).toContain(draft.id);
    expect(payload).not.toMatch(/private composer|legacy secret|items|requests|draft":/);
    expect(await readFile(join(user, "chats.json"), "utf8")).toBe(legacy);
    await expect(page.evaluate(() => window.escode.chat("catalogue" as never))).rejects.toThrow();
    await page.locator(".agent-row").click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("private composer");
    await expect.poll(() => app.evaluate((_e, id) => (globalThis as any).detailCalls[id] ?? 0, draft.id)).toBeGreaterThan(0);
    const second = await page.evaluate(async () => {
      const chat = await window.escode.chat("createDraft", null);
      await window.escode.chat("draft", null, chat.id, "second composer");
      return chat;
    });
    await expect(page.locator(".agent-row")).toHaveCount(2);
    await page.locator(".agent-row").first().click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("second composer");
    await page.waitForTimeout(400);
    const previous = await app.evaluate((_e, id) => (globalThis as any).detailCalls[id], draft.id);
    await page.waitForTimeout(700);
    expect(await app.evaluate((_e, id) => (globalThis as any).detailCalls[id], draft.id)).toBe(previous);
    await page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: "project", exact: true }).click();
    await page.waitForTimeout(400);
    const calls = await app.evaluate(() => (globalThis as any).detailCalls);
    await page.waitForTimeout(700);
    expect(await app.evaluate(() => (globalThis as any).detailCalls)).toEqual(calls);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    // A context change keeps the identity in the shared list without duplicate rows.
    await page.evaluate(id => window.escode.chat("context", null, id, null), draft.id);
    await expect(page.locator(".agent-row")).toHaveCount(2);
    expect(second.id).not.toBe(draft.id);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("recent rows use last user message time and retain exact context", async () => {
  const directory = await mkdtemp(join(tmpdir(), "escode-recents-"));
  const user = join(directory, "user");
  const { writeChatFixture } = await import("./desktop");
  await mkdir(user);
  await writeChatFixture(join(user, "chats.json"), JSON.stringify({ chats: [
    { id: "older-created", project: null, checkout: "", threadId: null, draft: "", createdAt: 1, latestUserMessageAt: Date.now(), title: "Recent user request" },
    { id: "fallback-created", project: null, checkout: "", threadId: null, draft: "", createdAt: 100, title: "Creation fallback" },
    { id: "fallback-update", project: null, checkout: "", threadId: null, draft: "", createdAt: 1, updatedAt: 200, title: "Update fallback" },
    { id: "fallback-user", project: null, checkout: "", threadId: null, draft: "", createdAt: 1, updatedAt: 9000, latestUserMessageCreatedAt: 300, title: "User creation fallback" },
    { id: "z-tie", project: null, checkout: "", threadId: null, draft: "", createdAt: 100, title: "Descending identity" },
    { id: "newer-created", project: null, checkout: "", threadId: null, draft: "", createdAt: 2000, latestUserMessageAt: 3000, title: "Older user request" },
  ] }));
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    const rows = page.locator(".agent-row");
    await expect(rows).toHaveCount(6);
    await expect(rows.locator("strong")).toHaveText(["Recent user request", "Older user request", "User creation fallback", "Update fallback", "Descending identity", "Creation fallback"]);
    await expect(rows.first()).toContainText("Recent user request");
    await expect(rows.first()).toContainText("now");
    await expect(rows.first()).toHaveAttribute("title", /No project/);
    await expect(rows.first()).not.toContainText("Stopped");
    await expect(page.getByRole("heading", { name: "Saved chats" })).toHaveCount(0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("thirty chats across five projects keep one list while three run", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "escode-thirty-")));
  const user = join(directory, "user");
  const { writeChatFixture } = await import("./desktop");
  const roots = Array.from({ length: 5 }, (_, i) => join(directory, String(i), "same-name"));
  for (const root of roots) execFileSync("git", ["init", root]);
  await mkdir(user);
  const saved = roots.map(root => ({ project: root, root }));
  await writeApprovalFixture(user, saved);
  await writeRecoveryFixture(join(user, "client-workspace-v1.json"), JSON.stringify({ projects: saved, selected: "agents", views: {}, drafts: [] }));
  const records = Array.from({ length: 30 }, (_, i) => ({ id: `chat-${i}`, project: roots[i % 5], checkout: roots[i % 5], threadId: `thread-${i}`, draft: "", hasSent: true, title: `Request ${i}`, createdAt: i + 1, latestUserMessageAt: i + 1 }));
  await writeChatFixture(join(user, "chats.json"), JSON.stringify({ chats: records }));
  await writeFile(join(directory, "codex"), `#!/usr/bin/env node
const {createInterface}=require('node:readline');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0)}
let threadId;const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id||!m.method)return;let result={};
if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/resume'){threadId=m.params.threadId;result={thread:{id:threadId},cwd:process.cwd(),model:'fixture',approvalPolicy:'on-request',sandbox:{type:'readOnly'}}}
if(m.method==='thread/turns/list')result={data:[],nextCursor:null};
if(m.method==='turn/start'){result={turn:{id:'turn'}};send({method:'turn/started',params:{threadId,turn:{id:'turn'}}});send({method:'item/completed',params:{threadId,turnId:'turn',item:{id:'user',type:'userMessage',content:[{type:'text',text:'Work',text_elements:[]}]}}});setTimeout(()=>send({method:'item/agentMessage/delta',params:{threadId,turnId:'turn',itemId:'answer',delta:'Background answer'}}),100)}
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId,turn:{id:'turn'}}});
send({id:m.id,result});});`, { mode: 0o700 });
  const app = await launchDesktop(user, directory);
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await expect(page.locator(".agent-row")).toHaveCount(30);
    await expect(page.locator(".agent-row strong").first()).toHaveText("Request 29");
    for (const record of records.slice(0, 3)) {
      await page.evaluate(async record => { await window.escode.chat("open", record.project, record.id); await window.escode.chat("send", record.project, record.id, "Work"); }, record);
    }
    await expect(page.locator('.agent-row[aria-label*="Running"]')).toHaveCount(3);
    await expect(page.locator(".agent-row strong").first()).toHaveText("Request 2");
    const order = await page.locator(".agent-row strong").allTextContents();
    await page.waitForTimeout(500);
    expect(await page.locator(".agent-row strong").allTextContents()).toEqual(order);
    await expect(page.locator(".agent-row").first()).toHaveAttribute("title", new RegExp(roots[2]));
    for (const record of records.slice(0, 3)) await page.evaluate(record => new Promise<void>((resolve, reject) => { const off = window.escode.chatLive(record.project, record.id, snapshot => { off(); window.escode.chat("stop", record.project, record.id, snapshot.controlTarget).then(() => resolve(), reject); }, reject); }), record);
    await expect(page.locator('.agent-row[aria-label*="Running"]')).toHaveCount(0);
    expect(await page.locator(".agent-row strong").allTextContents()).toEqual(order);
    await page.screenshot({ path: "/tmp/escode-147-recents.png" });
  } finally { await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); }); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
