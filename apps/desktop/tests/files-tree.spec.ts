import { readRecoveryFixture } from "./desktop";
import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("lazy tree keyboard, independent selection, menus, refresh and restart recovery", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-tree-ui-")));
  const root = join(base, "repo"),
    user = join(base, "user");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "folder/deep"), { recursive: true });
  await writeFile(join(root, "folder/deep/nested.txt"), "nested disk");
  await mkdir(join(root, "empty"));
  await writeFile(join(root, "a.txt"), "disk a");
  await writeFile(join(root, "b.txt"), "disk b");
  let app = await launchDesktop(user);
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    let tree = page.getByRole("tree", { name: "Files", exact: true });
    await expect(tree.getByRole("treeitem")).toHaveText(["empty", "folder", "a.txt", "b.txt"]);
    await expect(page.getByRole("treeitem", { name: "nested.txt" })).toHaveCount(0);
    await tree.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await expect(tree).toContainText("Empty folder");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("treeitem", { name: "deep", exact: true })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("treeitem", { name: "nested.txt" })).toHaveAttribute(
      "aria-level",
      "3",
    );
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect(tree).toBeFocused();
    await expect(page.locator(".toolbar")).toContainText("folder/deep/nested.txt");
    await page.keyboard.press("Meta+ArrowDown");
    await expect(page.locator(".monaco-editor textarea")).toBeFocused();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("unsaved nested");
    await tree.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(tree.locator('[aria-selected="true"]')).toHaveCount(2);
    await expect(page.locator(".toolbar")).toContainText("folder/deep/nested.txt");
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click({ button: "right" });
    await expect(tree.locator('[aria-selected="true"]')).toHaveCount(2);
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tree).toBeFocused();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+a");
    await expect(tree.locator('[aria-selected="true"]')).toHaveCount(6);
    await page.keyboard.press("b");
    await expect(page.getByRole("treeitem", { name: "b.txt" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click({ modifiers: ["Meta"] });
    await expect(tree.locator('[aria-selected="true"]')).toHaveCount(2);
    await expect(page.locator(".toolbar")).toContainText("folder/deep/nested.txt");
    await page
      .getByRole("treeitem", { name: "b.txt", exact: true })
      .click({ modifiers: ["Shift"] });
    await expect(tree.locator('[aria-selected="true"]')).toHaveCount(2);
    await writeFile(join(root, "folder/deep/restored.txt"), "restored");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "restored.txt" })).toBeVisible();
    await expect(page.locator(".monaco-editor")).toContainText("unsaved nested");
    await expect
      .poll(
        async () =>
          JSON.parse(await readRecoveryFixture(join(user, "client-workspace-v1.json"), "utf8")).views[root]?.files?.focus,
      )
      .toBe("b.txt");
    app.process().kill("SIGKILL");
    await new Promise((resolve) => app.process().once("exit", resolve));
    await rm(join(user, "durable-chats-v1.sqlite-state-v1/receipts/owner.lock"), { force: true });
    app = await launchDesktop(user);
    page = await app.firstWindow();
    tree = page.getByRole("tree", { name: "Files", exact: true });
    await expect(page.getByRole("treeitem", { name: "restored.txt" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "b.txt" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(".monaco-editor")).toContainText("unsaved nested");
    await page.screenshot({ path: "test-results/files-tree-nested.png" });
    await page.getByRole("button", { name: "Collapse All" }).click();
    await expect(page.getByRole("treeitem", { name: "nested.txt" })).toHaveCount(0);
    await expect(page.locator(".monaco-editor")).toContainText("unsaved nested");
    await expect(page.getByRole("treeitem", { name: ".git", exact: true })).toHaveCount(0);
  } finally {
    if (app.process().exitCode === null) {
      app.process().kill("SIGKILL");
      await new Promise((resolve) => app.process().once("exit", resolve));
    }
    await rm(base, { recursive: true, force: true });
  }
});

test("cached directories reopen without reloading; explicit refresh recovers and scroll stays per project", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-tree-cache-")));
  const root = join(base, "repo"),
    other = join(base, "other"),
    user = join(base, "user");
  for (const path of [root, other]) execFileSync("git", ["init", path]);
  await mkdir(join(root, "folder/deep"), { recursive: true });
  await writeFile(join(root, "folder/deep/a.txt"), "nested");
  await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      writeFile(join(root, `file-${String(i).padStart(3, "0")}.txt`), "disk"),
    ),
  );
  let app = await launchDesktop(user);
  try {
    let page = await app.firstWindow();
    await app.evaluate(() => {
      const cp = process.getBuiltinModule("child_process") as any,
        original = cp.execFileSync;
      (globalThis as any).lists = [];
      cp.execFileSync = (...args: any[]) => {
        if (args[1]?.[0] === "list") {
          (globalThis as any).lists.push(args[1][1]);
          if ((globalThis as any).denyDeep && args[1][1] === "folder/deep")
            throw Error("ENOENT fixture");
          if ((globalThis as any).denyFolder && args[1][1] === "folder")
            throw Error("Permission denied fixture");
        }
        return original(...args);
      };
    });
    const open = async (path: string) => {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      }, path);
      await page.getByRole("button", { name: "Open project…" }).click();
      await expect(page.locator(".view-nav:visible")).toContainText(path);
    };
    await open(root);
    await expect(page.getByRole("tree", { name: "Files", exact: true })).toHaveAttribute("data-row-count", "101");
    expect(await page.getByRole("treeitem").count()).toBeLessThan(101);
    expect(new Set(await app.evaluate(() => (globalThis as any).lists))).toEqual(new Set(["."]));
    const folder = page
      .getByRole("treeitem", { name: "folder", exact: true })
      .locator(":scope > .tree-row");
    await folder.click();
    await expect(page.getByRole("treeitem", { name: "deep", exact: true })).toBeVisible();
    expect(new Set(await app.evaluate(() => (globalThis as any).lists))).toEqual(new Set([".", "folder"]));
    // Wait for watch readiness to close the initial listing/subscription gap.
    await expect.poll(async () => (await app.evaluate(() => (globalThis as any).lists as string[])).filter(path => path === "folder").length).toBeGreaterThanOrEqual(2);
    const beforeReopen = (await app.evaluate(() => (globalThis as any).lists as string[])).filter(path => path === "folder").length;
    await folder.click();
    await folder.click();
    await expect(page.getByRole("treeitem", { name: "deep", exact: true })).toBeVisible();
    // Cached reopening is immediate; explicit Refresh below handles missed notifications.
    expect((await app.evaluate(() => (globalThis as any).lists as string[])).filter((path) => path === "folder").length).toBe(beforeReopen);
    await app.evaluate(() => {
      (globalThis as any).denyFolder = true;
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Permission denied fixture" }),
    ).toContainText("Use Refresh to retry");
    await app.evaluate(() => {
      (globalThis as any).denyFolder = false;
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "deep", exact: true })).toBeVisible();
    // Deliberately miss notifications to exercise explicit recovery and directory errors.
    await app.evaluate((_electron, root) => {
      const fs = process.getBuiltinModule("fs") as any;
      const probe = fs.watch(root), prototype = Object.getPrototypeOf(probe), emit = prototype.emit;
      probe.close();
      prototype.emit = function(event: string, ...args: any[]) {
        if (event === "change") {
          return false;
        }
        return emit.call(this, event, ...args);
      };
    }, root);
    // Fail the requested listing before deleting: a readiness rescan may otherwise prune the click target.
    await app.evaluate(() => { (globalThis as any).denyDeep = true; });
    await page.getByRole("treeitem", { name: "deep", exact: true }).click();
    await expect(treeStatus()).toContainText("ENOENT fixture");
    await rm(join(root, "folder/deep"), { recursive: true });
    function treeStatus() {
      return page.getByRole("tree", { name: "Files", exact: true }).getByRole("status");
    }
    await rm(join(root, "folder"), { recursive: true });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "folder", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("tree", { name: "Files", exact: true }).locator('[aria-selected="true"]'),
    ).toHaveCount(0);
    await mkdir(join(root, "folder"));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page
      .getByRole("treeitem", { name: "folder", exact: true })
      .locator(":scope > .tree-row")
      .click();
    await expect(page.getByText("Empty folder", { exact: true })).toBeVisible();
    const tree = page.getByRole("tree", { name: "Files", exact: true });
    await tree.focus();
    await page.keyboard.press("End");
    await expect.poll(() => tree.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    const scroll = await tree.evaluate((el) => el.scrollTop);
    await expect
      .poll(
        async () =>
          JSON.parse(await readRecoveryFixture(join(user, "client-workspace-v1.json"), "utf8")).views[root].files.scroll,
      )
      .toBe(scroll);
    await open(other);
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: "repo", exact: true })
      .click();
    await expect(tree).toHaveAttribute("aria-activedescendant", root + ":file-099.txt");
    expect(await tree.evaluate((el) => el.scrollTop)).toBe(scroll);
    await expect
      .poll(async () => {
        const state = JSON.parse(await readRecoveryFixture(join(user, "client-workspace-v1.json"), "utf8"));
        return state.selected === root && state.views[root].files.scroll === scroll;
      })
      .toBe(true);
    const rememberedAnchor = JSON.parse(await readRecoveryFixture(join(user, "client-workspace-v1.json"), "utf8")).views[root].files.scrollAnchor;
    const anchorOffset = await tree.locator(`[data-path="${rememberedAnchor.path}"]`).evaluate(el => el.getBoundingClientRect().top - el.closest("[role=tree]")!.getBoundingClientRect().top);
    app.process().kill("SIGKILL");
    await new Promise((resolve) => app.process().once("exit", resolve));
    await rm(join(user, "durable-chats-v1.sqlite-state-v1/receipts/owner.lock"), { force: true });
    app = await launchDesktop(user);
    page = await app.firstWindow();
    // Unmounted diagnostic rows use estimates after restart; preserve the visible identity and offset.
    const restoredAnchor = page.locator(`[data-path="${rememberedAnchor.path}"]`);
    await expect(restoredAnchor).toBeVisible();
    await expect.poll(async () => Math.abs(await restoredAnchor.evaluate(el => el.getBoundingClientRect().top - el.closest("[role=tree]")!.getBoundingClientRect().top) - anchorOffset)).toBeLessThan(1);
    await page.screenshot({ path: "test-results/files-tree.png" });
  } finally {
    if (app.process().exitCode === null) {
      app.process().kill("SIGKILL");
      await new Promise((resolve) => app.process().once("exit", resolve));
    }
    await rm(base, { recursive: true, force: true });
  }
});
