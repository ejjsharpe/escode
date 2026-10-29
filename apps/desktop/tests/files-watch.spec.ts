import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rename, rm, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("external restoration, loaded/collapsed updates, focus recovery and dirty missing restart", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-47-ui-")));
  const root = join(base, "repo"), user = join(base, "user");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "folder"));
  await writeFile(join(root, "folder/dirty.txt"), "disk");
  await writeFile(join(root, "fixture.txt"), "restore me");
  let app = await launchDesktop(user);
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    const row = (name: string) => page.getByRole("treeitem", { name, exact: true }).locator(":scope > .tree-row");
    await expect(row("fixture.txt")).toBeVisible();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      const cp = process.getBuiltinModule("child_process") as any, execute = cp.execFileSync;
      cp.execFileSync = (...args: any[]) => {
        const value = execute(...args);
        if (args[1]?.[0] === "trash") (globalThis as any).trashedFixture = value.toString();
        return value;
      };
    });
    await row("fixture.txt").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Trash/ }).click();
    await expect(row("fixture.txt")).toHaveCount(0);
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await refresh.focus();
    const trashed = await app.evaluate(() => (globalThis as any).trashedFixture as string);
    expect(trashed).toBeTruthy();
    await rename(trashed, join(root, "fixture.txt"));
    await expect(row("fixture.txt")).toBeVisible();
    await expect(refresh).toBeFocused();
    await row("fixture.txt").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const inline = page.getByRole("textbox", { name: "Rename fixture.txt", exact: true });
    await inline.fill("in-progress.txt");
    await rm(join(root, "fixture.txt"));
    await writeFile(join(root, "inline-event.txt"), "event during input");
    await page.waitForTimeout(350);
    await expect(inline).toHaveValue("in-progress.txt");
    await expect(inline).toBeFocused();
    await inline.press("Escape");
    await expect(row("inline-event.txt")).toBeVisible();
    await expect(row("fixture.txt")).toHaveCount(0);
    await row("folder").click();
    await row("dirty.txt").click();
    const editor = page.locator(".monaco-editor textarea");
    await editor.focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("retained external deletion edits");
    await writeFile(join(root, "folder/new.txt"), "created externally");
    await expect(row("new.txt")).toBeVisible();
    await expect(editor).toBeFocused();
    await row("folder").click();
    await rename(join(root, "folder/new.txt"), join(root, "folder/renamed.txt"));
    await row("folder").click();
    await expect(row("renamed.txt")).toBeVisible();
    await expect(row("new.txt")).toHaveCount(0);
    await rm(join(root, "folder/dirty.txt"));
    await expect(row("dirty.txt, unsaved")).toHaveCount(0);
    await expect(page.locator(".monaco-editor")).toContainText("retained external deletion edits");
    await page.keyboard.press("Meta+s");
    await expect(page.locator(".monaco-editor")).toContainText("retained external deletion edits");
    await expect(readFile(join(root, "folder/dirty.txt"))).rejects.toThrow();
    // Suppress host delivery to exercise focus and explicit recovery independently.
    await app.evaluate(({ webContents }) => {
      for (const contents of webContents.getAllWebContents()) {
        const send = contents.send.bind(contents);
        contents.send = (channel, ...args) => { if (channel !== "files-changed") send(channel, ...args); };
      }
    });
    await writeFile(join(root, "missed.txt"), "missed");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(row("missed.txt")).toBeVisible();
    await writeFile(join(root, "manual.txt"), "manual");
    await refresh.click();
    await expect(row("manual.txt")).toBeVisible();
    await expect.poll(async () => (await readFile(join(user, "workspace.json"), "utf8"))).toContain("retained external deletion edits");
    await app.evaluate(({ app }) => app.exit(0));
    app = await launchDesktop(user);
    page = await app.firstWindow();
    await expect(page.locator(".monaco-editor")).toContainText("retained external deletion edits");
    await expect(readFile(join(root, "folder/dirty.txt"))).rejects.toThrow();
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("generated tree loads only expanded directories and stays navigable", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-47-large-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  const started = performance.now();
  for (let i = 0; i < 200; i++) {
    const dir = join(root, `folder-${String(i).padStart(3, "0")}`);
    await mkdir(dir);
    await Promise.all(Array.from({ length: 100 }, (_, j) => writeFile(join(dir, `file-${j}.txt`), "generated\n")));
  }
  console.log(`GENERATED 200 directories / 20000 files in ${(performance.now() - started).toFixed(0)}ms`);
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      const fs = process.getBuiltinModule("fs") as any, watch = fs.watch;
      (globalThis as any).watched = new Set();
      fs.watch = (...args: any[]) => {
        const watcher = watch(...args);
        (globalThis as any).watched.add(args[0]);
        const close = watcher.close.bind(watcher);
        watcher.close = () => { (globalThis as any).watched.delete(args[0]); close(); };
        return watcher;
      };
    }, root);
    const opened = performance.now();
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("treeitem")).toHaveCount(200);
    await expect.poll(() => app.evaluate(() => [...(globalThis as any).watched])).toEqual([root]);
    console.log(`LARGE root visible ${(performance.now() - opened).toFixed(0)}ms; 200 rows`);
    const expanded = performance.now();
    await page.getByRole("treeitem", { name: "folder-000", exact: true }).locator(":scope > .tree-row").click();
    await expect(page.getByRole("treeitem")).toHaveCount(300);
    console.log(`LARGE expand ${(performance.now() - expanded).toFixed(0)}ms; 300 rows`);
    await expect.poll(() => app.evaluate(() => [...(globalThis as any).watched].sort())).toEqual([root, join(root, "folder-000")].sort());
    const navigation = performance.now();
    await page.getByRole("tree", { name: "Files", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    console.log(`LARGE two arrow keys ${(performance.now() - navigation).toFixed(0)}ms`);
    const external = performance.now();
    await writeFile(join(root, "folder-000/external.txt"), "external");
    await expect(page.getByRole("treeitem", { name: "external.txt", exact: true })).toBeVisible();
    console.log(`LARGE external notification to visible ${(performance.now() - external).toFixed(0)}ms`);
  } finally {
    await app.evaluate(({ app }) => app.exit(0));
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("watch failure stays usable, focus retries, checkout switch disposes, replaced root retains editor", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-47-fallback-")));
  const root = join(base, "repo"), other = join(base, "other");
  for (const path of [root, other]) execFileSync("git", ["init", path]);
  await writeFile(join(root, "work.txt"), "original");
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(() => {
      const fs = process.getBuiltinModule("fs") as any;
      (globalThis as any).originalWatch = fs.watch;
      fs.watch = () => { throw Error("EMFILE test subscription failure"); };
    });
    const open = async (path: string) => {
      await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, path);
      await page.getByRole("button", { name: "Open project…" }).click();
    };
    await open(root);
    await expect(page.getByRole("treeitem", { name: "work.txt", exact: true })).toBeVisible();
    await expect(page.getByText(/Automatic Files updates unavailable:/)).toContainText("EMFILE");
    await writeFile(join(root, "fallback.txt"), "fallback");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "fallback.txt", exact: true })).toBeVisible();
    await expect(page.getByText(/Automatic Files updates unavailable:/)).toContainText("EMFILE");
    await app.evaluate(() => { (process.getBuiltinModule("fs") as any).watch = (globalThis as any).originalWatch; });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText(/Automatic Files updates unavailable:/)).toHaveCount(0);
    await writeFile(join(root, "automatic.txt"), "automatic");
    await expect(page.getByRole("treeitem", { name: "automatic.txt", exact: true })).toBeVisible();
    await app.evaluate(({ webContents }) => {
      (globalThis as any).heldChanges = [];
      for (const contents of webContents.getAllWebContents()) {
        const send = contents.send.bind(contents);
        contents.send = (channel, ...args) => {
          if (channel === "files-changed") (globalThis as any).heldChanges.push(() => send(channel, ...args));
          else send(channel, ...args);
        };
      }
    });
    await writeFile(join(root, "delayed-origin.txt"), "delayed");
    await expect.poll(() => app.evaluate(() => (globalThis as any).heldChanges.length)).toBeGreaterThan(0);
    await open(other);
    await app.evaluate(() => { for (const send of (globalThis as any).heldChanges.splice(0)) send(); });
    await expect(page.getByRole("treeitem", { name: "delayed-origin.txt", exact: true })).toHaveCount(0);
    await writeFile(join(root, "old-checkout.txt"), "old");
    await expect(page.getByRole("treeitem", { name: "old-checkout.txt", exact: true })).toHaveCount(0);
    await open(root);
    await expect(page.getByRole("treeitem", { name: "old-checkout.txt", exact: true })).toBeVisible();
    await page.locator('[data-path="work.txt"] > .tree-row').click();
    await page.locator(".monaco-editor textarea").focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("keep work across root replacement");
    await rename(root, root + "-original");
    await mkdir(root);
    await writeFile(join(root, "foreign.txt"), "outside replacement");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText(/Checkout:.*replaced/)).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "foreign.txt", exact: true })).toHaveCount(0);
    await expect(page.locator(".monaco-editor")).toContainText("keep work across root replacement");
    await page.screenshot({ path: "test-results/files-watch-replaced-root.png" });
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
