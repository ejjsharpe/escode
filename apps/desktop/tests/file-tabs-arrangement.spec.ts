import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("drag changes visual order and promotes only a preview moved to another position", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-tab-arrangement-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) await writeFile(join(root, name), name);
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    const tree = (name: string) => page.getByRole("treeitem", { name, exact: true });
    const tabs = page.getByRole("tablist", { name: "Open files" });
    const tab = (name: string) => tabs.getByRole("tab", { name, exact: true });
    await tree("a.txt").dblclick();
    await tree("b.txt").dblclick();
    await tree("c.txt").click();
    await expect(tab("c.txt")).toHaveAccessibleDescription("Preview");
    await tab("c.txt").dragTo(tab("a.txt"));
    await expect(tabs.getByRole("tab")).toHaveText(["c.txt", "a.txt", "b.txt"]);
    await expect(tab("c.txt")).not.toHaveAccessibleDescription("Preview");
    await tree("d.txt").click();
    await expect(tabs.getByRole("tab")).toHaveText(["c.txt", "d.txt", "a.txt", "b.txt"]);
    await tab("d.txt").dragTo(tab("d.txt"));
    await expect(tab("d.txt")).toHaveAccessibleDescription("Preview");
    await tab("c.txt").dragTo(tab("b.txt"));
    await expect(tabs.getByRole("tab")).toHaveText(["d.txt", "a.txt", "b.txt", "c.txt"]);
    await expect(tab("d.txt")).toHaveAccessibleDescription("Preview");
    await expect.poll(async () => JSON.parse(await readFile(join(dir, "user/client-workspace-v1.json"), "utf8")).views[root]?.openFiles).toEqual(["d.txt", "a.txt", "b.txt", "c.txt"]);
    await page.reload();
    await expect(tabs.getByRole("tab")).toHaveText(["d.txt", "a.txt", "b.txt", "c.txt"]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tabs disambiguate names, expose unsaved state and reveal the active file in overflow", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-tab-labels-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  for (const folder of ["left", "right"]) {
    await mkdir(join(root, folder));
    await writeFile(join(root, folder, "same.txt"), folder);
  }
  const names = Array.from({ length: 9 }, (_, i) => `long-file-name-${i}.txt`);
  for (const name of names) await writeFile(join(root, name), name);
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    const tabs = page.getByRole("tablist", { name: "Open files" });
    for (const folder of ["left", "right"]) {
      await page.getByRole("treeitem", { name: folder, exact: true }).click();
      await page.locator(`[role=treeitem][data-path="${folder}/same.txt"] > .tree-row`).dblclick();
      if (folder === "left") await expect(tabs.getByRole("tab")).toHaveText(["same.txt"]);
    }
    await expect(tabs.getByRole("tab")).toHaveText(["left/same.txt", "right/same.txt"]);
    await expect(tabs.getByRole("tab", { name: "right/same.txt", exact: true })).toHaveAttribute("title", root + "/right/same.txt");
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.type(" unsaved");
    await expect(tabs.getByRole("tab", { name: "right/same.txt", exact: true })).toHaveAccessibleDescription("Unsaved");
    for (const name of names) {
      await page.getByRole("treeitem", { name, exact: true }).dblclick();
      await expect(tabs.getByRole("tab", { name, exact: true })).not.toHaveAccessibleDescription("Preview");
    }
    await page.setViewportSize({ width: 650, height: 700 });
    const revealed = () => tabs.evaluate(row => {
      const tab = row.querySelector('[aria-selected="true"]')!;
      const r = row.getBoundingClientRect(), t = tab.getBoundingClientRect();
      return t.left >= r.left && t.right <= r.right;
    });
    await expect.poll(revealed).toBe(true);
    await tabs.getByRole("tab", { name: "left/same.txt", exact: true }).click();
    await expect.poll(revealed).toBe(true);
    await page.getByRole("treeitem", { name: names[8], exact: true }).click();
    await expect.poll(revealed).toBe(true);
    await expect(tabs.getByRole("tab")).toHaveCount(11);
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tab strip roves focus, opens the editor and restores focus from menus and close", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-tab-keys-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  for (const name of ["a.txt", "b.txt", "c.txt"]) await writeFile(join(root, name), name);
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    for (const name of ["a.txt", "b.txt", "c.txt"]) await page.getByRole("treeitem", { name, exact: true }).dblclick();
    const tabs = page.getByRole("tablist", { name: "Open files" });
    const tab = (name: string) => tabs.getByRole("tab", { name, exact: true });
    await expect(tab("a.txt")).toHaveAttribute("tabindex", "-1");
    await expect(tab("c.txt")).toHaveAttribute("tabindex", "0");
    await tab("c.txt").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab("a.txt")).toBeFocused();
    await expect(tab("a.txt")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(tab("c.txt")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tab("a.txt")).toBeFocused();
    await page.keyboard.press("End");
    await expect(tab("c.txt")).toBeFocused();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menuitem", { name: "Keep Open", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "Close All", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tab("c.txt")).toBeFocused();
    for (const key of ["Enter", "Space"]) {
      await tab("b.txt").focus();
      await page.keyboard.press(key);
      await expect.poll(() => page.locator(".monaco-editor:visible").evaluate(el => el.contains(document.activeElement))).toBe(true);
      await expect(tab("b.txt")).toHaveAttribute("aria-selected", "true");
    }
    await tab("a.txt").focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Close", exact: true }).click();
    await expect(tab("a.txt")).toHaveCount(0);
    await expect.poll(() => page.locator(".monaco-editor:visible").evaluate(el => el.contains(document.activeElement))).toBe(true);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
