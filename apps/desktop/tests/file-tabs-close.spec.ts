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
    await expect(page.getByRole("textbox", { name: file + " editor", exact: true })).toBeFocused();
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
    if (!page.isClosed()) {
      const exited = app.waitForEvent("close");
      app.process().kill("SIGKILL");
      await exited;
    }
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
    await expect(f.page.getByRole("menuitem", { name: "Keep Open", exact: true })).toBeFocused();
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


test("preview close clears persisted identity and batch Cancel retains promoted edits and clean preview", async () => {
  const f = await fixture();
  try {
    await f.open("a.txt"); await f.edit("retained A");
    await f.page.getByRole("treeitem", { name: "b.txt", exact: true }).click();
    await expect(f.tab("b.txt")).toHaveAccessibleDescription("Preview");
    await f.choices([2]);
    await f.tab("b.txt").click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Close All", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt", "b.txt"]);
    await expect(f.tab("b.txt")).toHaveAccessibleDescription("Preview");
    await f.page.getByRole("button", { name: "Close b.txt", exact: true }).click();
    await expect(f.tab("a.txt")).toHaveAttribute("aria-selected", "true");
    const state = () => readFile(join(f.dir, "user/client-workspace-v1.json"), "utf8").then(JSON.parse);
    await expect.poll(async () => (await state()).views[f.root]?.preview).toBe("");
    await f.page.getByRole("treeitem", { name: "c.txt", exact: true }).click();
    await expect(f.tab("c.txt")).toHaveAccessibleDescription("Preview");
    await f.page.getByRole("treeitem", { name: "d.txt", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt", "d.txt"]);
    await f.choices([1]);
    await f.tab("d.txt").click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Close All", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveCount(0);
    await expect.poll(async () => (await state()).views[f.root]?.preview).toBe("");
    await f.page.reload();
    await expect(f.tabs.getByRole("tab")).toHaveCount(0);
    expect(await readFile(join(f.root, "a.txt"), "utf8")).toBe("a.txt");
  } finally { await f.cleanup(); }
});

test("reopen single close reads current disk after Discard and focuses the editor", async () => {
  const f = await fixture();
  try {
    await f.open("a.txt"); await f.edit("discarded secret");
    await f.choices([1]);
    await f.page.keyboard.press("Meta+w");
    await expect(f.tabs.getByRole("tab")).toHaveCount(0);
    await writeFile(join(f.root, "a.txt"), "current disk A");
    await f.page.keyboard.press("Meta+Shift+t");
    await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt"]);
    await expect(f.page.locator(".monaco-editor:visible")).toContainText("current disk A");
    await expect(f.page.getByRole("textbox", { name: "a.txt editor", exact: true })).toBeFocused();
    expect(await readFile(join(f.root, "a.txt"), "utf8")).toBe("current disk A");
  } finally { await f.cleanup(); }
});

for (const command of ["Close Others", "Close to the Right", "Close All"]) {
  test(`reopen ${command} as one ordered batch, preserving reused dirty buffers and views`, async () => {
    const f = await fixture();
    try {
      await f.open("a.txt"); await f.open("b.txt"); await f.open("c.txt"); await f.open("d.txt");
      await f.page.getByRole("button", { name: "Source Control", exact: true }).click();
      await f.page.getByRole("button", { name: "c.txt", exact: true }).click();
      await expect(f.page.getByRole("combobox", { name: "File view" })).toHaveValue("untracked");
      await f.tab("b.txt").click({ button: "right" });
      await f.page.getByRole("menuitem", { name: command, exact: true }).click();
      await expect(f.tabs.getByRole("tab")).toHaveCount(command === "Close All" ? 0 : command === "Close Others" ? 1 : 2);
      await f.page.getByRole("button", { name: "Files", exact: true }).click();
      await f.open("d.txt"); await f.edit("reused dirty D");
      await f.page.keyboard.press("Meta+Shift+t");
      await expect(f.tabs.getByRole("tab")).toHaveCount(4);
      // Existing files keep their position; new references regain their captured positions.
      await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt", "b.txt", "c.txt", "d.txt"]);
      await expect(f.tab("c.txt")).toHaveAttribute("aria-selected", "true");
      await expect(f.page.getByRole("combobox", { name: "File view" })).toHaveValue("untracked");
      await expect(f.page.getByRole("textbox", { name: "untracked · c.txt modified", exact: true })).toBeFocused();
      await f.tab("d.txt").click();
      await expect(f.page.getByRole("textbox", { name: "d.txt editor", exact: true })).toBeVisible();
      await expect(f.page.locator(".monaco-editor:visible")).toContainText("reused dirty D");
      await f.page.keyboard.press("Meta+Shift+t");
      await expect(f.tabs.getByRole("tab")).toHaveCount(4);
    } finally { await f.cleanup(); }
  });
}

test("reopen retains missing exact targets and history excludes preview replacement and restart", async () => {
  const f = await fixture();
  try {
    await f.open("a.txt");
    await f.page.keyboard.press("Meta+w");
    await expect(f.tabs.getByRole("tab")).toHaveCount(0);
    await f.page.getByRole("treeitem", { name: "b.txt", exact: true }).click();
    await f.page.getByRole("treeitem", { name: "c.txt", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveText(["c.txt"]);
    await rm(join(f.root, "a.txt"));
    await f.page.getByRole("treeitem", { name: "c.txt", exact: true }).focus();
    await f.page.keyboard.press("Meta+Shift+t");
    await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt", "c.txt"]);
    await expect(f.tab("a.txt")).toHaveAttribute("aria-selected", "true");
    await expect(f.page.getByRole("button", { name: "Retry file", exact: true })).toBeVisible();
    await expect(f.tab("c.txt")).toHaveAccessibleDescription("Preview");
    await expect(f.page.getByRole("region", { name: "Main editor" })).toBeFocused();
    await f.page.keyboard.press("Meta+w");
    await expect(f.tabs.getByRole("tab")).toHaveText(["c.txt"]);
    await expect.poll(async () => JSON.parse(await readFile(join(f.dir, "user/client-workspace-v1.json"), "utf8")).views[f.root].openFiles).toEqual(["c.txt"]);
    await f.app.close();
    const restarted = await launchDesktop(join(f.dir, "user"));
    try {
      const page = await restarted.firstWindow();
      const tabs = page.getByRole("tablist", { name: "Open files" });
      await expect(tabs.getByRole("tab")).toHaveText(["c.txt"]);
      await page.keyboard.press("Meta+Shift+t");
      await expect(tabs.getByRole("tab")).toHaveText(["c.txt"]);
    } finally { await restarted.close(); }
  } finally { await f.cleanup(); }
});

test("reopen keeps twenty complete actions and evicts the oldest batch", async () => {
  test.setTimeout(120000);
  const f = await fixture();
  try {
    await f.open("a.txt"); await f.open("c.txt");
    await f.tab("a.txt").click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Close All", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveCount(0);
    for (let i = 0; i < 20; i++) {
      await f.open("b.txt");
      await f.page.keyboard.press("Meta+w");
      await expect(f.page.getByRole("region", { name: "Main editor" })).toBeFocused();
      await expect(f.tabs.getByRole("tab")).toHaveCount(0);
    }
    for (let i = 0; i < 20; i++) {
      await f.page.keyboard.press("Meta+Shift+t");
      await expect(f.page.getByRole("textbox", { name: "b.txt editor", exact: true })).toBeFocused();
      await expect(f.page.getByRole("button", { name: "Close file", exact: true })).toBeEnabled();
    }
    await f.page.keyboard.press("Meta+Shift+t");
    await expect(f.tabs.getByRole("tab")).toHaveText(["b.txt"]);
  } finally { await f.cleanup(); }
});

test("reopen respects input, Chats and Agents scope and retains normal cursor position", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "a.txt"), "first\nsecond\nthird");
    await f.open("a.txt");
    await f.page.keyboard.press("Meta+Home");
    await f.page.keyboard.press("ArrowDown");
    await f.page.keyboard.press("Meta+ArrowRight");
    await f.page.keyboard.press("Meta+w");
    await expect(f.page.getByRole("region", { name: "Main editor" })).toBeFocused();
    await f.open("b.txt");
    await f.page.getByRole("combobox", { name: "File view" }).focus();
    await f.page.keyboard.press("Meta+Shift+t");
    await expect(f.tabs.getByRole("tab")).toHaveText(["b.txt"]);
    await f.page.getByRole("button", { name: "Chats", exact: true }).click();
    await f.page.keyboard.press("Meta+Shift+t");
    await f.page.getByRole("button", { name: "Agents", exact: true }).click();
    await f.page.keyboard.press("Meta+Shift+t");
    await f.page.getByRole("button", { name: "repo", exact: true }).click();
    await f.page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveText(["b.txt"]);
    await f.page.getByRole("treeitem", { name: "b.txt", exact: true }).focus();
    await f.page.keyboard.press("Meta+Shift+t");
    await expect(f.page.getByRole("textbox", { name: "a.txt editor", exact: true })).toBeFocused();
    await f.page.keyboard.type("HERE");
    await f.page.keyboard.press("Meta+s");
    await expect.poll(() => readFile(join(f.root, "a.txt"), "utf8")).toBe("first\nsecondHERE\nthird");
    await expect(f.page.getByRole("button", { name: "Save ⌘S", exact: true })).toBeEnabled();
  } finally { await f.cleanup(); }
});

test("filesystem rename and project closure do not add close actions", async () => {
  const f = await fixture();
  try {
    await f.open("a.txt");
    await f.page.keyboard.press("Meta+w");
    await expect(f.page.getByRole("region", { name: "Main editor" })).toBeFocused();
    await f.open("b.txt");
    await f.page.getByRole("treeitem", { name: "b.txt", exact: true }).click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const input = f.page.getByRole("textbox", { name: "Rename b.txt", exact: true });
    await input.fill("renamed.txt");
    await input.press("Enter");
    await expect(f.tab("renamed.txt")).toBeVisible();
    await expect(f.page.getByRole("button", { name: "Close file", exact: true })).toBeEnabled();
    await f.page.getByRole("button", { name: "Close repo project", exact: true }).click();
    await expect(f.page.getByRole("button", { name: "Close repo project", exact: true })).toHaveCount(0);
    await f.page.getByRole("button", { name: "Open project…", exact: true }).click();
    await expect(f.tab("renamed.txt")).toBeVisible();
    await f.page.getByRole("treeitem", { name: "renamed.txt", exact: true }).focus();
    await f.page.keyboard.press("Meta+Shift+t");
    await expect(f.tabs.getByRole("tab")).toHaveText(["a.txt", "renamed.txt"]);
    await expect(f.tab("a.txt")).toHaveAttribute("aria-selected", "true");
    expect(await readFile(join(f.root, "renamed.txt"), "utf8")).toBe("b.txt");
  } finally { await f.cleanup(); }
});

test("native Trash does not create a reopen action or recreate its file", async () => {
  const f = await fixture();
  try {
    await f.app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      const cp = process.getBuiltinModule("child_process") as any, execute = cp.execFileSync;
      (globalThis as any).trashFixtures = [];
      cp.execFileSync = (...args: any[]) => {
        const value = execute(...args);
        if (args[1]?.[0] === "trash") (globalThis as any).trashFixtures.push(value.toString());
        return value;
      };
    });
    await f.open("b.txt");
    await f.page.getByRole("treeitem", { name: "b.txt", exact: true }).click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
    await expect(f.tabs.getByRole("tab")).toHaveCount(0);
    await expect(f.page.getByRole("button", { name: "New File", exact: true })).toBeEnabled();
    await f.page.getByRole("tree", { name: "Files", exact: true }).focus();
    await f.page.keyboard.press("Meta+Shift+t");
    await expect(f.tabs.getByRole("tab")).toHaveCount(0);
    await expect(readFile(join(f.root, "b.txt"), "utf8")).rejects.toThrow();
  } finally {
    for (const path of await f.app.evaluate(() => (globalThis as any).trashFixtures ?? []))
      await rm(path, { recursive: true, force: true });
    await f.cleanup();
  }
});
