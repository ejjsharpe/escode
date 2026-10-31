import { writeApprovalFixture } from "./desktop";
import { readRecoveryFixture, writeRecoveryFixture } from "./desktop";
import { writeChatFixture } from "./desktop";
import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("Agents restores closed saved projects and shares conversations without moving editor context", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-agents-")));
  const a = join(dir, "alpha"),
    b = join(dir, "beta"),
    worktree = join(dir, "worktree"),
    user = join(dir, "user");
  for (const root of [a, b]) {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a.txt"), "baseline");
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-m",
      "initial",
    ]);
  }
  execFileSync("git", ["-C", a, "worktree", "add", "-b", "other", worktree]);
  await mkdir(user);
  const saved = [
    { project: a, root: a },
    { project: b, root: b },
  ];
  await writeApprovalFixture(user, saved);
  const records = [
    {
      id: "alpha-chat",
      project: a,
      checkout: worktree,
      threadId: "saved-alpha",
      draft: "alpha text",
    },
    { id: "beta-chat", project: b, checkout: b, threadId: "saved-beta", draft: "beta text" },
    { id: "forged-chat", project: "/unapproved", checkout: b, threadId: null, draft: "keep me" },
  ];
  await writeChatFixture(join(user, "host-chats-v1.json"), JSON.stringify({ version: 1, chats: records }));
  await writeRecoveryFixture(
    join(user, "client-workspace-v1.json"),
    JSON.stringify({
      projects: [saved[0]],
      savedProjects: [...saved, { project: "/unapproved", root: b }],
      selected: a,
      views: { [a]: { mode: "Files", checkout: a } },
      drafts: [],
    }),
  );
  await writeFile(
    join(dir, "codex"),
    `#!/usr/bin/env node
const {createInterface}=require('node:readline');const {appendFileSync}=require('node:fs');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0)}
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id||!m.method)return;
appendFileSync(${JSON.stringify(join(dir, "events"))},JSON.stringify({method:m.method,cwd:process.cwd()})+'\\n');
let result={};if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/resume')result={thread:{id:m.params.threadId},cwd:process.cwd(),model:'fixture',reasoningEffort:'high',approvalPolicy:'on-request',sandbox:{type:'workspaceWrite',writableRoots:[process.cwd()],networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false}};
if(m.method==='thread/turns/list')result={data:[{id:'past',items:[{id:'answer',type:'agentMessage',text:Array.from({length:150},(_,i)=>'Saved history line '+i).join(String.fromCharCode(10))}]}],nextCursor:null};
process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');});`,
    { mode: 0o700 },
  );
  let app = await launchDesktop(user, dir);
  try {
    await (await app.firstWindow()).evaluate(async records => {
      for (const record of records) await window.escode.chat("draft", record.project, record.id, record.draft);
    }, records);
    let page = await app.firstWindow();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("dirty alpha");
    await page.getByRole("button", { name: "Agents", exact: true }).focus();
    await page.keyboard.press("Enter");
    const rows = page.locator(".agent-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("unapproved");
    await rows.nth(0).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Open this project first" }),
    ).toContainText("Open this project first");
    const denied = await page.evaluate(async () => {
      try {
        await window.escode.chat("open", "/unapproved", "forged-chat");
        return false;
      } catch {
        return true;
      }
    });
    expect(denied).toBe(true);
    await expect(page.evaluate(() => window.escode.project("open-checkout", "/unapproved", "forged-chat"))).rejects.toThrow("approve");
    await rows.filter({ hasText: "alpha" }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("alpha text");
    await expect(page.locator(".transcript:visible")).toContainText("Saved history");
    await page.getByRole("textbox", { name: "Message Codex" }).fill("shared text");
    await page.getByText("Chat actions", { exact: true }).click();
    await page.getByRole("button", { name: "Archive chat", exact: true }).click();
    await expect(rows.filter({ hasText: "alpha" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("shared text");
    await expect(page.getByRole("status").filter({ hasText: "belongs to the Archived" })).toBeVisible();
    await page.getByRole("button", { name: "Show archived chats", exact: true }).click();
    await expect(rows.filter({ hasText: "alpha" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Show recent chats", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Show recent chats", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Restore chat", exact: true }).click();
    await page.getByRole("button", { name: "Show recent chats", exact: true }).click();
    await expect(page.getByRole("button", { name: "Show archived chats", exact: true })).toBeFocused();
    await expect(rows.filter({ hasText: "alpha" })).toHaveCount(1);

    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: "alpha", exact: true })
      .click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("dirty alpha");
    await expect(page.locator(".view-nav:visible")).toContainText(a);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Chat 1 ·/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await rows.filter({ hasText: "alpha" }).click();
    await page.getByRole("button", { name: "Open checkout", exact: true }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /^Chat 1 ·/ }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("shared text");
    await expect(page.locator(".view-nav:visible")).toContainText(worktree);
    await page.getByText("Chat actions", { exact: true }).click();
    await page.getByRole("button", { name: "Archive chat", exact: true }).click();
    await expect(page.locator(".chat-list:visible .agent-row")).toHaveCount(0);
    await page.getByRole("button", { name: "Show archived chats", exact: true }).click();
    await expect(page.locator(".chat-list:visible .agent-row")).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("shared text");
    await page.getByRole("button", { name: "Restore chat", exact: true }).click();
    await page.getByRole("button", { name: "Show recent chats", exact: true }).click();

    expect((await readFile(join(dir, "events"), "utf8")).match(/thread\/resume/g)).toHaveLength(1);
    const dragComposerHandle = async (distance: number) => {
      const textarea = page.getByRole("textbox", { name: "Message Codex" });
      await textarea.scrollIntoViewIfNeeded();
      const box = (await textarea.boundingBox())!;
      await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3 + distance, {
        steps: 12,
      });
      await page.mouse.up();
      return (await textarea.boundingBox())!.height;
    };
    // Prove the mouse gesture hits Chromium's native handle in the existing local view.
    const localHeight = (await page.getByRole("textbox", { name: "Message Codex" }).boundingBox())!
      .height;
    expect(await dragComposerHandle(120)).toBeGreaterThan(localHeight + 60);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await rows.filter({ hasText: "beta / beta" }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("beta text");
    await expect(
      page.getByRole("navigation", { name: "Projects" }).locator("button[aria-pressed]"),
    ).toHaveCount(3);
    await expect(page.locator(".transcript:visible")).toContainText("Saved history line 149");
    await page.setViewportSize({ width: 1100, height: 768 });
    const panelGeometry = () =>
      page.locator(".agents").evaluate((panel) => {
        const transcript = panel.querySelector(".transcript")!;
        const composer = panel.querySelector(".chat-compose")!.getBoundingClientRect();
        const heading = panel.querySelector(".conversation-heading")!.getBoundingClientRect();
        return {
          documentHeight: document.documentElement.scrollHeight,
          viewport: innerHeight,
          composerTop: composer.top,
          composerBottom: composer.bottom,
          headingTop: heading.top,
          transcriptHeight: transcript.clientHeight,
          historyHeight: transcript.scrollHeight,
        };
      });
    const beforeScroll = await panelGeometry();
    expect(beforeScroll.documentHeight).toBeLessThanOrEqual(beforeScroll.viewport);
    expect(beforeScroll.composerBottom).toBeLessThanOrEqual(beforeScroll.viewport);
    expect(beforeScroll.headingTop).toBeGreaterThanOrEqual(0);
    expect(beforeScroll.transcriptHeight).toBeGreaterThan(0);
    expect(beforeScroll.historyHeight).toBeGreaterThan(beforeScroll.transcriptHeight);
    await page.locator(".transcript:visible").evaluate((history) => {
      history.scrollTop = history.scrollHeight;
    });
    expect(
      await page.locator(".transcript:visible").evaluate((history) => history.scrollTop),
    ).toBeGreaterThan(0);
    expect(await panelGeometry()).toEqual(beforeScroll);
    await page.screenshot({ path: "test-results/agents-long-history.png" });
    await page.screenshot({ path: "test-results/agents.png" });
    for (const width of [728, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeVisible();
      const geometry = await panelGeometry();
      expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.viewport);
      await page.screenshot({ path: `test-results/agents-${width}.png` });
    }
    for (const width of [1100, 1024, 728]) {
      await page.setViewportSize({ width, height: 768 });
      const history = page.locator(".transcript:visible");
      await history.evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.getByText("Effective Codex settings · fixture", { exact: true }).click();
      await expect(history.locator("details").filter({ hasText: "Effective Codex settings" })).toHaveAttribute("open", "");
      await expect(history.locator("details pre")).toContainText("workspaceWrite");
      const expanded = await panelGeometry();
      expect(expanded.documentHeight).toBeLessThanOrEqual(expanded.viewport);
      expect(expanded.composerTop).toBeGreaterThanOrEqual(0);
      expect(expanded.composerBottom).toBeLessThanOrEqual(expanded.viewport);
      expect(expanded.transcriptHeight).toBeGreaterThanOrEqual(80);
      await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeInViewport({
        ratio: 1,
      });
      await page.screenshot({ path: `test-results/agents-settings-${width}.png` });
      const lastLineVisible = await history.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        const text = element.querySelector("article pre")!.firstChild!;
        const range = document.createRange();
        range.setStart(text, text.textContent!.indexOf("Saved history line 149"));
        range.setEnd(text, text.textContent!.length);
        const line = range.getBoundingClientRect(),
          viewport = element.getBoundingClientRect();
        return line.top >= viewport.top && line.bottom <= viewport.bottom;
      });
      expect(lastLineVisible).toBe(true);
      expect(await panelGeometry()).toEqual(expanded);
      await history.evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.getByText("Effective Codex settings · fixture", { exact: true }).click();
    }
    const longPrompt = Array.from(
      { length: 400 },
      (_, i) => `Prompt line ${i}: keep all this text`,
    ).join("\n");
    const message = page.getByRole("textbox", { name: "Message Codex" });
    await message.fill(longPrompt);
    for (const width of [1100, 1024, 728]) {
      await page.setViewportSize({ width, height: 768 });
      const originalHeight = (await message.boundingBox())!.height;
      for (let attempt = 0; attempt < 3; attempt++)
        expect(await dragComposerHandle(180)).toBe(originalHeight);
      const geometry = await panelGeometry();
      expect(geometry.transcriptHeight).toBeGreaterThanOrEqual(80);
      expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.viewport);
      await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeInViewport({
        ratio: 1,
      });
      expect(await message.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true,
      );
      await expect(message).toHaveValue(longPrompt);
    }
    // Below the validated window height, panel scrolling must still reach every control.
    await page.setViewportSize({ width: 728, height: 600 });
    expect((await panelGeometry()).transcriptHeight).toBeGreaterThanOrEqual(80);
    await page.getByRole("button", { name: "Send message", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await page.locator(".transcript:visible").scrollIntoViewIfNeeded();
    await expect(page.locator(".transcript:visible")).toBeInViewport();
    await page.setViewportSize({ width: 1100, height: 768 });
    await expect(rows.nth(0)).toContainText("unapproved");
    await expect(rows.nth(1)).toContainText("beta");
    await expect(rows.nth(2)).toContainText("alpha");
    await page.getByRole("textbox", { name: "Message Codex" }).fill("beta retained");
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: /^alpha ·/ }).first()
      .click();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await expect
      .poll(async () => {
        const state = JSON.parse(await readRecoveryFixture(join(user, "client-workspace-v1.json"), "utf8"));
        return [state.selected, state.agentsChat];
      })
      .toEqual(["agents", "beta-chat"]);
    await page.evaluate(
      async ({ a, b }) => {
        await window.escode.chat("disconnect", a, "alpha-chat");
        await window.escode.chat("disconnect", b, "beta-chat");
      },
      { a, b },
    );
    const exited = new Promise<void>((resolve) => app.process().once("exit", () => resolve()));
    app.process().kill("SIGKILL");
    await exited;
    // Explicit recovery after this test has confirmed the crashed writer exited.
    await rm(join(user, "durable-chats-v1.sqlite-state-v1/receipts/owner.lock"), { force: true });
    app = await launchDesktop(user, dir);
    page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("beta retained");
    await expect(page.getByRole("status")).toHaveText("Ready");
    expect(await readFile(join(dir, "events"), "utf8")).not.toContain("turn/start");
    const state = JSON.parse(await readRecoveryFixture(join(user, "client-workspace-v1.json"), "utf8"));
    expect(state.projects).toEqual([{ project: a, root: a }, { project: a, root: worktree }]);
    expect(state.drafts[0].text).toBe("dirty alpha");
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      })
      .catch(() => {});
    await app.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test("Agents keeps an unavailable remembered selection and validates catalogue arguments", async () => {
  const user = await mkdtemp(join(tmpdir(), "escode-agents-empty-"));
  await writeRecoveryFixture(
    join(user, "client-workspace-v1.json"),
    JSON.stringify({
      projects: [],
      selected: "agents",
      agentsChat: "missing-chat",
      views: {},
      drafts: [],
    }),
  );
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByText("Saved conversation missing-chat is unavailable. Its selection is retained."),
    ).toBeVisible();
    await expect(
      page.getByText("No saved chats. Start without a project or open a project."),
    ).toBeVisible();
    expect(JSON.parse(await readRecoveryFixture(join(user, "client-workspace-v1.json"), "utf8")).agentsChat).toBe("missing-chat");
    const newChat = page.getByRole("button", { name: "New chat", exact: true });
    await newChat.click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeFocused();
    await expect(page.getByRole("combobox", { name: "Project context", exact: true })).toHaveValue("");
    await expect(page.locator(".agent-row")).toHaveCount(1);
    expect(
      await page.evaluate(async () => {
        try {
          await (window.escode.chat as any)("catalogue", {});
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);

  } finally {
    await app.close();
    await rm(user, { recursive: true, force: true });
  }
});

test("Agents and local Chats promote user messages and preserve labels through selection and activity", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-chat-order-")));
  const root = join(dir, "repo"),
    user = join(dir, "user");
  execFileSync("git", ["init", root]);
  await mkdir(user);
  const saved = [{ project: root, root }];
  await writeApprovalFixture(user, saved);
  await writeRecoveryFixture(
    join(user, "client-workspace-v1.json"),
    JSON.stringify({
      projects: saved,
      selected: root,
      views: { [root]: { mode: "Chats" } },
      drafts: [],
    }),
  );
  const records = [
    {
      id: "legacy",
      project: root,
      checkout: root,
      threadId: "thread-legacy",
      draft: "legacy prompt",
    },
    {
      id: "older",
      project: root,
      checkout: root,
      threadId: "thread-older",
      draft: "older prompt",
      createdAt: 100,
    },
    {
      id: "newer",
      project: root,
      checkout: root,
      threadId: "thread-newer",
      draft: "newer prompt",
      createdAt: 200,
    },
  ];
  await writeChatFixture(join(user, "host-chats-v1.json"), JSON.stringify({ version: 1, chats: records }));
  await writeFile(
    join(dir, "codex"),
    `#!/usr/bin/env node
const {createInterface}=require('node:readline');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0)}
const send=m=>process.stdout.write(JSON.stringify(m)+String.fromCharCode(10));
let threadId;
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id||!m.method)return;
let result={};if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/resume'){threadId=m.params.threadId;result={thread:{id:threadId},cwd:process.cwd(),model:'fixture',approvalPolicy:'on-request',sandbox:{type:'readOnly'}};}
if(m.method==='thread/resume' && threadId==='thread-newer'){send({id:m.id,error:{code:-32000,message:Array.from({length:200},(_,i)=>'Fixture error line '+i).join(String.fromCharCode(10))}});return;}
if(m.method==='thread/turns/list')result={data:[],nextCursor:null};
if(m.method==='turn/start'){
result={turn:{id:'turn'}};send({method:'turn/started',params:{threadId,turn:{id:'turn'}}});
send({id:99,method:'item/commandExecution/requestApproval',params:{threadId,turnId:'turn',itemId:'cmd',command:'fixture'}});
send({id:100,method:'mcpServer/elicitation/request',params:{threadId,turnId:'turn',serverName:'fixture',mode:'form',message:'Provide requested information',requestedSchema:{type:'object',properties:Object.fromEntries(Array.from({length:100},(_,i)=>['field'+i,{type:'string'}]))}}});
}
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId,turn:{id:'turn'}}});
send({id:m.id,result});});`,
    { mode: 0o700 },
  );
  const app = await launchDesktop(user, dir);
  try {
    await (await app.firstWindow()).evaluate(async records => {
      for (const record of records) await window.escode.chat("draft", record.project, record.id, record.draft);
    }, records);
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: "repo", exact: true }).click();
    const localRows = page.locator(".chat-list:visible li button");
    const globalRows = page.locator(".agent-row strong");
    const labels = ["Chat 3", "Chat 2", "Chat 1"];
    await expect(localRows.locator("strong")).toHaveText(labels);
    await localRows.nth(1).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("older prompt");
    await expect(localRows.locator("strong")).toHaveText(labels);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(localRows.locator("strong")).toHaveText(["older prompt", "Chat 3", "Chat 1"]);
    await expect(localRows.first()).toHaveAttribute("aria-label", /Needs input/);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await expect(globalRows).toHaveText(["older prompt", "Chat 3", "Chat 1"]);
    await page.locator(".agent-row").filter({ hasText: "older prompt" }).click();
    await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
    await expect(page.locator(".agent-row").first()).toHaveAttribute("aria-label", /Needs input/);
    await expect(globalRows).toHaveText(["older prompt", "Chat 3", "Chat 1"]);
    await page.setViewportSize({ width: 1100, height: 768 });
    await page.getByText("Requested information format", { exact: true }).click();
    const mcpResponse = page.getByRole("textbox", { name: "MCP response" });
    await mcpResponse.scrollIntoViewIfNeeded();
    await expect(mcpResponse).toBeInViewport();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeInViewport({ ratio: 1 });
    const largeRequest = await page.locator(".transcript:visible").evaluate((history) => ({
      pageHeight: document.documentElement.scrollHeight,
      viewport: innerHeight,
      historyHeight: history.clientHeight,
      contentHeight: history.scrollHeight,
    }));
    expect(largeRequest.pageHeight).toBeLessThanOrEqual(largeRequest.viewport);
    expect(largeRequest.historyHeight).toBeGreaterThanOrEqual(80);
    expect(largeRequest.contentHeight).toBeGreaterThan(largeRequest.historyHeight);
    for (const height of [768, 600]) {
      await page.setViewportSize({ width: 728, height });
      await mcpResponse.scrollIntoViewIfNeeded();
      await expect(mcpResponse).toBeInViewport();
      expect(
        await page.locator(".transcript:visible").evaluate((history) => history.clientHeight),
      ).toBeGreaterThanOrEqual(80);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeInViewport({
        ratio: 1,
      });
    }
    await page.setViewportSize({ width: 1100, height: 768 });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Ready");
    await page.locator(".agent-row").filter({ hasText: "Chat 3" }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("newer prompt");
    await expect(page.locator(".agents [role=alert]").first()).toContainText("Fixture error line 199");
    await page.setViewportSize({ width: 728, height: 600 });
    await page.locator(".agents [role=alert]").first().scrollIntoViewIfNeeded();
    await expect(page.locator(".agents [role=alert]").first()).toBeInViewport();
    await page.getByRole("button", { name: "Send message", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeInViewport({
      ratio: 1,
    });
    expect(
      await page.locator(".transcript:visible").evaluate((history) => history.clientHeight),
    ).toBeGreaterThanOrEqual(80);
    await page.screenshot({ path: "test-results/agents-short-window-error.png" });
    await expect(globalRows).toHaveText(["older prompt", "Chat 3", "Chat 1"]);
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: "repo", exact: true })
      .click();
    await expect(localRows.locator("strong")).toHaveText(["older prompt", "Chat 3", "Chat 1"]);
    await expect(localRows.first()).toHaveAttribute("aria-pressed", "true");
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Agents composition retains deliberate editor project recency and checkout defaults across restart", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-create-order-")));
  const user = join(dir, "user");
  const roots = ["Alpha", "Beta", "Gamma", "nested/Alpha"].map((name) => join(dir, name));
  for (const root of roots) execFileSync("git", ["init", root]);
  execFileSync("git", ["-C", roots[3], "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"]);
  const linked = join(dir, "linked");
  execFileSync("git", ["-C", roots[3], "worktree", "add", "-b", "alternate", linked]);
  await mkdir(user);
  const saved = roots.map((root) => ({ project: root, root }));
  await writeApprovalFixture(user, saved);
  await writeRecoveryFixture(
    join(user, "client-workspace-v1.json"),
    JSON.stringify({
      projects: [],
      savedProjects: saved,
      selected: "agents",
      views: {},
      drafts: [],
    }),
  );
  await writeChatFixture(
    join(user, "host-chats-v1.json"),
    JSON.stringify({ version: 1, chats:
      roots
        .slice(0, 3)
        .map((project, index) => ({
          id: `draft-${index}`,
          project,
          checkout: project,
          threadId: null,
          phase: "draft",
          draft: "saved prompt",
          createdAt: index + 1,
        })),
    }),
  );
  let app = await launchDesktop(user);
  try {
    let page = await app.firstWindow();
    const rows = page.locator(".agent-row .chat-row-context");
    await expect(rows).toHaveText(["Gamma / Gamma", "Beta / Beta", "Alpha / Alpha"]);
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Choose project" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeFocused();
    await expect(page.getByRole("combobox", { name: "Project context", exact: true })).toHaveValue(roots[0]);
    await page.screenshot({ path: "test-results/composer-first-default.png" });
    await page.getByRole("combobox", { name: "Project context", exact: true }).selectOption(roots[3]);
    const composer = page.getByRole("textbox", { name: "Message Codex" });
    await composer.fill("captured original prompt");
    await app.evaluate(({ dialog }, root) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, linked);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.locator(".view-nav:visible")).toContainText(linked);
    // A file activated from Agents becomes the project's next draft default.
    await writeFile(join(linked, "lookup.txt"), "linked lookup target");
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, roots[3]);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.locator("header")).toContainText(roots[3]);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.keyboard.press("Meta+p");
    await page.getByLabel("Exact file path").fill(join(linked, "lookup.txt"));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Find file", exact: true })).toHaveCount(0);
    await expect(page.locator("header")).toContainText(linked);
    await expect(page.locator(".monaco-editor:visible")).toContainText("linked lookup target");
    await page.locator('.project-tab[data-active="true"] .project-tab-close').click();
    await expect(page.locator(".project-tab")).toHaveCount(1);
    await page.locator(".project-tab-close").click();
    await expect(page.getByRole("navigation", { name: "Projects" }).locator(".project-tab")).toHaveCount(0);
    await expect(composer).toHaveValue("captured original prompt");
    await expect(page.locator(".chat-conversation")).toContainText(roots[3]);
    await expect(page.locator(".chat-conversation .directory")).toHaveText(`Checkout: ${roots[3]}`);
    await page.getByRole("button", { name: "New chat", exact: true }).click();

    await expect(rows).toHaveCount(5);
    await expect(page.locator(".chat-conversation .directory")).toHaveText(`Checkout: ${linked}`);
    await composer.fill("captured alternate prompt");
    // Use another project deliberately, without opening an editor or changing checkout defaults.
    await page.locator(".agent-row").filter({ hasText: "Gamma" }).click();
    await app.close();
    await rm(linked, { recursive: true, force: true });
    app = await launchDesktop(user);
    page = await app.firstWindow();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page.locator(".chat-conversation")).toContainText(linked);
    await expect(page.getByRole("alert").filter({ hasText: "Checkout unavailable" }).first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Projects" }).locator(".project-tab")).toHaveCount(0);
    await page.getByRole("textbox", { name: "Message Codex" }).fill("unavailable prompt retained");
    await page.locator(".agent-row").filter({ hasText: "Alpha" }).nth(2).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("captured original prompt");
    await expect(page.locator(".chat-conversation")).toContainText(roots[3]);
    await page.locator(".agent-row").filter({ hasText: "Alpha" }).nth(1).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("captured alternate prompt");
    await expect(page.locator(".chat-conversation")).toContainText(linked);

  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options?: any) => ({
        response: options.buttons[0] === "Save" ? 1 : 0, checkboxChecked: false,
      });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
