import { writeApprovalFixture } from "./desktop";
import { readRecoveryFixture, writeRecoveryFixture } from "./desktop";
import { readChatFixture } from "./desktop";
import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { symlink, mkdtemp, mkdir, realpath, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop, readChats } from "./desktop";

test("worktree draft prepares only on Send from closed-project Agents, retains edits and protects active removal", async () => {
  test.setTimeout(120000);
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-draft-ui-")));
  const alpha = join(dir, "Alpha"),
    beta = join(dir, "Beta"),
    user = join(dir, "user");
  for (const root of [alpha, beta]) execFileSync("git", ["init", root]);
  await writeFile(join(beta, "tracked"), "committed");
  await writeFile(join(beta, ".gitignore"), "ignored\n");
  execFileSync("git", ["-C", beta, "add", "."]);
  const worktree = join(dir, "Beta-linked");
  execFileSync("git", [
    "-C",
    beta,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  ]);
  execFileSync("git", ["-C", beta, "worktree", "add", "-b", "linked", worktree]);
  await writeFile(join(worktree, "tracked"), "staged");
  execFileSync("git", ["-C", worktree, "add", "tracked"]);
  await writeFile(join(worktree, "tracked"), "unstaged");
  await writeFile(join(worktree, "ignored"), "ignored bytes");
  const originalStatus = execFileSync("git", [
    "-C",
    worktree,
    "status",
    "--porcelain",
    "--ignored",
  ]).toString();
  const recovery = {
    root: worktree,
    path: "tracked",
    text: "unsaved original bytes",
    disk: { text: "unstaged", version: createHash("sha256").update("unstaged").digest("hex") },
  };
  await mkdir(user);
  await symlink(process.execPath, join(dir, "node"));
  const saved = [alpha, beta].map((root) => ({ project: root, root }));
  await writeApprovalFixture(user, saved);
  await writeRecoveryFixture(
    join(user, "client-workspace-v1.json"),
    JSON.stringify({
      projects: [],
      savedProjects: saved,
      selected: "agents",
      projectUse: [{ project: beta, checkout: worktree }],
      views: { [beta]: { checkout: worktree } },
      drafts: [recovery],
    }),
  );
  await writeFile(
    join(dir, "codex"),
    `#!/usr/bin/env node
const {createInterface}=require('node:readline'), fs=require('node:fs');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0)}
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id||!m.method)return;
fs.appendFileSync(${JSON.stringify(join(dir, "calls"))},m.method+'\\n');
let result={}; if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:'draft-thread'},cwd:process.cwd(),model:'fixture',approvalPolicy:'on-request',sandbox:{type:'readOnly'}};
if(m.method==='thread/turns/list')result={data:[],nextCursor:null};
if(m.method==='turn/start') { result={turn:{id:'turn'}}; send({method:'turn/started',params:{threadId:'draft-thread',turn:{id:'turn'}}}); }
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId:'draft-thread',turn:{id:'turn'}}});
send({id:m.id,result});});`,
    { mode: 0o700 },
  );
  let app = await launchDesktop(user, dir);
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, beta);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "New chat on current checkout" }).click();
    const message = () => page.getByRole("textbox", { name: "Message Codex" });
    await message().fill("Retain this draft");
    const records = async () => {
      const saved = JSON.parse(await readChatFixture(join(user, "host-chats-v1.json"), "utf8")).chats;
      return Promise.all(saved.map(async (chat: any) => ({ ...chat, draft: await page.evaluate(({ project, id }) => window.escode.chat("composer", project, id), chat) })));
    };
    await expect.poll(async () => (await records())[0]?.draft).toBe("Retain this draft");
    const original = (await records())[0];
    expect(original.checkout).toBe(beta);
    await expect(message()).toHaveValue("Retain this draft");
    await page.getByText("Execution checkout choices", { exact: true }).click();
    await page.getByRole("combobox", { name: "Draft existing worktree" }).selectOption(beta);
    await page.getByRole("button", { name: "Use discovered worktree" }).click();
    await expect.poll(async () => (await records())[0]?.checkout).toBe(beta);
    await page.getByRole("button", { name: "Use new managed worktree on first Send" }).click();
    await expect
      .poll(async () => (await records())[0]?.worktree?.commit)
      .toBe(execFileSync("git", ["-C", beta, "rev-parse", "HEAD"]).toString().trim());
    expect((await records())[0].worktree.reservation).toBeUndefined();
    await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(message()).toHaveValue("Retain this draft");
    expect((await records())[0]).toMatchObject({ id: original.id, createdAt: original.createdAt });
    await page.locator('.project-tab > button').first().click();
    await expect(page.getByRole("button", { name: "Chat 1", exact: true })).toHaveCount(0);
    await expect(page.locator('.view-nav:visible .directory')).toContainText(beta);
    await page.locator('.project-tab[data-active="true"] .project-tab-close').click();
    await expect(message()).toHaveValue("Retain this draft");
    await writeFile(join(worktree, "original-untracked"), "retain original");
    expect((await readFile(join(dir, "calls"), "utf8").catch(() => "")).split("\n").filter(method => method === "thread/start" || method === "turn/start")).toEqual([]);
    await page.setViewportSize({ width: 728, height: 600 });
    await message().scrollIntoViewIfNeeded();
    await expect(message()).toBeInViewport();
    await page.screenshot({ path: "test-results/escode-35-draft.png" });
    await page.setViewportSize({ width: 1100, height: 768 });
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(message()).toHaveValue("");
    await page.getByRole("combobox", { name: "Project context", exact: true }).selectOption(beta);
    await expect(page.locator(".agent-row").filter({ hasText: "Chat 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await message().fill("Another nonempty draft");
    await expect.poll(async () => (await records())[1]?.draft).toBe("Another nonempty draft");
    await app.close();
    app = await launchDesktop(user, dir);
    page = await app.firstWindow();
    await expect(message()).toHaveValue("Another nonempty draft");
    await page.locator(".agent-row").filter({ hasText: "Chat 1" }).click();
    await expect(message()).toHaveValue("Retain this draft");
    await page.evaluate(async (beta) => {
      const { state } = await window.escode.lifecycle("load");
      state.views[beta].checkout = beta;
      await window.escode.lifecycle("persist", state);
    }, beta);
    await expect(page.locator(".agents .directory")).toContainText(beta);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled({ timeout: 15000 });
    await expect(page.getByRole("combobox", { name: "Project context", exact: true })).toHaveCount(
      0,
    );
    await expect.poll(async () => (await records())[0]?.initialSend, { timeout: 15000 }).toBe("accepted");
    const prepared = (await records())[0];
    await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".project-tab")).toHaveCount(0);
    await page.getByRole("button", { name: "Open checkout", exact: true }).click();
    await expect(page.locator("header")).toContainText(prepared.checkout);
    await page.getByRole("button", { name: "Chats · Running", exact: true }).click();
    await page.locator(".chat-list:visible .agent-row").filter({ hasText: "Retain this draft" }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled({ timeout: 15000 });
    await page.locator('.project-tab[data-active="true"] .project-tab-close').click();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    expect(prepared.checkout).not.toBe(worktree);
    expect(await readFile(join(prepared.checkout, "tracked"), "utf8")).toBe("committed");
    expect(await readFile(join(worktree, "tracked"), "utf8")).toBe("unstaged");
    expect(await readFile(join(worktree, "ignored"), "utf8")).toBe("ignored bytes");
    expect(
      execFileSync("git", ["-C", worktree, "status", "--porcelain", "--ignored"]).toString(),
    ).toBe(originalStatus.replace("!! ignored", "?? original-untracked\n!! ignored"));
    expect(JSON.parse(await readRecoveryFixture(join(user, "client-workspace-v1.json"), "utf8")).drafts).toContainEqual(
      recovery,
    );
    expect(prepared.worktree.reservation.root).toBe(prepared.checkout);
    expect(
      execFileSync("git", ["-C", prepared.checkout, "rev-parse", "HEAD"]).toString().trim(),
    ).toBe(prepared.worktree.commit);
    expect(await readFile(join(worktree, "original-untracked"), "utf8")).toBe("retain original");
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, beta);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.locator('.project-tab[data-active="true"] .project-tab-close').click();
    await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled({ timeout: 15000 });
    const blocked = await page.evaluate(
      async ({ beta, root }) =>
        window.escode.project("worktree-remove", beta, root).then(
          () => "unexpected",
          (e: Error) => e.message,
        ),
      { beta, root: prepared.checkout },
    );
    expect(blocked).toContain("Stop linked agents");
    expect((await records())[0]).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      project: beta,
      checkout: prepared.checkout,
      threadId: "draft-thread",
      phase: "bound",
      initialSend: "accepted",
      draft: "",
    });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    const recoveryBlocked = await page.evaluate(
      async ({ beta, root }) => {
        const { state } = await window.escode.lifecycle("load");
        const drafts = [...state.drafts];
        state.drafts.push({
          root,
          path: "tracked",
          text: "retain target edit",
          disk: { text: "committed", version: "fixture" },
        });
        await window.escode.lifecycle("persist", state);
        const message = await window.escode.project("worktree-remove", beta, root).then(
          () => "unexpected",
          (e: Error) => e.message,
        );
        await window.escode.lifecycle("persist", { ...state, drafts });
        return message;
      },
      { beta, root: prepared.checkout },
    );
    expect(recoveryBlocked).toContain("recovery drafts");
    await expect(
      page.getByRole("button", { name: "Retry connection / reload history" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Retry connection / reload history" }).click();
    await expect
      .poll(
        async () =>
          (await readFile(join(dir, "calls"), "utf8"))
            .split("\n")
            .filter((x) => x === "thread/turns/list").length,
      )
      .toBeGreaterThan(0);
    expect(
      (await readFile(join(dir, "calls"), "utf8")).split("\n").filter((x) => x === "turn/start"),
    ).toHaveLength(1);
    expect((await records())[1].draft).toBe("Another nonempty draft");
    await expect.poll(async () => (await page.evaluate(readChats, beta) as any[]).find(chat => chat.id === original.id)?.busy).toBe(false);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options?: any) => {
        if (!options.detail.includes("Retained branch:") || !options.detail.includes("Affected chats:"))
          throw Error("Missing removal confirmation context");
        return { response: 0, checkboxChecked: false };
      };
    });
    expect(await page.evaluate(({ beta, root }) => window.escode.project("worktree-remove", beta, root), { beta, root: prepared.checkout })).toBe(true);
    expect((await records())[0]).toMatchObject({ id: original.id, checkout: prepared.checkout, threadId: "draft-thread", removed: true });
    await page.screenshot({ path: "test-results/escode-35-bound.png" });
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, beta);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "New chat on current checkout" }).click();
    await expect(
      page.getByRole("combobox", { name: "Project context", exact: true }),
    ).toBeVisible();
    await message().fill("Move from local Chats");
    await page.getByRole("combobox", { name: "Project context", exact: true }).selectOption(alpha);
    await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(message()).toHaveValue("Move from local Chats");
    await expect(page.locator(".agents .directory")).toContainText(alpha);
    expect((await records())[1].draft).toBe("Another nonempty draft");
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
