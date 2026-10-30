import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("tree clipboard copy, dirty duplicate, collision and cut partial results use real bytes", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-transfer-")));
  const root = join(base, "repo"),
    user = join(base, "user");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "target"));
  await writeFile(join(root, "a.ts"), "original disk");
  await writeFile(join(root, "b.ts"), "second disk");
  await writeFile(join(root, "target/a.ts"), "destination disk");
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      (globalThis as any).choices = [];
      dialog.showMessageBox = (async (_: unknown, options: any) => {
        (globalThis as any).choices.push(options.buttons);
        return { response: options.buttons!.indexOf("Keep Both"), checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    const tree = page.getByRole("tree", { name: "Files", exact: true });
    await page.getByRole("treeitem", { name: "a.ts", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("unsaved source");
    await tree.focus();
    await page.keyboard.press("Meta+c");
    await page.getByRole("treeitem", { name: "target", exact: true }).click();
    await page.keyboard.press("Meta+v");
    await expect(page.getByRole("treeitem", { name: /a copy.ts/ })).toBeVisible();
    expect(await readFile(join(root, "target/a copy.ts"), "utf8")).toBe("original disk");
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts.find(
            (d: any) => d.path === "target/a copy.ts",
          )?.text,
      )
      .toBe("unsaved source");
    expect(await readFile(join(root, "a.ts"), "utf8")).toBe("original disk");
    expect(await app.evaluate(() => (globalThis as any).choices)).toEqual([
      ["Replace", "Keep Both", "Skip", "Cancel"],
    ]);
    // Capture two cuts; remove one after capture to force an honest partial result.
    await page.getByRole("treeitem", { name: /^a.ts, unsaved/ }).click();
    await page.getByRole("treeitem", { name: "b.ts", exact: true }).click({ modifiers: ["Meta"] });
    await page.keyboard.press("Meta+x");
    await rm(join(root, "b.ts"));
    await page.getByRole("treeitem", { name: "target", exact: true }).click();
    await page.keyboard.press("Meta+v");
    await expect(page.locator(".content:visible > [role=status]")).toContainText("b.ts");
    await expect
      .poll(() => readFile(join(root, "target/a copy 2.ts"), "utf8").catch(String))
      .toBe("original disk");
    await expect(page.locator(".content:visible > [role=status]")).toContainText("b.ts");
    await expect(readFile(join(root, "a.ts"))).rejects.toThrow();
    await tree.focus();
    await page.keyboard.press("Meta+v");
    await expect(page.locator(".content:visible > [role=status]")).toContainText("b.ts");
    await expect(readFile(join(root, "target/a copy 3.ts"))).rejects.toThrow();
    await page.screenshot({ path: "/tmp/escode-files-43-transfer.png" });
  } finally {
    app.process().kill("SIGKILL");
    await new Promise((resolve) => app.process().once("exit", resolve));
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("dirty destination blocks Replace; duplicate text survives a fresh Electron process", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-transfer-dirty-")));
  const root = join(base, "repo"),
    user = join(base, "user");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "target"));
  await writeFile(join(root, "a.ts"), "source baseline");
  await writeFile(join(root, "target/a.ts"), "target baseline");
  let app = await launchDesktop(user);
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      (globalThis as any).buttons = [];
      dialog.showMessageBox = (async (_: unknown, options: any) => {
        (globalThis as any).buttons.push(options.buttons);
        return { response: options.buttons.indexOf("Keep Both"), checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "target", exact: true }).click();
    await page.getByRole("treeitem", { name: "a.ts", exact: true }).nth(0).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("dirty destination");
    await page.getByRole("treeitem", { name: "a.ts", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("dirty source");
    await page.getByRole("tree", { name: "Files", exact: true }).focus();
    await page.keyboard.press("Meta+c");
    await page.getByRole("treeitem", { name: "target", exact: true }).click();
    await page.keyboard.press("Meta+v");
    await expect
      .poll(() => readFile(join(root, "target/a copy.ts"), "utf8").catch(String))
      .toBe("source baseline");
    expect(await app.evaluate(() => (globalThis as any).buttons)).toEqual([
      ["Open affected files", "Keep Both", "Cancel"],
    ]);
    await expect(page.locator(".content:visible > [role=status]")).toContainText("Copied;");
    const source = page.locator('[data-path="a.ts"] > .tree-row');
    await source.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
    await expect
      .poll(() => readFile(join(root, "a copy.ts"), "utf8").catch(String))
      .toBe("source baseline");
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts.find(
            (d: any) => d.path === "a copy.ts",
          )?.text,
      )
      .toBe("dirty source");
    const exit = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exit;
    app = await launchDesktop(user);
    page = await app.firstWindow();
    await page.locator('[data-path="a copy.ts"] > .tree-row').click();
    await page.keyboard.press("Meta+s");
    await expect.poll(() => readFile(join(root, "a copy.ts"), "utf8")).toBe("dirty source");
    expect(await readFile(join(root, "a.ts"), "utf8")).toBe("source baseline");
    expect(await readFile(join(root, "target/a.ts"), "utf8")).toBe("target baseline");
  } finally {
    const exit = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exit;
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("generated recursive binary copy leaves navigation and concurrent chat Stop responsive", async () => {
  test.setTimeout(90000);
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-transfer-long-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "bulk"));
  await mkdir(join(root, "target"));
  await writeFile(join(root, "vanishing.txt"), "source bytes");
  const bytes = Buffer.alloc(64 * 1024, 173),
    count = 8000;
  for (let batch = 0; batch < count; batch += 100)
    await Promise.all(
      Array.from({ length: 100 }, (_, i) => writeFile(join(root, `bulk/${batch + i}.bin`), bytes)),
    );
  await writeFile(
    join(base, "codex"),
    `#!/usr/bin/env node
const {createInterface}=require('node:readline');
if(process.argv.includes('--version')) {console.log('codex-cli 0.165.0');process.exit(0);}
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.id)return;let result={};
 if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
 if(m.method==='account/read')result={account:{}};
 if(m.method==='thread/start')result={thread:{id:'thread'},cwd:process.cwd(),model:'fixture',approvalPolicy:'on-request',sandbox:{type:'readOnly'}};
 if(m.method==='turn/start'){result={turn:{id:'turn'}};send({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});}
 if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn'}}});
 send({id:m.id,result});
});`,
    { mode: 0o700 },
  );
  const app = await launchDesktop(join(base, "user"), base);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      const cp = process.getBuiltinModule("child_process") as any,
        spawn = cp.spawn;
      cp.spawn = (...args: any[]) => {
        const child = spawn(...args);
        if (args[1]?.[0] === "copy") {
          (globalThis as any).copyRunning = true;
          (globalThis as any).copyStarted = Date.now();
          child.on("close", () => {
            (globalThis as any).copyRunning = false;
            (globalThis as any).copyMs = Date.now() - (globalThis as any).copyStarted;
          });
        }
        return child;
      };
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("treeitem", { name: "bulk", exact: true })).toBeVisible();
    const chat = await page.evaluate(async (root) => {
      const chat = await window.escode.chat("create", root, root);
      await window.escode.chat("open", root, chat.id);
      await window.escode.chat("send", root, chat.id, "keep running until stopped");
      return chat.id;
    }, root);
    const expanded = Date.now();
    await page.getByRole("treeitem", { name: "bulk", exact: true }).locator(":scope > .tree-row").click();
    await expect(page.getByRole("treeitem")).toHaveCount(count + 3);
    const tree = page.getByRole("tree", { name: "Files", exact: true });
    await tree.focus();
    await page.keyboard.press("ArrowDown");
    await expect(tree).toHaveAttribute("aria-activedescendant", root + ":bulk/0.bin");
    await page.keyboard.press("ArrowDown");
    await expect(tree).toHaveAttribute("aria-activedescendant", root + ":bulk/1.bin");
    console.log(`Concurrent tree expansion and two arrow keys: ${Date.now() - expanded} ms; ${count} files; chat remains running.`);
    await page.getByRole("treeitem", { name: "bulk", exact: true }).locator(":scope > .tree-row").click();
    await page.getByRole("treeitem", { name: "vanishing.txt", exact: true }).click();
    await page.keyboard.press("Meta+x");
    await rm(join(root, "vanishing.txt"));
    await page.getByRole("treeitem", { name: "target", exact: true }).click();
    await page.keyboard.press("Meta+v");
    await expect(page.locator(".content:visible > [role=status]")).toContainText("vanishing.txt");
    await expect(readFile(join(root, "target/vanishing.txt"))).rejects.toThrow();
    expect(await page.evaluate(({ root, chat }) =>
      window.escode.chat("snapshot", root, chat).then((s) => s.busy), { root, chat })).toBe(true);
    await page.getByRole("treeitem", { name: "bulk", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).copyRunning)).toBe(true);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.locator(".agent-row").click();
    const stopStart = Date.now();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    const stopMs = Date.now() - stopStart;
    expect(await app.evaluate(() => (globalThis as any).copyRunning)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          ({ root, chat }) => window.escode.chat("snapshot", root, chat).then((s) => s.busy),
          { root, chat },
        ),
      )
      .toBe(false);
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).copyRunning), { timeout: 60000 })
      .toBe(false);
    const copyMs = await app.evaluate(() => (globalThis as any).copyMs);
    for (let i = 0; i < count; i++)
      expect((await readFile(join(root, `bulk copy/${i}.bin`))).equals(bytes)).toBe(true);
    console.log(
      `Generated 500 MiB / ${count} binary files: native copy ${copyMs} ms; concurrent visible Stop ${stopMs} ms; Agents navigation completed while native copy running.`,
    );
  } finally {
    const exit = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exit;
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("explicit clean Replace uses native recovery and forged clipboard data grants no authority", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-transfer-replace-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "target"));
  await writeFile(join(root, "a.txt"), "source bytes");
  await writeFile(join(root, "target/a.txt"), "replaced bytes");
  const app = await launchDesktop(join(base, "user"));
  let trash: string[] = [];
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      const cp = process.getBuiltinModule("child_process") as any,
        execute = cp.execFileSync;
      (globalThis as any).trash = [];
      cp.execFileSync = (...args: any[]) => {
        const result = execute(...args);
        if (args[1]?.[0] === "trash") (globalThis as any).trash.push(result.toString());
        return result;
      };
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("treeitem", { name: "target", exact: true })).toBeVisible();
    await page.evaluate(
      (root) => window.escode.project("clipboard-capture", root, "copy", ["a.txt"]),
      root,
    );
    const result = await page.evaluate(
      (root) => window.escode.project("transfer", root, "paste", "target", []),
      root,
    );
    expect(result.results.map((r) => r.intent?.kind)).toEqual(["trash", "copy"]);
    expect(result.results.every((r) => r.applied)).toBe(true);
    expect(await readFile(join(root, "target/a.txt"), "utf8")).toBe("source bytes");
    trash = await app.evaluate(() => (globalThis as any).trash);
    expect(await readFile(trash[0], "utf8")).toBe("replaced bytes");
    await page.evaluate((root) => window.escode.project("file-operation-ack", root), root);
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([
        new ClipboardItem({ "web application/x.escode-files": "forged-reference" }),
      ]);
    });
    await expect(
      page.evaluate((root) => window.escode.project("transfer", root, "paste", "target", []), root),
    ).rejects.toThrow("No current escode file references");
    await expect(
      page.evaluate(
        (root) => window.escode.project("clipboard-capture", root, "copy", ["../outside"]),
        root,
      ),
    ).rejects.toThrow();
  } finally {
    const exit = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exit;
    for (const file of trash) await rm(file, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("pending collision stays bound to its captured source and originating project", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-transfer-origin-")));
  const root = join(base, "origin"),
    other = join(base, "other");
  for (const path of [root, other]) {
    execFileSync("git", ["init", path]);
    await mkdir(join(path, "target"));
    await writeFile(join(path, "a.txt"), path === root ? "origin source" : "other source");
    await writeFile(join(path, "target/a.txt"), "retained target");
  }
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      dialog.showMessageBox = () =>
        new Promise((resolve) => {
          (globalThis as any).answerTransfer = () =>
            resolve({ response: 1, checkboxChecked: false });
        });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.getByRole("tree", { name: "Files", exact: true }).focus();
    await page.keyboard.press("Meta+c");
    await page.getByRole("treeitem", { name: "target", exact: true }).click();
    await page.keyboard.press("Meta+v");
    await expect
      .poll(() => app.evaluate(() => typeof (globalThis as any).answerTransfer))
      .toBe("function");
    await app.evaluate(({ dialog }, other) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [other] });
    }, other);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.locator("header")).toContainText(other);
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await app.evaluate(() => (globalThis as any).answerTransfer());
    await expect
      .poll(() => readFile(join(root, "target/a copy.txt"), "utf8").catch(String))
      .toBe("origin source");
    expect(await readFile(join(other, "target/a.txt"), "utf8")).toBe("retained target");
    await expect(readFile(join(other, "target/a copy.txt"))).rejects.toThrow();
    await expect(page.locator("header")).toContainText(other);
  } finally {
    const exit = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exit;
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("copy delivery updates an early-open clean destination after a second-item collision, including undo and restart baseline", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-transfer-early-")));
  const root = join(base, "repo"),
    user = join(base, "user");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "target"));
  await writeFile(join(root, "a.ts"), "source disk");
  await writeFile(join(root, "b.ts"), "second disk");
  await writeFile(join(root, "target/b.ts"), "occupied second");
  let app = await launchDesktop(user);
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      dialog.showMessageBox = () =>
        new Promise((resolve) => {
          (globalThis as any).cancelSecondCopy = () =>
            resolve({ response: 3, checkboxChecked: false });
        });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.ts", exact: true }).click();
    await page.locator(".monaco-editor:visible textarea").focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("SOURCE UNSAVED");
    await page.getByRole("tree", { name: "Files", exact: true }).focus();
    await page.getByRole("treeitem", { name: "b.ts", exact: true }).click({ modifiers: ["Meta"] });
    await page.keyboard.press("Meta+c");
    await page.getByRole("treeitem", { name: "target", exact: true }).click();
    await page.keyboard.press("Meta+v");
    await expect
      .poll(() => app.evaluate(() => typeof (globalThis as any).cancelSecondCopy))
      .toBe("function");
    expect(await readFile(join(root, "target/a.ts"), "utf8")).toBe("source disk");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.locator('[data-path="target/a.ts"] > .tree-row').click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("source disk");
    await expect(page.locator(".editor:visible")).toHaveAttribute(
      "data-model-uri",
      "file://" + root + "/target/a.ts",
    );
    await expect(page.locator(".editor:visible")).toHaveAttribute("data-language", "typescript");
    await app.evaluate(() => (globalThis as any).cancelSecondCopy());
    await expect(page.locator(".content:visible > [role=status]")).toContainText("Cancelled");
    await expect(page.locator(".monaco-editor:visible")).toContainText("SOURCE UNSAVED");
    const draft = async () =>
      JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts.find(
        (d: any) => d.path === "target/a.ts",
      );
    await expect.poll(async () => (await draft())?.text).toBe("SOURCE UNSAVED");
    expect((await draft()).disk.text).toBe("source disk");
    await expect(page.locator(".editor:visible")).toHaveAttribute(
      "data-model-uri",
      "file://" + root + "/target/a.ts",
    );
    await page.locator(".monaco-editor:visible textarea").focus();
    await page.keyboard.press("Meta+ArrowRight");
    await page.keyboard.type("!");
    await expect.poll(async () => (await draft())?.text).toBe("SOURCE UNSAVED!");
    await page.keyboard.press("Meta+z");
    await expect.poll(async () => (await draft())?.text).toBe("SOURCE UNSAVED");
    await page.keyboard.press("Meta+Shift+z");
    await expect.poll(async () => (await draft())?.text).toBe("SOURCE UNSAVED!");
    expect(await readFile(join(root, "target/a.ts"), "utf8")).toBe("source disk");
    expect(await readFile(join(root, "target/b.ts"), "utf8")).toBe("occupied second");
    const exited = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exited;
    app = await launchDesktop(user);
    page = await app.firstWindow();
    await page.locator('[data-path="target/a.ts"] > .tree-row').click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("SOURCE UNSAVED!");
    await expect(page.locator(".editor:visible")).toHaveAttribute(
      "data-model-uri",
      "file://" + root + "/target/a.ts",
    );
    await expect(page.locator(".editor:visible")).toHaveAttribute("data-language", "typescript");
    await writeFile(join(root, "target/a.ts"), "external disk after restart");
    await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
    await expect(page.getByRole("button", { name: "Compare", exact: true })).toBeVisible();
    expect(await readFile(join(root, "target/a.ts"), "utf8")).toBe("external disk after restart");
    expect((await draft()).text).toBe("SOURCE UNSAVED!");
    expect((await draft()).disk.text).toBe("source disk");
    expect(await readFile(join(root, "a.ts"), "utf8")).toBe("source disk");
  } finally {
    const exited = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exited;
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

for (const change of [
  "editor close",
  "retained dirty editor",
  "navigation",
  "quit",
  "root replacement",
  "destination replacement",
]) {
  test(`pending transfer preserves its origin across ${change}`, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "escode-transfer-lifecycle-")));
    const root = join(base, "origin"),
      other = join(base, "other"),
      user = join(base, "user");
    for (const folder of [root, other]) {
      execFileSync("git", ["init", folder]);
      await mkdir(join(folder, "target"));
      await writeFile(join(folder, "a.ts"), "source disk");
      await writeFile(join(folder, "target/a.ts"), "occupied disk");
    }
    const app = await launchDesktop(user);
    try {
      const page = await app.firstWindow();
      const open = async (folder: string) => {
        await app.evaluate(({ dialog }, folder) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
        }, folder);
        await page.getByRole("button", { name: "Open project…" }).click();
        await expect(page.locator("header")).toContainText(folder);
      };
      await open(root);
      await expect(page.getByRole("treeitem", { name: "a.ts", exact: true })).toBeVisible();
      if (change === "retained dirty editor") {
        await page.getByRole("treeitem", { name: "a.ts", exact: true }).click();
        await page.locator(".monaco-editor:visible textarea").focus();
        await page.keyboard.press("Meta+a");
        await page.keyboard.type("retained source edits");
        await expect
          .poll(
            async () =>
              JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts[0]?.text,
          )
          .toBe("retained source edits");
      }
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = () =>
          new Promise((resolve) => {
            (globalThis as any).resumeTransfer = () =>
              resolve({ response: 1, checkboxChecked: false });
          });
      });
      await page.evaluate(async (root) => {
        await window.escode.project("clipboard-capture", root, "copy", ["a.ts"]);
        (window as any).pendingTransfer = window.escode.project(
          "transfer",
          root,
          "paste",
          "target",
          [],
        );
      }, root);
      await expect.poll(() => app.evaluate(() => !!(globalThis as any).resumeTransfer)).toBe(true);
      if (change === "editor close") {
        await page.getByRole("button", { name: "Close project", exact: true }).click();
        await expect(page.getByRole("button", { name: "origin", exact: true })).toHaveCount(0);
      } else if (change === "retained dirty editor") {
        await page.evaluate((root) => window.escode.lifecycle("finish", root), root);
      }
      await open(other);
      await page.getByRole("button", { name: "Agents", exact: true }).click();
      if (change === "root replacement") {
        await rename(root, root + "-original");
        await mkdir(root);
        await writeFile(join(root, "sentinel"), "replacement root");
      }
      if (change === "destination replacement") {
        await rename(join(root, "target"), join(root, "original-target"));
        await mkdir(join(root, "target"));
        await writeFile(join(root, "target/sentinel"), "replacement destination");
      }
      if (change === "quit") {
        await app.evaluate(({ app }) => {
          app.quit = () => {};
        });
        await page.evaluate(() => window.escode.lifecycle("finish"));
      }
      await app.evaluate(() => (globalThis as any).resumeTransfer());
      const result = await page.evaluate(() => (window as any).pendingTransfer);
      const rejected = ["quit", "root replacement", "destination replacement"].includes(change);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].applied).toBe(!rejected);
      if (rejected) {
        expect(result.message).toMatch(/quitting|replaced|changed/);
        await expect(readFile(join(root, "target/a copy.ts"))).rejects.toThrow();
      } else {
        expect(await readFile(join(root, "target/a copy.ts"), "utf8")).toBe("source disk");
        expect(result.results[0].intent.root).toBe(root);
        await page.evaluate((root) => window.escode.project("file-operation-ack", root), root);
      }
      const original = change === "root replacement" ? root + "-original" : root;
      expect(await readFile(join(original, "a.ts"), "utf8")).toBe("source disk");
      expect(
        await readFile(
          join(
            original,
            change === "destination replacement" ? "original-target/a.ts" : "target/a.ts",
          ),
          "utf8",
        ),
      ).toBe("occupied disk");
      expect(await readFile(join(other, "target/a.ts"), "utf8")).toBe("occupied disk");
      await expect(readFile(join(other, "target/a copy.ts"))).rejects.toThrow();
      await expect
        .poll(async () => JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).selected)
        .toBe("agents");
      const state = JSON.parse(await readFile(join(user, "workspace.json"), "utf8"));
      if (change === "retained dirty editor") {
        expect(state.drafts.find((d: any) => d.root === root && d.path === "a.ts")).toMatchObject({
          text: "retained source edits",
          disk: { text: "source disk" },
        });
        expect(
          state.drafts.find((d: any) => d.root === root && d.path === "target/a copy.ts"),
        ).toMatchObject({ text: "retained source edits", disk: { text: "source disk" } });
      }
    } finally {
      const exit = new Promise((resolve) => app.process().once("exit", resolve));
      app.process().kill("SIGKILL");
      await exit;
      await rm(base, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
