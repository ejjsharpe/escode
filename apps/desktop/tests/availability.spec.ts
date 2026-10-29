import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rename, rm, realpath, mkdir, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { launchDesktop } from "./desktop";

test("approved projects reopen across repeated restarts without choosing directories again", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-reopen-")));
  const roots = [join(dir, "alpha"), join(dir, "beta")];
  const user = join(dir, "user");
  for (const root of roots) {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a.txt"), root);
  }
  let app = await launchDesktop(user);
  try {
    let page = await app.firstWindow();
    for (const root of roots) {
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await expect(page.locator("header")).toContainText(root);
      await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
      await expect(page.locator(".monaco-editor:visible")).toContainText(root);
    }
    for (let restart = 0; restart < 2; restart++) {
      await app.close();
      app = await launchDesktop(user);
      page = await app.firstWindow();
      const loaded = await page.evaluate(() => window.escode.lifecycle("load"));
      expect(loaded.errors).toEqual([]);
      expect(loaded.restored.map((p) => p.root)).toEqual(roots);
      expect(loaded.restored.some((p) => p.approvalRequired)).toBe(false);
      await expect(page.locator("header")).toContainText(roots[1]);
      for (const root of roots) {
        await page
          .getByRole("navigation", { name: "Projects" })
          .getByRole("button", { name: root.split("/").pop()!, exact: true })
          .click();
        await expect(page.locator(".monaco-editor:visible")).toContainText(root);
      }
      await expect(page.getByRole("alert").filter({ hasText: "approve" })).toHaveCount(0);
    }
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderer state cannot grant file access or overwrite approvals; native reopening restores legacy drafts", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-approval-boundary-")));
  const root = join(dir, "repo"),
    outside = join(dir, "outside"),
    bin = join(dir, "bin");
  const user = join(root, "app-state");
  await mkdir(bin);
  await mkdir(outside);
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "original");
  await writeFile(join(outside, "private.txt"), "outside");
  const git = '#!/bin/sh\nexec /usr/bin/git "$@"\n';
  await writeFile(join(bin, "git"), git, { mode: 0o700 });
  let app = await launchDesktop(user, bin);
  try {
    let page = await app.firstWindow();
    const open = async () => {
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
    };
    await open();
    await expect(page.getByRole("treeitem", { name: "a.txt", exact: true })).toBeVisible();
    const original = await page.evaluate(async (root) => {
      const { state } = await window.escode.lifecycle("load");
      state.views[root] = { mode: "Files", checkout: root, roots: [root], path: "a.txt" };
      state.drafts = [
        {
          root,
          path: "a.txt",
          text: "legacy recovered edits",
          disk: await window.escode.project("read", root, "a.txt"),
        },
      ];
      return state;
    }, root);
    await writeFile(join(bin, "git"), "#!/bin/sh\nexit 127\n", { mode: 0o700 });
    const denied = await page.evaluate(
      async ({ root, outside }) => {
        const { state } = await window.escode.lifecycle("load");
        state.projects.push({ project: outside, root: outside });
        await window.escode.lifecycle("persist", state);
        const loaded = await window.escode.lifecycle("load");
        const attempt = async (operation: () => Promise<unknown>) =>
          operation().then(
            () => false,
            () => true,
          );
        return {
          required: loaded.restored.find((p) => p.root === outside)?.approvalRequired,
          outside: await attempt(() => window.escode.project("read", outside, "private.txt")),
          state: await attempt(() =>
            window.escode.project("read", root, "app-state/workspace.json"),
          ),
          alias: await attempt(() =>
            window.escode.project("read", root, "APP-STATE/APPROVED-PROJECTS.JSON"),
          ),
        };
      },
      { root, outside },
    );
    expect(denied).toEqual({ required: true, outside: true, state: true, alias: true });
    const file = join(user, "approved-projects.json"),
      bytes = await readFile(file);
    await link(file, join(root, "approval-alias.json"));
    expect(
      await page.evaluate(
        async (root) =>
          window.escode.project("read", root, "approval-alias.json").then(
            () => false,
            () => true,
          ),
        root,
      ),
    ).toBe(true);
    const blocked = await page.evaluate(
      async ({ root, version }) => {
        try {
          await window.escode.project(
            "save",
            root,
            "APP-STATE/APPROVED-PROJECTS.JSON",
            "[]",
            version,
          );
          return false;
        } catch {
          return true;
        }
      },
      { root, version: createHash("sha256").update(bytes).digest("hex") },
    );
    expect(blocked).toBe(true);
    expect(await readFile(file)).toEqual(bytes);
    expect(await readFile(join(outside, "private.txt"), "utf8")).toBe("outside");
    await page.evaluate((state) => window.escode.lifecycle("persist", state), original);
    await app.close();
    await rm(file);
    app = await launchDesktop(user, bin);
    page = await app.firstWindow();
    await expect(
      page.getByRole("alert").filter({ hasText: "Use Open project to approve" }),
    ).toBeVisible();
    await expect(page.locator(".monaco-editor:visible")).toContainText("legacy recovered edits");
    expect(await page.evaluate((root) => window.escode.lifecycle("prepare", root), root)).toBe(
      true,
    );
    await writeFile(join(bin, "git"), git, { mode: 0o700 });
    await open();
    await expect(
      page.getByRole("alert").filter({ hasText: "Use Open project to approve" }),
    ).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: "a.txt, unsaved", exact: true })).toBeVisible();
    await expect(page.locator(".monaco-editor:visible")).toContainText("legacy recovered edits");
    await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved a.txt" })).toBeVisible();
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("legacy recovered edits");
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options?: any) => ({
        response: options.buttons[0] === "Save" ? 1 : 0,
        checkboxChecked: false,
      });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("unavailable checkout retains its tab, recovery edits and chat draft through restart and explicit retry", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-unavailable-")));
  const root = join(dir, "repo"),
    other = join(dir, "other"),
    user = join(dir, "user");
  for (const path of [root, other]) execFileSync("git", ["init", path]);
  await writeFile(join(root, "a.txt"), "original");
  await writeFile(join(other, "b.txt"), "other project");
  let app = await launchDesktop(user);
  const cleanup = async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options?: any) => ({
        response: options.buttons[0] === "Save" ? 1 : 0,
        checkboxChecked: false,
      });
    });
    await app.close();
  };
  try {
    let page = await app.firstWindow();
    const open = async (path: string) => {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      }, path);
      await page.getByRole("button", { name: "Open project…" }).click();
      await expect(page.locator("header")).toContainText(path);
    };
    await open(root);
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("recovery edits");
    const chat = await page.evaluate(async (root) => {
      const chat = await window.escode.chat("create", root, root);
      await window.escode.chat("draft", root, chat.id, "retained chat draft");
      return chat;
    }, root);
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts[0]?.text,
      )
      .toBe("recovery edits");
    await open(other);
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: "repo", exact: true })
      .click();
    await expect
      .poll(async () => JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).selected)
      .toBe(root);
    // A stale on-disk snapshot can precede queued selection writes; crash only after acknowledgement.
    await expect(page.locator("header")).toContainText(root);
    await expect.poll(async () => (await page.evaluate(() => window.escode.lifecycle("load"))).state.selected).toBe(root);
    const acknowledged = await page.evaluate(() => window.escode.lifecycle("load"));
    await page.evaluate((state) => window.escode.lifecycle("persist", state), acknowledged.state);
    await rename(root, root + "-away");
    const exited = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exited;
    app = await launchDesktop(user);
    page = await app.firstWindow();
    await expect(
      page
        .getByRole("navigation", { name: "Projects" })
        .getByRole("button", { name: "repo", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".monaco-editor:visible")).toContainText("recovery edits");
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "Chat 1", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue(
      "retained chat draft",
    );
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
    await expect(page.getByRole("alert").filter({ hasText: "Checkout unavailable" })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: "other", exact: true })
      .click();
    await page.getByRole("treeitem", { name: "b.txt", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("other project");
    await rename(root + "-away", root);
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: "repo", exact: true })
      .click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("button", { name: "Retry checkout", exact: true }).click();
    await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
    await expect.poll(() => readFile(join(root, "a.txt"), "utf8")).toBe("recovery edits");
    await expect(page.getByRole("status").filter({ hasText: "Saved a.txt" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save ⌘S", exact: true })).toBeEnabled();
    expect(
      (await page.evaluate((root) => window.escode.chat("list", root), root))[0],
    ).toMatchObject({ id: chat.id, checkout: root, draft: "retained chat draft", hasSent: false });
  } finally {
    await cleanup();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a saved secondary checkout can recover and save its buffer after restarting without Git", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-secondary-git-loss-")));
  const root = join(dir, "repo"),
    secondary = join(dir, "secondary"),
    bin = join(dir, "bin"),
    user = join(dir, "user");
  await mkdir(bin);
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "original");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "initial",
  ]);
  execFileSync("git", ["-C", root, "worktree", "add", "-b", "secondary", secondary]);
  await writeFile(join(bin, "git"), '#!/bin/sh\nexec /usr/bin/git "$@"\n', { mode: 0o700 });
  let app = await launchDesktop(user, bin);
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("treeitem", { name: "a.txt", exact: true })).toBeVisible();
    // Seed an acknowledged recovery draft through the public persistence contract.
    await page.evaluate(
      async ({ root, secondary }) => {
        const chat = await window.escode.chat("create", root, secondary);
        await window.escode.chat("draft", root, chat.id, "secondary chat draft");
        const disk = await window.escode.project("read", secondary, "a.txt");
        const { state } = await window.escode.lifecycle("load");
        state.views[root] = { mode: "Files", checkout: secondary, roots: [root, secondary] };
        state.views[secondary] = { path: "a.txt" };
        state.drafts = [
          { root: secondary, path: "a.txt", text: "secondary recovered edits", disk },
        ];
        await window.escode.lifecycle("persist", state);
      },
      { root, secondary },
    );
    await app.close();
    await writeFile(join(bin, "git"), "#!/bin/sh\nexit 127\n", { mode: 0o700 });
    app = await launchDesktop(user, bin);
    page = await app.firstWindow();
    await expect(page.locator(".view-nav:visible")).toContainText(secondary);
    await expect(page.locator(".monaco-editor:visible")).toContainText("secondary recovered edits");
    await expect(page.getByRole("treeitem", { name: "a.txt, unsaved", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved a.txt" })).toBeVisible();
    expect(await readFile(join(secondary, "a.txt"), "utf8")).toBe("secondary recovered edits");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("original");
    expect(
      (await page.evaluate((root) => window.escode.chat("list", root), root))[0],
    ).toMatchObject({ checkout: secondary, draft: "secondary chat draft" });
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options?: any) => ({
        response: options.buttons[0] === "Save" ? 1 : 0,
        checkboxChecked: false,
      });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Git, Codex and authentication failures preserve usable capabilities and retry never resends", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-tool-loss-")));
  const root = join(dir, "repo"),
    bin = join(dir, "bin"),
    user = join(dir, "user");
  await mkdir(bin);
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "original");
  const state = join(dir, "state.json"),
    wire = join(dir, "wire.jsonl");
  const setState = (value: object) => writeFile(state, JSON.stringify(value));
  await setState({ auth: true });
  const git = '#!/bin/sh\nexec /usr/bin/git "$@"\n';
  await writeFile(join(bin, "git"), git, { mode: 0o700 });
  await writeFile(
    join(bin, "codex"),
    `#!/usr/bin/env node
import {readFileSync,appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
const state=()=>JSON.parse(readFileSync(${JSON.stringify(state)},'utf8'));
if(process.argv.includes('--version')) { if(state().missing)process.exit(1);console.log('codex-cli 0.165.0');process.exit(0); }
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const threadId='thread',turnId='turn';
const items=[{id:'user',type:'userMessage',content:[{type:'text',text:'explicit message'}]},{id:'reply',type:'agentMessage',text:'retained history'}];
createInterface({input:process.stdin}).on('line', line=>{
 const m=JSON.parse(line); if(!m.id)return;
 appendFileSync(${JSON.stringify(wire)},JSON.stringify(m)+'\\n');
 let result={};
 if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
 if(m.method==='account/read')result={account:state().auth?{}:null};
 if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:threadId},cwd:process.cwd(),model:'fixture-actual',reasoningEffort:'high',approvalPolicy:'on-request',sandbox:{type:'readOnly'}};
 if(m.method==='thread/turns/list')result={data:[{id:turnId,items}],nextCursor:null};
 if(m.method==='turn/start'){
  result={turn:{id:turnId}};
  setTimeout(()=>{send({method:'turn/started',params:{threadId,turn:{id:turnId}}});for(const item of items)send({method:'item/completed',params:{threadId,turnId,item}});send({method:'turn/completed',params:{threadId,turn:{id:turnId}}});},20);
 }
 send({id:m.id,result});
});
`,
    { mode: 0o700 },
  );
  let app = await launchDesktop(user, bin);
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "New chat on current checkout" }).click();
    let status = page.locator(".chat-actions [role=status]");
    await expect(status).toHaveText("Draft");
    await page.getByLabel("Message Codex").fill("explicit message");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByLabel("Conversation history")).toContainText("retained history");
    await expect(status).toHaveText("Ready");
    await page.getByLabel("Message Codex").fill("keep this unsent");
    await setState({ auth: true, missing: true });
    let retry = page.getByRole("button", { name: "Retry connection / reload history" });
    await retry.click();
    await expect(page.getByRole("alert")).toContainText("version unavailable");
    await expect(page.getByLabel("Conversation history")).toContainText("retained history");
    await expect(page.getByLabel("Message Codex")).toHaveValue("keep this unsent");
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
    await setState({ auth: false });
    await retry.click();
    await expect(page.getByRole("alert")).toContainText("codex login");
    await expect(page.getByLabel("Conversation history")).toContainText("retained history");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await writeFile(join(bin, "git"), "#!/bin/sh\nexit 127\n", { mode: 0o700 });
    await expect(page.getByRole("button", { name: "Retry Git", exact: true })).toBeVisible({
      timeout: 8000,
    });
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("saved while tools are unavailable");
    await page.keyboard.press("Meta+s");
    await expect(page.getByRole("status").filter({ hasText: "Saved a.txt" })).toBeVisible();
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("saved while tools are unavailable");
    await app.close();
    app = await launchDesktop(user, bin);
    page = await app.firstWindow();
    status = page.locator(".chat-actions [role=status]");
    retry = page.getByRole("button", { name: "Retry connection / reload history" });
    await expect(page.getByRole("treeitem", { name: "a.txt", exact: true })).toBeVisible();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("saved after restarting without Git");
    await page.keyboard.press("Meta+s");
    await expect(page.getByRole("status").filter({ hasText: "Saved a.txt" })).toBeVisible();
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("saved after restarting without Git");
    await setState({ auth: true });
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await retry.click();
    await expect(status).toHaveText("Ready");
    await expect(page.getByLabel("Message Codex")).toHaveValue("keep this unsent");
    await expect(
      page.getByLabel("Conversation history").getByRole("heading", { name: "You", exact: true }),
    ).toHaveCount(1);
    const calls = (await readFile(wire, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.filter((m) => m.method === "turn/start")).toHaveLength(1);
    expect(calls.find((m) => m.method === "thread/start").params).toEqual({ cwd: root });
    expect(calls.find((m) => m.method === "thread/resume").params).toEqual({
      cwd: root,
      threadId: "thread",
      excludeTurns: true,
    });
    await writeFile(join(bin, "git"), git, { mode: 0o700 });
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.getByRole("button", { name: "Retry Git", exact: true }).click();
    await expect(page.getByRole("button", { name: "a.txt", exact: true })).toBeVisible();
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options?: any) => ({
        response: options.buttons[0] === "Save" ? 1 : 0,
        checkboxChecked: false,
      });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
