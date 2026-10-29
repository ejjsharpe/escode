import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("dirty background close preserves work on cancel/failure, retained requests and managed removal protections", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-retained-")));
  const a = join(dir, "alpha"),
    b = join(dir, "beta"),
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
  await writeFile(
    join(dir, "codex"),
    `#!/usr/bin/env node
const {createInterface}=require('node:readline');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit()}
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');const threadId='thread-'+process.pid;
createInterface({input:process.stdin}).on('line',line=>{
const m=JSON.parse(line);if(!m.id)return; if(!m.method)return;
let result={};if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/start')result={thread:{id:threadId},cwd:process.cwd(),model:'fixture',sandbox:{type:'readOnly'},approvalPolicy:'on-request'};
if(m.method==='turn/start'){result={turn:{id:'turn'}};send({method:'turn/started',params:{threadId,turn:{id:'turn'}}});send({id:99,method:'item/commandExecution/requestApproval',params:{threadId,turnId:'turn',itemId:'cmd',command:'fixture'}})}
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId,turn:{id:'turn'}}});
send({id:m.id,result});});`,
    { mode: 0o700 },
  );
  const app = await launchDesktop(user, dir);
  try {
    const page = await app.firstWindow();
    const open = async (root: string) => {
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await expect(page.locator("header")).toContainText(root);
    };
    const choice = async (response: number) =>
      app.evaluate(({ dialog }, response) => {
        dialog.showMessageBox = async (_window: unknown, options?: any) => {
          if (options.buttons[0] !== "Save")
            throw Error("Editor closure must not prompt Stop and Close");
          return { response, checkboxChecked: false };
        };
      }, response);
    await open(a);
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("dirty alpha");
    const managed = await page.evaluate(async (a) => {
      const options = await window.escode.project("worktree-options", a);
      const base = options.bases.find((b) => b.ref === options.defaultRef)!;
      const result = await window.escode.project("worktree-create", a, base.ref, base.commit);
      if (result.error) throw Error(result.error);
      const chat = await window.escode.chat("create", a, result.root);
      await window.escode.chat("open", a, chat.id);
      await window.escode.chat("send", a, chat.id, "run alpha");
      return { ...result, chat };
    }, a);
    await open(b);
    const beta = await page.evaluate(async (b) => {
      const chat = await window.escode.chat("create", b, b);
      await window.escode.chat("open", b, chat.id);
      await window.escode.chat("send", b, chat.id, "run beta");
      return chat;
    }, b);
    const alphaTab = page
      .getByRole("navigation", { name: "Projects", exact: true })
      .getByRole("button", { name: /^alpha/ });
    await choice(2);
    await alphaTab.click({ button: "middle" });
    await expect(page.locator("header")).toContainText(b);
    await expect(alphaTab).toBeVisible();
    expect(
      (await page.evaluate((a) => window.escode.chat("snapshot", a.project, a.id), managed.chat))
        .busy,
    ).toBe(true);
    await rm(join(a, "a.txt"));
    await choice(0);
    await alphaTab.click({ button: "middle" });
    await expect(page.locator(".monaco-editor:visible")).toContainText("dirty alpha");
    await expect(alphaTab).toBeVisible();
    expect(
      (await page.evaluate((a) => window.escode.chat("snapshot", a.project, a.id), managed.chat))
        .busy,
    ).toBe(true);
    await writeFile(join(a, "a.txt"), "baseline");
    await open(b);
    await choice(1);
    await alphaTab.click({ button: "middle" });
    await expect(alphaTab).toHaveCount(0);
    await expect(page.locator("header")).toContainText(b);
    expect(await readFile(join(a, "a.txt"), "utf8")).toBe("baseline");
    const remove = () =>
      page.evaluate(
        async ({ a, root }) => {
          try {
            await window.escode.project("worktree-remove", a, root);
            return "removed";
          } catch (e) {
            return String(e);
          }
        },
        { a, root: managed.root },
      );
    expect(await remove()).toContain("Stop linked agents");
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.locator(".agent-row").filter({ hasText: "alpha" }).click();
    await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect(page.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Message Codex" }).fill("retained text");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Ready");
    expect(
      (await page.evaluate((c) => window.escode.chat("snapshot", c.project, c.id), beta)).busy,
    ).toBe(true);
    const loaded = await page.evaluate(() => window.escode.lifecycle("load"));
    loaded.state.drafts.push({
      root: managed.root,
      path: "a.txt",
      text: "recovery",
      disk: { text: "baseline", version: "baseline" },
    });
    await page.evaluate((s) => window.escode.lifecycle("persist", s), loaded.state);
    expect(await remove()).toContain("recovery drafts");
    loaded.state.drafts = [];
    await page.evaluate((s) => window.escode.lifecycle("persist", s), loaded.state);
    await writeFile(join(managed.root, ".gitignore"), "ignored\n");
    await writeFile(join(managed.root, "ignored"), "preserve");
    expect(await remove()).toMatch(/local|changes|files/i);
    expect(await readFile(join(managed.root, "ignored"), "utf8")).toBe("preserve");
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, managed.root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.locator(".view-nav:visible")).toContainText(a);
    await expect(page.locator(".toolbar:visible")).toContainText("a.txt");
    await expect(page.locator(".monaco-editor:visible")).toContainText("baseline");
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
