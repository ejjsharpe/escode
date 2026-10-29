import { test, expect, _electron } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import electron from "electron";

test("crash recovery preserves baseline; cancel and failed save retain edits; discard survives restart", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-lifecycle-")));
  const root = join(dir, "repo"),
    user = join(dir, "user");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "original");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ESCODE_DEV_URL;
  const launch = () =>
    _electron.launch({
      executablePath: electron as unknown as string,
      args: [".", `--user-data-dir=${user}`],
      env,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("recover these edits");
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts[0]?.text,
      )
      .toBe("recover these edits");
    const exited = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exited;
    await writeFile(join(root, "a.txt"), "external");
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator(".monaco-editor:visible")).toContainText("recover these edits");
    await page.getByRole("button", { name: "Save ⌘S" }).click();
    await expect(page.locator(".conflict")).toBeVisible();
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("external");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("recover these edits");
    // Save failure during close must leave the project usable and draft retained.
    await rm(join(root, "a.txt"));
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Close file", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("ENOENT");
    await expect(page.locator(".monaco-editor:visible")).toContainText("recover these edits");
    await writeFile(join(root, "a.txt"), "external");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Close file", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toHaveCount(0);
    await expect
      .poll(
        async () => JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts.length,
      )
      .toBe(0);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "a.txt", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
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
  } finally {
    app.process().kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});

test("active work can cancel close, then quit interrupts and stops owned processes without replay on restart", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-quit-")));
  const root = join(dir, "repo"),
    user = join(dir, "user");
  execFileSync("git", ["init", root]);
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
  const env = { ...process.env, PATH: dir + ":" + process.env.PATH };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ESCODE_DEV_URL;
  const launch = () =>
    _electron.launch({
      executablePath: electron as unknown as string,
      args: [".", `--user-data-dir=${user}`],
      env,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "New chat on current checkout" }).click();
    await expect(page.getByRole("status")).toHaveText("Ready");
    await page.getByLabel("Message Codex").fill("start");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Running");
    const pids: number[] = JSON.parse(await readFile(join(root, "pids"), "utf8"));
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Running");
    await expect(page.getByLabel("Message Codex")).toBeEnabled();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
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
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole("status")).toHaveText("Ready");
    expect(await readFile(join(root, "turns"), "utf8")).toBe("sent\n");
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
