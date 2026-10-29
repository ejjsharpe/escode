import { test, expect } from "@playwright/test";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";

test("empty Agents creates distinct scratch chats only on Send and restores bytes, requests and drafts", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-scratch-ui-")));
  const user = join(dir, "user"),
    calls = join(dir, "calls");
  await mkdir(user);
  await symlink(process.execPath, join(dir, "node"));
  await writeFile(
    join(dir, "codex"),
    `#!/usr/bin/env node
const fs=require('node:fs'),{createInterface}=require('node:readline');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0)}
let pendingTurn;
const thread=process.cwd(), send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({cwd:process.cwd(),...m})+'\\n');
if(!m.method){if(m.id===99&&pendingTurn){send({id:pendingTurn,result:{turn:{id:'turn'}}});pendingTurn=null;}return;}
let result={};if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:thread},cwd:thread,model:'scratch-fixture',reasoningEffort:'high',approvalPolicy:'on-request',sandbox:{type:'workspaceWrite'}};
if(m.method==='thread/turns/list')result={data:[],nextCursor:null};
if(m.method==='turn/start'){
fs.writeFileSync('retained.txt','retained bytes');
result={turn:{id:'turn'}};
send({method:'turn/started',params:{threadId:thread,turn:{id:'turn'}}});
send({id:99,method:'item/commandExecution/requestApproval',params:{threadId:thread,turnId:'turn',command:'fixture'}});
pendingTurn=m.id;return;
}
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId:thread,turn:{id:'turn'}}});
send({id:m.id,result});});`,
    { mode: 0o700 },
  );
  let app = await launchDesktop(user, dir);
  const records = async () => JSON.parse(await readFile(join(user, "chats.json"), "utf8"));
  try {
    let page = await app.firstWindow();
    await app.evaluate(() => {
      const child = process.getBuiltinModule("child_process") as any;
      const exec = child.execFileSync;
      child.execFileSync = (command: string, ...args: any[]) => {
        if (command === "git" || command.endsWith("/git"))
          throw Error("Git deliberately unavailable");
        return exec(command, ...args);
      };
    });
    await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Start without a project", exact: true }).click();
    const message = () => page.getByRole("textbox", { name: "Message Codex" });
    await message().fill("first scratch");
    await expect.poll(async () => (await records())[0].draft).toBe("first scratch");
    const first = (await records())[0];
    expect(await readdir(user)).not.toContain("scratch");
    expect(await readFile(calls, "utf8").catch(() => "")).toBe("");
    await expect(page.getByRole("combobox", { name: "Project context", exact: true })).toHaveValue(
      "",
    );
    await page.setViewportSize({ width: 728, height: 600 });
    await message().scrollIntoViewIfNeeded();
    await expect(message()).toBeInViewport();
    await page.screenshot({ path: "/tmp/escode-34-draft.png" });
    await page.setViewportSize({ width: 1100, height: 768 });
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page.locator(".agent-row").filter({ hasText: "Chat 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await message().fill("second scratch");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeEnabled();
    const [a, b] = await records();
    expect(a).toMatchObject({
      id: first.id,
      createdAt: first.createdAt,
      project: null,
      phase: "bound",
    });
    expect(a.checkout).not.toBe(b.checkout);
    expect(await readdir(a.checkout)).not.toContain(".git");
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.locator(".agent-row").filter({ hasText: "Chat 1" }).click();
    await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await message().fill("unsent followup");
    await expect.poll(async () => (await records())[0].draft).toBe("unsent followup");
    await page.screenshot({ path: "/tmp/escode-34-running.png" });
    // Quit includes the remaining active scratch turn.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await app.close();
    app = await launchDesktop(user, dir);
    page = await app.firstWindow();
    await expect(message()).toHaveValue("unsent followup");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
    for (const chat of [a, b])
      expect(await readFile(join(chat.checkout, "retained.txt"), "utf8")).toBe("retained bytes");
    const wire = (await readFile(calls, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(wire.filter((c) => c.method === "turn/start")).toHaveLength(2);
    expect(
      wire
        .filter((c) => c.id === 99 && c.result?.decision === "accept")
        .map((c) => c.cwd)
        .sort(),
    ).toEqual([a.checkout, b.checkout].sort());
    expect(
      wire
        .filter((c) => c.method === "turn/interrupt")
        .map((c) => c.cwd)
        .sort(),
    ).toEqual([a.checkout, b.checkout].sort());
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      })
      .catch(() => {});
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("one repository offers No project and text-bearing local drafts move through Agents without changing identity", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-scratch-context-")));
  const repo = join(dir, "Alpha"),
    user = join(dir, "user");
  execFileSync("git", ["init", repo]);
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, repo);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "New chat on current checkout" }).click();
    const message = page.getByRole("textbox", { name: "Message Codex" });
    await expect(message).toBeVisible();
    await message.fill("move this prompt");
    const records = async () => JSON.parse(await readFile(join(user, "chats.json"), "utf8"));
    await expect.poll(async () => (await records())[0].draft).toBe("move this prompt");
    const original = (await records())[0];
    await page.getByRole("combobox", { name: "Project context", exact: true }).selectOption("");
    await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(message).toHaveValue("move this prompt");
    expect((await records())[0]).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      project: null,
      checkout: "",
    });
    await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "New chat project", exact: true }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "New chat project", exact: true }).selectOption(repo);
    await expect(
      page.locator(".agent-row").filter({ hasText: "Chat 1" }).filter({ hasText: "Alpha" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(message).toHaveValue("");
    const textDraft = (await records()).find((c: any) => c.id === original.id);
    expect(textDraft.draft).toBe("move this prompt");
    await page.locator(".agent-row").filter({ hasText: "No project" }).click();
    await expect(message).toHaveValue("move this prompt");
    await page.getByRole("combobox", { name: "Project context", exact: true }).selectOption(repo);
    await expect(message).toHaveValue("move this prompt");
    expect((await records()).find((c: any) => c.id === original.id)).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      project: repo,
      draft: "move this prompt",
    });
    expect(await readdir(user)).not.toContain("scratch");
    await expect(page.getByRole("button", { name: "No project", exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
