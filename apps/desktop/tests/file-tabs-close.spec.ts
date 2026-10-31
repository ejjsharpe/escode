import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-close-tabs-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  for (const file of ["a.txt", "b.txt", "c.txt", "d.txt"]) await writeFile(join(root, file), file);
  const app = await launchDesktop(join(dir, "user"));
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, root);
  await page.getByRole("button", { name: "Open project…" }).click();
  const tabs = page.getByRole("tablist", { name: "Open files" });
  const tab = (name: string) => tabs.getByRole("tab", { name, exact: true });
  const open = async (file: string) => {
    await page.getByRole("treeitem", { name: file, exact: true }).dblclick();
  };
  const edit = async (text: string) => {
    await page.locator(".monaco-editor:visible").last().click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type(text);
  };
  const choices = async (values: number[]) => {
    await app.evaluate(({ dialog }, values) => {
      (globalThis as any).closePrompts = [];
      dialog.showMessageBox = async (...args: any[]) => {
        const options = args.at(-1);
        (globalThis as any).closePrompts.push(options.message);
        return { response: values.shift() ?? 2, checkboxChecked: false };
      };
    }, values);
  };
  const cleanup = async () => {
    await choices([1, 1, 1]);
    await app.close();
    await rm(dir, { recursive: true, force: true });
  };
  return { dir, root, app, page, tabs, tab, open, edit, choices, cleanup };
}

test("captured context closes preserve inactive selection, use MRU and leave an empty focused workspace", async () => {
  const f = await fixture();
  try {
    await f.open("a.txt"); await f.open("b.txt"); await f.open("c.txt"); await f.open("d.txt");
    await f.tab("a.txt").click();
    await f.tab("b.txt").focus();
    await f.page.keyboard.press("Shift+F10");
    await expect(f.page.getByRole("menuitem", { name: "Close", exact: true })).toBeFocused();
    await f.page.keyboard.press("Escape");
    await expect(f.tab("b.txt")).toBeFocused();
    await f.tab("b.txt").click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Close", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt", "c.txt", "d.txt"]);
    await expect(f.tab("a.txt")).toHaveAttribute("aria-selected", "true");
    await f.page.getByRole("treeitem", { name: "b.txt", exact: true }).focus();
    await f.page.keyboard.press("Meta+w");
    await expect(f.tab("d.txt")).toHaveAttribute("aria-selected", "true");
    await expect(f.page.getByRole("textbox", { name: "d.txt editor", exact: true })).toBeFocused();
    await f.page.keyboard.press("Meta+w");
    await expect(f.tab("c.txt")).toHaveAttribute("aria-selected", "true");
    await f.page.keyboard.press("Meta+w");
    await expect(f.tabs.getByRole("tab")).toHaveCount(0);
    await expect(f.page.getByRole("region", { name: "Main editor" })).toBeFocused();
    await f.page.keyboard.press("Meta+w");
    await expect(f.page.getByRole("button", { name: "Files", exact: true })).toBeVisible();
  } finally { await f.cleanup(); }
});

test("batch close defers discards and tab removal after an earlier Save and later Cancel", async () => {
  const f = await fixture();
  try {
    await f.open("a.txt"); await f.edit("saved A");
    await f.open("b.txt"); await f.edit("discard proposed B");
    await f.open("c.txt"); await f.edit("cancel C");
    await f.choices([0, 1, 2]);
    await f.tab("b.txt").click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Close All", exact: true }).click();
    await expect(f.page.getByRole("textbox", { name: "c.txt editor", exact: true })).toBeFocused();
    await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt", "b.txt", "c.txt"]);
    await expect(f.page.locator(".toolbar:visible")).toContainText("Unsaved");
    expect(await f.app.evaluate(() => (globalThis as any).closePrompts)).toEqual([
      `Save changes to ${f.root}/a.txt?`, `Save changes to ${f.root}/b.txt?`, `Save changes to ${f.root}/c.txt?`,
    ]);
    expect(await readFile(join(f.root, "a.txt"), "utf8")).toBe("saved A");
    expect(await readFile(join(f.root, "b.txt"), "utf8")).toBe("b.txt");
    await f.tab("b.txt").click();
    await expect(f.page.locator(".monaco-editor:visible")).toContainText("discard proposed B");
    await f.tab("c.txt").click();
    await expect(f.page.locator(".monaco-editor:visible")).toContainText("cancel C");
    await f.choices([1]);
    // Right is relative to the inactive context target, not the active C.
    await f.tab("b.txt").click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Close to the Right", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt", "b.txt"]);
    await expect(f.tab("b.txt")).toHaveAttribute("aria-selected", "true");
    await f.choices([1]);
    await f.tab("a.txt").click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Close Others", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt"]);
    await expect(f.page.locator(".monaco-editor:visible")).toContainText("saved A");
  } finally { await f.cleanup(); }
});

test("failed persistence vetoes the whole close and retry preserves comparison shared text", async () => {
  const f = await fixture();
  try {
    await f.open("a.txt"); await f.edit("retained A");
    await f.open("b.txt"); await f.edit("retained B");
    await f.page.getByRole("button", { name: "Source Control", exact: true }).click();
    await f.page.getByRole("button", { name: "b.txt", exact: true }).click();
    await expect(f.page.getByRole("combobox", { name: "File view" })).toHaveValue("untracked");
    await f.choices([2]);
    await f.page.getByRole("button", { name: "b.txt", exact: true }).focus();
    await f.page.keyboard.press("Meta+w");
    await expect(f.page.getByRole("textbox", { name: "untracked · b.txt modified", exact: true })).toBeFocused();
    await expect(f.tabs.getByRole("tab")).toHaveCount(2);
    expect(await f.app.evaluate(() => (globalThis as any).closePrompts)).toEqual([`Save changes to ${f.root}/b.txt?`]);
    await expect.poll(async () => JSON.parse(await readFile(join(f.dir, "user/client-workspace-v1.json"), "utf8")).drafts.length).toBe(2);
    await f.app.evaluate(() => {
      const fs = process.getBuiltinModule("fs/promises") as any, rename = fs.rename;
      (globalThis as any).denyClosePersistence = true;
      (globalThis as any).closeWriteFailures = 0;
      fs.rename = async (...args: any[]) => {
        if ((globalThis as any).denyClosePersistence && String(args[1]).endsWith("/client-workspace-v1.json") &&
          ((globalThis as any).closeWriteFailures > 0 || Object.values(JSON.parse(await fs.readFile(args[0], "utf8")).views).some((view: any) => view.openFiles?.length === 0))) {
          (globalThis as any).closeWriteFailures++;
          throw Error("close persistence denied");
        }
        return rename(...args);
      };
    });
    await f.choices([1, 1]);
    await f.tab("a.txt").click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Close All", exact: true }).click();
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText("close persistence denied");
    await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt", "b.txt"]);
    await expect(f.page.locator(".modified-in-monaco-diff-editor:visible")).toContainText("retained B");
    expect(await readFile(join(f.root, "a.txt"), "utf8")).toBe("a.txt");
    await expect.poll(() => f.app.evaluate(() => (globalThis as any).closeWriteFailures)).toBeGreaterThanOrEqual(2);
    // Retry without a navigation/edit that would incidentally schedule recovery.
    await f.app.evaluate(() => { (globalThis as any).denyClosePersistence = false; });
    await f.choices([1, 1]);
    await f.tab("a.txt").click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Close All", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveCount(0);
    await expect.poll(async () => JSON.parse(await readFile(join(f.dir, "user/client-workspace-v1.json"), "utf8")).drafts).toEqual([]);
    await f.page.reload();
    await expect(f.tabs.getByRole("tab")).toHaveCount(0);
  } finally { await f.cleanup(); }
});

test("failed batch Save retains proposed discards and conflicts; Cmd+W respects input, Chats and Agents", async () => {
  const f = await fixture();
  try {
    await f.open("a.txt"); await f.edit("retain A");
    await f.open("b.txt"); await f.edit("retain B");
    await writeFile(join(f.root, "b.txt"), "external B");
    await f.choices([1, 0]);
    await f.tab("a.txt").click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Close All", exact: true }).click();
    await expect(f.page.getByRole("alert").filter({ hasText: "b.txt changed on disk" })).toBeVisible();
    await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt", "b.txt"]);
    expect(await readFile(join(f.root, "b.txt"), "utf8")).toBe("external B");
    await f.page.keyboard.press("Meta+w");
    await expect(f.tabs.getByRole("tab")).toHaveCount(2);
    await f.page.getByRole("button", { name: "Cancel", exact: true }).click();
    await f.tab("a.txt").click();
    await expect(f.page.locator(".monaco-editor:visible")).toContainText("retain A");
    await f.page.getByRole("combobox", { name: "File view" }).focus();
    await f.page.keyboard.press("Meta+w");
    await expect(f.tabs.getByRole("tab")).toHaveCount(2);
    await f.page.getByRole("button", { name: "Chats", exact: true }).click();
    await f.page.keyboard.press("Meta+w");
    await f.page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveCount(2);
    await f.page.getByRole("button", { name: "Agents", exact: true }).click();
    await f.page.keyboard.press("Meta+w");
    await f.page.getByRole("button", { name: "repo", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveCount(2);
    await f.choices([2]);
    await f.page.getByRole("button", { name: "Close file", exact: true }).click();
    await expect(f.page.locator(".monaco-editor:visible")).toContainText("retain A");
    await expect(f.tabs.getByRole("tab")).toHaveCount(2);
  } finally { await f.cleanup(); }
});

test("read-only comparisons without a working buffer close through the tab control", async () => {
  const f = await fixture();
  try {
    const git = (...args: string[]) => execFileSync("git", ["-C", f.root, ...args]);
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial");
    await rm(join(f.root, "a.txt"));
    await f.page.getByRole("button", { name: "Source Control", exact: true }).click();
    await f.page.getByRole("button", { name: "a.txt", exact: true }).click();
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText("Working file unavailable");
    await f.page.getByRole("button", { name: "Close a.txt", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveCount(0);
    await expect(f.page.getByRole("region", { name: "Main editor" })).toBeFocused();
  } finally { await f.cleanup(); }
});
