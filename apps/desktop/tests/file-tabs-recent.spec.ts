import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("recent selection preserves the editor until release and Escape preserves view and recency", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-recent-tabs-")));
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
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.getByRole("button", { name: "c.txt", exact: true }).dblclick();
    await page.locator(".monaco-editor:visible").last().click();
    await page.keyboard.type(" unsaved");
    await expect(tab("c.txt")).toHaveAccessibleDescription("Unsaved");
    const picker = page.getByRole("listbox", { name: "Recent tabs" });
    await page.keyboard.down("Control");
    await page.keyboard.press("Tab");
    await expect(picker.getByRole("option")).toHaveText(["c.txt", "b.txt", "a.txt"]);
    await expect(picker.getByRole("option", { selected: true })).toHaveText("b.txt");
    await expect(tab("c.txt")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("combobox", { name: "File view" })).toHaveValue("untracked");
    await expect(tab("c.txt")).toHaveAccessibleDescription("Unsaved");
    await page.keyboard.press("Escape");
    await page.keyboard.up("Control");
    await expect(picker).toHaveCount(0);
    await expect(tab("c.txt")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => page.locator(".monaco-editor:visible").last().evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.down("Control");
    await page.keyboard.press("Tab");
    await expect(picker.getByRole("option")).toHaveText(["c.txt", "b.txt", "a.txt"]);
    await page.keyboard.press("Tab");
    await expect(picker.getByRole("option", { selected: true })).toHaveText("a.txt");
    await page.keyboard.press("Shift+Tab");
    await expect(picker.getByRole("option", { selected: true })).toHaveText("b.txt");
    await page.keyboard.up("Control");
    await expect(picker).toHaveCount(0);
    await expect(tab("b.txt")).toHaveAttribute("aria-selected", "true");
    await expect(tabs.getByRole("tab")).toHaveText(["a.txt", "b.txt", "c.txt"]);
    await expect.poll(() => page.locator(".monaco-editor:visible").evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.down("Control");
    await page.keyboard.press("Shift+Tab");
    await expect(picker.getByRole("option")).toHaveText(["b.txt", "c.txt", "a.txt"]);
    await expect(picker.getByRole("option", { selected: true })).toHaveText("a.txt");
    await page.keyboard.press("Escape");
    await page.keyboard.up("Control");
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("visual shortcuts reveal overflow, preserve order and keep strip focus meaningful", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-visual-tabs-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  const names = Array.from({ length: 9 }, (_, i) => `long-file-name-${i}.txt`);
  for (const name of names) await writeFile(join(root, name), name);
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    for (const name of names) await page.getByRole("treeitem", { name, exact: true }).dblclick();
    const tabs = page.getByRole("tablist", { name: "Open files" });
    const tab = (name: string) => tabs.getByRole("tab", { name, exact: true });
    await page.setViewportSize({ width: 650, height: 700 });
    await tab(names[8]!).focus();
    await page.keyboard.press("Meta+Alt+ArrowRight");
    await expect(tab(names[0]!)).toHaveAttribute("aria-selected", "true");
    await expect(tab(names[0]!)).toBeFocused();
    const revealed = () => tabs.evaluate(row => {
      const r = row.getBoundingClientRect();
      const t = row.querySelector('[aria-selected="true"]')!.closest(".file-tab")!.getBoundingClientRect();
      return t.left >= r.left && t.right <= r.right;
    });
    await expect.poll(revealed).toBe(true);
    await page.keyboard.press("Meta+Alt+ArrowLeft");
    await expect(tab(names[8]!)).toHaveAttribute("aria-selected", "true");
    await expect(tab(names[8]!)).toBeFocused();
    await expect.poll(revealed).toBe(true);
    await page.getByRole("tree").focus();
    await page.keyboard.press("Meta+Alt+ArrowLeft");
    await expect(tab(names[7]!)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => page.locator(".monaco-editor:visible").evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expect(tabs.getByRole("tab")).toHaveText(names);
    await page.keyboard.down("Control");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("listbox", { name: "Recent tabs" }).getByRole("option", { selected: true })).toHaveText(names[8]!);
    await page.screenshot({ path: test.info().outputPath("recent-tabs-narrow.png") });
    await page.keyboard.press("Escape");
    await page.keyboard.up("Control");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("navigation respects empty rows, inputs, inline editing, menus, conflicts and hidden workspaces", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-tabs-scope-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  for (const name of ["a.txt", "b.txt"]) await writeFile(join(root, name), name);
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    const picker = page.getByRole("listbox", { name: "Recent tabs" });
    const tabs = page.getByRole("tablist", { name: "Open files" });
    const commands = async () => {
      await page.keyboard.press("Control+Tab");
      await page.keyboard.press("Control+Shift+Tab");
      await page.keyboard.press("Meta+Alt+ArrowLeft");
      await page.keyboard.press("Meta+Alt+ArrowRight");
      await expect(picker).toHaveCount(0);
    };
    await commands();
    await expect(tabs.getByRole("tab")).toHaveCount(0);
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).dblclick();
    await expect(page.getByRole("textbox", { name: "a.txt editor", exact: true })).toBeFocused();
    await page.getByRole("tree").focus();
    await page.keyboard.down("Control");
    await page.keyboard.press("Tab");
    await expect(picker.getByRole("option", { selected: true })).toHaveText("a.txt");
    await page.keyboard.press("Escape");
    await page.keyboard.up("Control");
    await expect(page.getByRole("tree")).toBeFocused();
    await page.getByRole("treeitem", { name: "b.txt", exact: true }).click();
    const selected = tabs.getByRole("tab", { name: "b.txt", exact: true });
    await page.getByRole("combobox", { name: "File view" }).focus();
    await commands();
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "New File", exact: true }).click();
    await page.getByRole("textbox", { name: "New file name", exact: true }).fill("pending.txt");
    await commands();
    await expect(page.getByRole("textbox", { name: "New file name", exact: true })).toHaveValue("pending.txt");
    await page.getByRole("textbox", { name: "New file name", exact: true }).press("Escape");
    await selected.focus();
    await page.keyboard.press("Shift+F10");
    await commands();
    await expect(page.getByRole("menu", { name: "File tab actions for b.txt" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await commands();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await commands();
    await page.getByRole("button", { name: "repo", exact: true }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await expect(selected).toHaveAccessibleDescription("Preview");
    await selected.focus();
    await page.keyboard.down("Control");
    await page.keyboard.press("Tab");
    await expect(picker).toBeFocused();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.keyboard.up("Control");
    await expect(picker).toHaveCount(0);
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.type(" dirty");
    await writeFile(join(root, "b.txt"), "external");
    await page.keyboard.press("Meta+s");
    await expect(page.getByRole("alert").filter({ hasText: "b.txt changed on disk" })).toBeVisible();
    await commands();
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("recent commit to a read-only comparison leaves meaningful focus", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-recent-readonly-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "original");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial"]);
  await writeFile(join(root, "a.txt"), "staged");
  execFileSync("git", ["-C", root, "add", "."]);
  await rm(join(root, "a.txt"));
  await writeFile(join(root, "b.txt"), "other");
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.locator("aside section").filter({ has: page.getByRole("heading", { name: "staged", exact: true }) }).getByRole("button", { name: "a.txt", exact: true }).dblclick();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("treeitem", { name: "b.txt", exact: true }).dblclick();
    await expect(page.getByRole("tab", { name: "b.txt", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".monaco-editor:visible")).toHaveCount(1);
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Control+Tab");
    await expect(page.getByRole("tab", { name: "a.txt", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("region", { name: "Main editor" })).toBeFocused();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
