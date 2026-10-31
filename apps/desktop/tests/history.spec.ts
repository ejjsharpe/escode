import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Chats } from "../host/chat";
import { captureTurnCheckpoint } from "../host/checkpoints";
import { launchDesktop } from "./desktop";

for (const mode of ["navigation", "streaming", "files", "branch", "branch-after", "restoration"] as const) test(`saved new-format history: ${mode}`, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-history-ui-")));
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
 if(m.method==='thread/turns/list')result={data:[...${(mode === "branch" || mode === "branch-after") ? "(m.params.cursor===null?[{id:'earlier',items:[]}]:[])" : "[]"},{id:${mode === 'streaming' ? "'t'" : "(m.params.cursor===null?'sent':'later')"},items:[{id:'i',type:'agentMessage',text:m.params.cursor===null?'first saved page':'second saved page'}]}],nextCursor:m.params.cursor===null?'second':null};
 if(m.method==='thread/turns/list' && require('node:fs').existsSync(${JSON.stringify(join(dir, 'lost-history'))}))result={data:[],nextCursor:null};
 const reply=()=>{process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
 if(${mode === 'streaming'} && m.method==='thread/turns/list' && m.params.cursor==='second')setTimeout(()=>{for(const event of [{method:'turn/started',params:{threadId:'saved-provider',turn:{id:'t'}}},{method:'item/agentMessage/delta',params:{threadId:'saved-provider',turnId:'t',itemId:'i',delta:' live delta'}}])process.stdout.write(JSON.stringify(event)+'\\n');setTimeout(()=>{for(const event of [{method:'item/completed',params:{threadId:'saved-provider',turnId:'t',item:{id:'i',type:'agentMessage',text:'newest live body'}}},{method:'turn/completed',params:{threadId:'saved-provider',turn:{id:'t'}}}])process.stdout.write(JSON.stringify(event)+'\\n');},1200);},200);
 };
 if(m.method==='thread/turns/list' && m.params.cursor==='second')setTimeout(reply,1000);else reply();
 if(m.method==='turn/start')for(const method of ['turn/started','turn/completed'])process.stdout.write(JSON.stringify({method,params:{threadId:'saved-provider',turn:{id:'sent',status:'completed'}}})+'\\n');
});`, { mode: 0o700 });
  if ((mode === "files" || mode === "branch" || mode === "branch-after" || mode === "restoration")) {
    await writeFile(join(root, "saved.txt"), "base saved text");
    execFileSync("git", ["-C", root, "add", "saved.txt"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
    await writeFile(join(root, "saved.txt"), "captured saved text");
  }
  let restoredChat: string | undefined;
  if (mode === "restoration") {
    const isolated = join(dir, "isolated");
    execFileSync("git", ["-C", root, "worktree", "add", "-qb", "isolated", isolated]);
    const store = new Chats(join(user, "durable-chats-v1"));
    const chat = await store.createDraft(root, isolated); restoredChat = chat.id;
    const identity = await stat(isolated);
    const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    await store.update(root, chat.id, { threadId: "saved-provider", phase: "bound", directoryIdentity: { path: isolated, dev: identity.dev, ino: identity.ino }, worktree: { source: root, ref: "isolated", commit, reservation: { root: isolated, branch: "isolated", commit, dev: identity.dev, ino: identity.ino } } });
    await writeFile(join(isolated, "saved.txt"), "captured saved text");
    await store.database.command("checkpoint", { body: { id: "restoration", chatId: chat.id, kind: "after-turn", completion: "pending", threadId: "saved-provider", checkout: isolated, commandId: null, availability: "unavailable" } });
    await captureTurnCheckpoint(store.database, await store.get(root, chat.id), "saved-provider", undefined, { id: "restoration", turnId: "sent", completion: "completed", createdAt: Date.now() });
    await writeFile(join(isolated, "saved.txt"), "today saved text");
    await store.database.close();
  }
  const app = await launchDesktop(user, tools, true);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: "project", exact: true })).toHaveAttribute("aria-pressed", "true");
    const context = (mode === "files" || mode === "branch" || mode === "branch-after") ? root : null;
    const chatId = restoredChat ?? await page.evaluate(async ({ context, branching }) => {
      const draft = await window.escode.chat("createDraft", context);
      await window.escode.chat("send", context, draft.id, "fixture first send");
      if (branching) {
        for (let n = 0; n < 100; n++) { const state = await window.escode.chat("open", context, draft.id); if (!state.busy) break; await new Promise(r => setTimeout(r, 20)); }
        await window.escode.chat("send", context, draft.id, "fixture second send");
      }
      await window.escode.chat("disconnect", context, draft.id);
      return draft.id;
    }, { context, branching: (mode === "branch" || mode === "branch-after") });
    if (mode === "restoration") {
      await app.evaluate(({ dialog }, isolated) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [isolated] }); }, join(dir, "isolated"));
      await page.getByRole("button", { name: "Open project…" }).click();
      await expect(page.locator('.project-tab[data-active="true"] > button[aria-pressed]')).toHaveAttribute("aria-description", "isolated · " + join(dir, "isolated"));
      await page.getByRole("button", { name: "Files", exact: true }).filter({ visible: true }).click();
      await page.getByRole("treeitem", { name: "saved.txt", exact: true }).filter({ visible: true }).click();
      await expect(page.locator(".monaco-editor:visible")).toContainText("today saved text");
      await page.locator(".monaco-editor:visible").click();
      await page.keyboard.press("Meta+a");
      await page.keyboard.type("unsaved editor text");
      await expect(page.getByText("saved.txt • Unsaved", { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.locator(".agent-row").click();
    await expect(page.getByText("first saved page", { exact: true })).toBeVisible();
    if (mode === "branch" || mode === "branch-after") {
      await page.getByRole("textbox", { name: "Message Codex" }).fill("retained branch draft");
      await page.getByText("Historical boundaries", { exact: true }).click();
      await page.getByRole("button", { name: "Load boundaries", exact: true }).click();
      await page.getByRole("button", { name: mode === "branch-after" ? /^After turn/ : /^Before message/ }).first().click();
      await page.getByRole("button", { name: "Branch historical chat…", exact: true }).click();
      const result = page.getByRole("region", { name: "Historical branch", exact: true });
      await expect(result).toBeFocused();
      await expect(result).toContainText("Create a separate historical chat");
      await result.getByRole("button", { name: "Create historical chat and worktree", exact: true }).click();
      await expect(result).toContainText("created at");
      await expect(result).toBeFocused();
      await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("retained branch draft");
      await page.screenshot({ path: `test-results/historical-${mode}.png` });
      return;
    }
    if (mode === "restoration") {
      const composer = page.getByRole("textbox", { name: "Message Codex" });
      await composer.fill("retained unsent text");
      await page.getByText("Historical boundaries", { exact: true }).click();
      await page.getByRole("button", { name: "Load boundaries", exact: true }).click();
      await page.getByRole("button", { name: /^After turn/ }).first().click();
      const button = page.getByRole("button", { name: "Rewind and restore saved files…" });
      await button.click();
      const choice = page.getByRole("region", { name: "Conversation rewind", exact: true });
      await expect(choice).toBeFocused();
      await expect(choice).toContainText("Saved edits will be replaced");
      await expect(choice).toContainText("untracked files may be removed");
      await choice.getByRole("button", { name: "Cancel rewind" }).click();
      await expect(button).toBeFocused();
      expect(await readFile(join(dir, "isolated", "saved.txt"), "utf8")).toBe("today saved text");
      await button.click();
      await choice.getByRole("button", { name: "Confirm restoration and retain unsaved edits" }).click();
      await expect(choice).toContainText("Conversation and saved files restored");
      await expect(choice).toBeFocused();
      expect(await readFile(join(dir, "isolated", "saved.txt"), "utf8")).toBe("captured saved text");
      await expect(composer).toHaveValue("retained unsent text");
      await page.screenshot({ path: "test-results/protected-restoration.png" });
      await page.getByRole("button", { name: "Open checkout", exact: true }).click();
      const editor = page.locator(".monaco-editor:visible");
      await expect(editor).toContainText("unsaved editor text");
      await expect(page.getByText("saved.txt • Unsaved", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
      await expect(page.locator(".conflict")).toBeVisible();
      expect(await readFile(join(dir, "isolated", "saved.txt"), "utf8")).toBe("captured saved text");
      await page.getByRole("button", { name: "Compare", exact: true }).click();
      await expect(page.locator(".monaco-diff-editor")).toContainText("captured saved text");
      await expect(page.locator(".monaco-diff-editor")).toContainText("unsaved editor text");
      await page.screenshot({ path: "test-results/protected-restoration-dirty-conflict.png" });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(editor).toContainText("unsaved editor text");
      await writeFile(join(dir, "isolated", "saved.txt"), "external after restoration");
      await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
      await expect(page.locator(".conflict")).toBeVisible();
      expect(await readFile(join(dir, "isolated", "saved.txt"), "utf8")).toBe("external after restoration");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      // Only the originally loaded bytes permit an ordinary Save: restoration must not rebase the buffer.
      await writeFile(join(dir, "isolated", "saved.txt"), "today saved text");
      await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
      await expect(page.locator(".content:visible > [role=status][tabindex]")).toContainText("Saved saved.txt");
      await expect(page.locator(".conflict")).toHaveCount(0);
      expect(await readFile(join(dir, "isolated", "saved.txt"), "utf8")).toBe("unsaved editor text");
      return;
    }
    if (mode === "files") {
      await writeFile(join(root, "saved.txt"), "today saved text");
      await page.getByRole("textbox", { name: "Message Codex" }).fill("retained draft");
      await page.getByText("Historical boundaries", { exact: true }).click();
      await page.getByRole("button", { name: "Load boundaries", exact: true }).click();
      await page.getByRole("button", { name: /^After turn/ }).first().click();
      await page.getByRole("button", { name: "Inspect saved files", exact: true }).click();
      const files = page.getByRole("region", { name: "Saved-file inspection", exact: true });
      await expect(files).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(files.getByRole("button", { name: "saved.txt", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("region", { name: "Historical file comparison", exact: true })).toBeFocused();
      await expect(files.getByText("base saved text", { exact: true })).toBeVisible();
      await expect(files.getByText("captured saved text", { exact: true })).toBeVisible();
      await expect(files.getByText("today saved text", { exact: true })).toHaveCount(0);
      await page.screenshot({ path: "test-results/saved-file-comparison.png" });
      await page.keyboard.press("Escape");
      await expect(page.getByText("Historical boundaries", { exact: true })).toBeFocused();
      await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("retained draft");
      return;
    }
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
      await page.getByRole("button", { name: "Inspect saved files", exact: true }).focus();
      await page.keyboard.press("Enter");
      const files = page.getByRole("region", { name: "Saved-file inspection", exact: true });
      await expect(files).toBeFocused();
      await expect(files.getByText(/No project file coverage/)).toBeVisible();
      await expect(composer).toHaveValue("retained unsent text");
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
      await inspection.getByRole("button", { name: "Rewind and restore saved files…" }).click();
      const restoration = page.getByRole("region", { name: "Conversation rewind", exact: true });
      await expect(restoration).toBeFocused();
      await expect(restoration).toContainText("No project");
      await expect(restoration).toContainText("conversation-only rewind");
      await expect(restoration.getByRole("button", { name: "Confirm restoration and retain unsaved edits" })).toHaveCount(0);
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
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.close(); await rm(dir, { recursive: true, force: true });
  }
});
