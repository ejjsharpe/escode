import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { symlink, mkdtemp, mkdir, realpath, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";

test("saved project drafts move with text, survive restart and bind exactly once from closed-project Agents", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-draft-ui-")));
  const alpha = join(dir, "Alpha"),
    beta = join(dir, "Beta"),
    user = join(dir, "user");
  for (const root of [alpha, beta]) execFileSync("git", ["init", root]);
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
  await mkdir(user);
  await symlink(process.execPath, join(dir, "node"));
  const saved = [alpha, beta].map((root) => ({ project: root, root }));
  await writeFile(join(user, "approved-projects.json"), JSON.stringify(saved));
  await writeFile(
    join(user, "client-workspace-v1.json"),
    JSON.stringify({
      projects: [],
      savedProjects: saved,
      selected: "agents",
      views: { [beta]: { checkout: worktree } },
      drafts: [],
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
if(m.method==='config/read' && m.params.cwd===process.cwd())result={config:{model:'fixture',approval_policy:'on-request',sandbox_mode:'read-only'}};
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
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.getByRole("combobox", { name: "New chat project", exact: true }).selectOption(alpha);
    const message = () => page.getByRole("textbox", { name: "Message Codex" });
    await expect(page.getByText("Effective Codex settings · fixture", { exact: true })).toBeVisible();
    await message().fill("Retain this draft");
    const records = async () => {
      const chats = JSON.parse(await readFile(join(user, "host-chats-v1.json"), "utf8")).chats;
      return page.evaluate(chats => chats.map((chat: { id: string }) => ({ ...chat, draft: localStorage.getItem(`escode-composer:${chat.id}`) ?? "" })), chats);
    };
    await expect.poll(async () => (await records())[0]?.draft).toBe("Retain this draft");
    const original = (await records())[0];
    await page.getByRole("combobox", { name: "Project context", exact: true }).selectOption(beta);
    await expect(message()).toHaveValue("Retain this draft");
    await expect(page.locator(".agents .directory")).toContainText(worktree);
    await expect.poll(async () => (await records())[0]?.project).toBe(beta);
    await message().fill("Newer prompt in beta");
    await expect.poll(async () => (await records())[0]?.draft).toBe("Newer prompt in beta");
    await page.getByRole("combobox", { name: "Project context", exact: true }).selectOption(alpha);
    await expect(message()).toHaveValue("Newer prompt in beta");
    await page.getByRole("combobox", { name: "Project context", exact: true }).selectOption(beta);
    await expect(message()).toHaveValue("Newer prompt in beta");
    await message().fill("Retain this draft");
    expect((await readFile(join(dir, "calls"), "utf8")).includes("thread/start")).toBe(false);
    await page.setViewportSize({ width: 728, height: 600 });
    await message().scrollIntoViewIfNeeded();
    await expect(message()).toBeInViewport();
    await page.screenshot({ path: "test-results/escode-33-draft.png" });
    await page.setViewportSize({ width: 1100, height: 768 });
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.getByRole("combobox", { name: "New chat project", exact: true }).selectOption(beta);
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
    await expect(page.locator(".agents .directory")).toContainText(worktree);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
    await expect(page.getByRole("combobox", { name: "Project context", exact: true })).toHaveCount(
      0,
    );
    expect((await records())[0]).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      project: beta,
      checkout: worktree,
      threadId: "draft-thread",
      phase: "bound",
      initialSend: "accepted",
      draft: "",
    });
    expect(await page.evaluate(id => localStorage.getItem(`escode-composer:${id}`), original.id)).toBe("");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Retry connection / reload history" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Retry connection / reload history" }).click();
    await expect(message()).toHaveValue("");
    expect((await records())[0].threadId).toBe("draft-thread");
    expect(
      (await readFile(join(dir, "calls"), "utf8")).split("\n").filter((x) => x === "turn/start"),
    ).toHaveLength(1);
    expect((await records())[1].draft).toBe("Another nonempty draft");
    await page.screenshot({ path: "test-results/escode-33-bound.png" });
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

