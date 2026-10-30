import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop, readChats } from "./desktop";

test("crash recovery preserves baseline; cancel and failed save retain edits; discard survives restart", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-lifecycle-")));
  const root = join(dir, "repo"),
    user = join(dir, "user");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "original");
  const other = join(dir, "other");
  execFileSync("git", ["init", other]);
  await writeFile(join(other, "b.txt"), "secondary project");
  const launch = () => launchDesktop(user);
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    const recoveryStarted = Date.now();
    await page.keyboard.type("recover these edits");
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts[0]?.text,
      )
      .toBe("recover these edits");
    const durable = JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8"));
    await page.evaluate((state) => window.escode.lifecycle("persist", state), durable);
    console.log(
      `Recovery draft acknowledged ${Date.now() - recoveryStarted} ms after typing began; crash recovery below starts from this durable draft.`,
    );
    await app.evaluate(({ dialog }, other) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [other] });
    }, other);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "b.txt", exact: true }).click();
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.getByRole("button", { name: "b.txt", exact: true }).click();
    await expect(page.locator(".monaco-diff-editor:visible")).toContainText("secondary project");
    const tabs = page
      .getByRole("navigation", { name: "Projects", exact: true })
      .locator("button[aria-pressed]");
    await expect(tabs).toHaveText(["Agents", "repo", "other"]);
    await page
      .getByRole("navigation", { name: "Projects", exact: true })
      .getByRole("button", { name: "repo", exact: true })
      .click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("recover these edits");
    await expect
      .poll(async () => JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")))
      .toMatchObject({ selected: root, projects: [{ root }, { root: other }] });
    const exited = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exited;
    await writeFile(join(root, "a.txt"), "external");
    // The crashed owner is known dead; explicitly release its fail-closed storage lock.
    await rm(join(user, "foundation", "owner.lock"));
    app = await launch();
    page = await app.firstWindow();
    await expect(
      page.getByRole("navigation", { name: "Projects", exact: true }).locator("button[aria-pressed]"),
    ).toHaveText(["Agents", "repo", "other"]);
    await expect(page.locator("header")).toContainText(root);
    await expect(page.locator(".monaco-editor:visible")).toContainText("recover these edits");
    await page.getByRole("button", { name: "Save ⌘S" }).click();
    await expect(page.locator(".conflict")).toBeVisible();
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("external");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
    });
    await page.locator('.project-tab[data-active="true"] .project-tab-close').click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("recover these edits");
    // Save failure during close must leave the project usable and draft retained.
    await rm(join(root, "a.txt"));
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Close file", exact: true }).click();
    await expect(page.locator(".content:visible > [role=status]")).toContainText("ENOENT");
    await expect(page.locator(".monaco-editor:visible")).toContainText("recover these edits");
    await writeFile(join(root, "a.txt"), "external");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Close file", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toHaveCount(0);
    await expect
      .poll(
        async () => JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts.length,
      )
      .toBe(0);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole("treeitem", { name: "a.txt", exact: true })).toBeVisible();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("external");
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
    await expect(page.locator(".monaco-diff-editor:visible")).toContainText("external");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "Source Control", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".monaco-diff-editor:visible")).toContainText("external");
    await expect(
      page.getByRole("navigation", { name: "Projects", exact: true }).locator("button[aria-pressed]"),
    ).toHaveText(["Agents", "repo", "other"]);
    await page
      .getByRole("navigation", { name: "Projects", exact: true })
      .getByRole("button", { name: "other", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Source Control", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".monaco-diff-editor:visible")).toContainText("secondary project");
  } finally {
    app.process().kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});

for (const closeProject of [false, true]) {
  test(`active work: ${closeProject ? "editor close retains live work, and quit stops closed-project processes" : "quit interrupts processes without replay on restart"}`, async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-quit-")));
    const root = join(dir, "repo"),
      user = join(dir, "user");
    execFileSync("git", ["init", root]);
    if (closeProject) {
      await writeFile(join(root, "a.txt"), "committed");
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
    }
    await writeFile(
      join(dir, "codex"),
      `#!/usr/bin/env node
const {createInterface}=require('node:readline');
const {spawn}=require('node:child_process');
const {writeFileSync,appendFileSync}=require('node:fs');
if(process.argv.includes('--version')) { console.log('codex-cli 0.165.0'); process.exit(); }
const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
writeFileSync('pids',JSON.stringify([process.pid,child.pid]));
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(!m.id || !m.method)return;
 let result={};
 if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
 if(m.method==='account/read')result={account:{}};
 if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:'thread'},cwd:process.cwd(),model:'fixture',sandbox:{type:'readOnly'},approvalPolicy:'on-request'};
 if(m.method==='thread/turns/list')result={data:[],nextCursor:null};
 if(m.method==='turn/start') { appendFileSync('turns','sent\\n'); result={turn:{id:'turn'}}; }
 if(m.method==='turn/interrupt')appendFileSync('interrupts','stopped\\n');
 send({id:m.id,result});
});
`,
      { mode: 0o700 },
    );
    const launch = () => launchDesktop(user, dir);
    let app = await launch();
    try {
      let page = await app.firstWindow();
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      if (closeProject) {
        await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
        await expect(page.locator(".monaco-editor:visible")).toHaveAttribute("data-uri", /a\.txt$/);
        await page.locator(".monaco-editor:visible").click();
        await page.keyboard.press("Meta+a");
        await page.keyboard.type("save on close");
      }
      await page.getByRole("button", { name: "Chats", exact: true }).click();
      await page.getByRole("button", { name: "New chat on current checkout" }).click();
      await expect(page.getByRole("status")).toHaveText("Draft");
      await page.getByLabel("Message Codex").fill("start");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("Running");
      const pids: number[] = JSON.parse(await readFile(join(root, "pids"), "utf8"));
      // Include scratch work in cancellation, failed-save and process-group quit checks.
      const scratchId = await page.evaluate(async () => {
        const chat = await window.escode.chat("createDraft", null);
        await window.escode.chat("send", null, chat.id, "run scratch");
        await window.escode.chat("draft", null, chat.id, "retained scratch draft");
        return chat.id;
      });
      const scratch = (await page.evaluate(readChats, null)).find(c => c.id === scratchId)!;
      pids.push(...JSON.parse(await readFile(join(scratch.checkout, "pids"), "utf8")));
      await writeFile(join(scratch.checkout, "retained.txt"), "scratch bytes");

      // Native Close retains this client, its provider process and unsent text.
      await page.getByLabel("Message Codex").fill("composer retained through close");
      const before = await page.evaluate(() => window.escode.lifecycle("load"));
      const chatId = (await page.evaluate(readChats, root))[0].id;
      const snapshot = await page.evaluate(({ root, chatId }) => window.escode.chat("open", root, chatId), { root, chatId });
      const windowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
      for (const pid of pids) process.kill(pid, 0);
      expect(await readFile(join(root, "interrupts"), "utf8").catch(() => "")).toBe("");
      await app.evaluate(({ app }) => { app.emit("activate"); });
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id)).toBe(windowId);
      await expect(page.getByLabel("Message Codex")).toHaveValue("composer retained through close");
      await expect(page.getByRole("status")).toHaveText("Running");
      const after = await page.evaluate(() => window.escode.lifecycle("load"));
      expect(after.state.drafts).toEqual(before.state.drafts);
      expect(await page.evaluate(({ root, chatId }) => window.escode.chat("open", root, chatId), { root, chatId })).toEqual(snapshot);
      expect(await readFile(join(root, "turns"), "utf8")).toBe("sent\n");

      const managed = closeProject
        ? await page.evaluate(async (root) => {
            const options = await window.escode.project("worktree-options", root);
            const base = options.bases.find((b) => b.ref === options.defaultRef)!;
            const chat = await window.escode.chat("createDraft", root);
            await window.escode.chat("execution", root, chat.id, "new", base.ref, base.commit);
            await window.escode.chat("send", root, chat.id, "run managed");
            const result = (await window.escode.project("worktree-managed", root))[0];
            await window.escode.chat("draft", root, chat.id, "retained worktree draft");
            return result;
          }, root)
        : null;
      if (closeProject) {
        await app.evaluate(({ dialog }) => {
          dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
        });
        await page.locator('.project-tab[data-active="true"] .project-tab-close').click();
        await expect(page.getByRole("status")).toHaveText("Running");
        expect(await readFile(join(root, "a.txt"), "utf8")).toBe("committed");
        expect(
          JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts[0].text,
        ).toBe("save on close");
      }
      if (closeProject) {
        // A failed save must also cancel app quit before interrupting live work.
        await rm(join(root, "a.txt"));
        await app.evaluate(({ dialog, app }) => {
          dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
          app.quit();
        });
        await expect(page.locator(".content:visible > [role=status]")).toContainText("ENOENT");
        await expect(page.locator(".monaco-editor:visible")).toContainText("save on close");
        expect(await readFile(join(root, "interrupts"), "utf8").catch(() => "")).toBe("");
        for (const pid of pids) process.kill(pid, 0);
        await writeFile(join(root, "a.txt"), "committed");
        await page.getByRole("button", { name: /Chats/ }).click();
        await expect(page.getByRole("status")).toHaveText("Running");
      }
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      });
      if (closeProject) {
        await page.locator('.project-tab[data-active="true"] .project-tab-close').click();
        await expect(page.locator('.project-tab[data-active="true"] .project-tab-close')).toHaveCount(
          0,
        );
        await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(await readFile(join(root, "a.txt"), "utf8")).toBe("save on close");
        expect(await readFile(join(managed!.root, "a.txt"), "utf8")).toBe("committed");
        expect(
          execFileSync("git", ["-C", root, "worktree", "list", "--porcelain"]).toString(),
        ).toContain(managed!.root);
        expect(
          execFileSync("git", ["-C", root, "branch", "--list", managed!.branch]).toString(),
        ).toContain(managed!.branch);
        const saved = await page.evaluate(readChats, root);
        expect(saved).toHaveLength(2);
        expect(saved.find((chat) => chat.checkout === managed!.root)!.draft).toBe(
          "retained worktree draft",
        );
        expect(await readFile(join(root, "turns"), "utf8")).toBe("sent\n");
        expect(await readFile(join(root, "interrupts"), "utf8").catch(() => "")).toBe("");
        for (const pid of pids) process.kill(pid, 0);
        // Quit confirmation still includes work belonging to a closed editor.
        await app.evaluate(({ dialog, app }) => {
          dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
          app.quit();
        });
        await expect(page.getByRole("button", { name: "Agents", exact: true })).toBeEnabled();
        for (const pid of pids) process.kill(pid, 0);
        await app.evaluate(({ dialog }) => {
          dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
        });
      }
      await app.close();
      expect(await readFile(join(root, "interrupts"), "utf8")).toBe("stopped\n");
      await expect
        .poll(() =>
          pids.some((pid) => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          }),
        )
        .toBe(false);
      expect(await readFile(join(scratch.checkout, "interrupts"), "utf8")).toBe("stopped\n");
      app = await launch();
      page = await app.firstWindow();
      expect(await readFile(join(scratch.checkout, "retained.txt"), "utf8")).toBe("scratch bytes");
      expect(await readFile(join(scratch.checkout, "turns"), "utf8")).toBe("sent\n");
      expect(await page.evaluate((id) => ((project: string | null, id: string) => new Promise<import("../host/chat-service").ChatSnapshot>((resolve, reject) => { const off = window.escode.chatLive(project, id, value => { off(); resolve({ ...value, items: [...value.items], requests: [...value.requests] }); }, message => { off(); reject(Error(message)); }); }))( null, id), scratch.id))
        .toMatchObject({ busy: false });
      expect((await page.evaluate(readChats, null))[0])
        .toMatchObject({ id: scratch.id, checkout: scratch.checkout, draft: "retained scratch draft" });
      if (closeProject) {
        await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(
          page.getByRole("navigation", { name: "Projects", exact: true }).locator("button[aria-pressed]"),
        ).toHaveCount(1);
        await app.evaluate(({ dialog }, root) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
          dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
        }, root);
        await page.getByRole("button", { name: "Open project…" }).click();
        await expect(page.getByRole("button", { name: "Chat 2", exact: true })).toBeVisible();
      }
      await expect(page.getByRole("status")).toHaveText("Ready");
      expect(await readFile(join(root, "turns"), "utf8")).toBe("sent\n");
      if (closeProject) {
        await page.getByRole("button", { name: "Chat 2", exact: true }).click();
        await expect(page.getByLabel("Message Codex")).toHaveValue("retained worktree draft");
        await expect(page.getByRole("status")).toHaveText("Ready");
      }
      await app.close();
    } finally {
      try {
        app.process().kill("SIGKILL");
      } catch {
        /* Already closed by the workflow. */
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("cancelled Quit retains an earlier Discard choice", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-quit-discard-")));
  const root = join(dir, "repo"), user = join(dir, "user");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "disk a");
  await writeFile(join(root, "b.txt"), "disk b");
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    for (const file of ["a.txt", "b.txt"]) {
      await page.getByRole("treeitem", { name: file, exact: true }).click();
      await expect(page.locator(".monaco-editor:visible")).toHaveAttribute("data-uri", new RegExp(file.replace(".", "\\.") + "$"));
      await page.locator(".monaco-editor:visible").click();
      await page.keyboard.press("Meta+a");
      await page.keyboard.type(`unsaved ${file}`);
    }
    await app.evaluate(({ app, dialog }) => {
      let choice = 0;
      dialog.showMessageBox = async () => ({ response: choice++ === 0 ? 1 : 2, checkboxChecked: false });
      app.quit();
    });
    await expect(page.getByRole("button", { name: "Open project…" })).toBeEnabled();
    await expect(page.locator("main")).not.toHaveAttribute("inert", "");
    await page.bringToFront();
    await page.getByRole("treeitem", { name: /^a.txt/ }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("unsaved a.txt");
    await expect.poll(async () => JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts.length).toBe(2);
  } finally {
    app.process().kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});
