import { readRecoveryFixture } from "./desktop";
import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("file tabs reuse dirty buffers and insert to the right without reordering existing files", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-file-tabs-")));
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
    const treeFile = (name: string) => page.getByRole("treeitem", { name, exact: true });
    const tabs = page.getByRole("tablist", { name: "Open files" });
    await treeFile("a.txt").click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("retained draft");
    await treeFile("b.txt").dblclick();
    await tabs.getByRole("tab", { name: "a.txt", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("retained draft");
    await treeFile("c.txt").dblclick();
    await expect(tabs.getByRole("tab")).toHaveText(["a.txt", "c.txt", "b.txt"]);
    await treeFile("b.txt").click();
    await expect(tabs.getByRole("tab")).toHaveText(["a.txt", "c.txt", "b.txt"]);
    await expect(tabs.getByRole("tab", { name: "b.txt", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect.poll(async () => JSON.parse(await readRecoveryFixture(join(dir, "user/client-workspace-v1.json"), "utf8")).views[root]?.openFiles).toEqual(["a.txt", "c.txt", "b.txt"]);
    await expect.poll(async () => JSON.parse(await readRecoveryFixture(join(dir, "user/client-workspace-v1.json"), "utf8")).views[root]?.path).toBe("b.txt");
    await page.reload();
    await expect(tabs.getByRole("tab")).toHaveText(["a.txt", "c.txt", "b.txt"]);
    await expect(tabs.getByRole("tab", { name: "b.txt", exact: true })).toHaveAttribute("aria-selected", "true");
    await tabs.getByRole("tab", { name: "a.txt", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("retained draft");
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed and delayed opens retain the newer file and its edits", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-file-races-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "a baseline");
  await writeFile(join(root, "slow.txt"), "delayed document");
  await writeFile(join(root, "binary.txt"), Buffer.from([0, 1, 2]));
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(() => {
      const events = process.getBuiltinModule("events");
      const emit = events.EventEmitter.prototype.emit;
      events.EventEmitter.prototype.emit = function(event: string, ...args: any[]) {
        if (event === "message" && typeof (this as any).send === "function" && !(this as any).heldFileResponse) {
          const socket = this as any, send = socket.send;
          socket.heldFileResponse = true;
          socket.send = function(...values: any[]) {
            if (Buffer.from(values[0]).toString().includes("delayed document")) {
              (globalThis as any).releaseFile = () => send.apply(socket, values);
            } else return send.apply(socket, values);
          };
        }
        return emit.call(this, event, ...args);
      };
    });
    await page.reload();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.getByRole("treeitem", { name: "binary.txt", exact: true }).click();
    await expect(page.locator(".content:visible > p[role=status]")).toContainText("binary");
    await expect(page.getByRole("tab", { name: "a.txt", exact: true })).toHaveAccessibleDescription("Preview");
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveCount(1);
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("my edits");
    await page.getByRole("treeitem", { name: "slow.txt", exact: true }).click();
    await expect.poll(() => app.evaluate(() => typeof (globalThis as any).releaseFile)).toBe("function");
    await page.getByRole("tab", { name: "a.txt", exact: true }).click();
    await app.evaluate(() => (globalThis as any).releaseFile());
    // The next host read finishes after the delayed read, so its error is also a response barrier.
    await page.getByRole("treeitem", { name: "binary.txt", exact: true }).click();
    await expect(page.locator(".content:visible > p[role=status]")).toContainText("binary");
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveText(["a.txt"]);
    await expect(page.getByRole("tab", { name: "a.txt", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".monaco-editor:visible")).toContainText("my edits");
    // A failed comparison must preserve the current editor as well.
    await page.getByRole("button", { name: "Diff", exact: true }).click();
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
    await expect(page.locator(".toolbar:visible")).toContainText("untracked · a.txt");
    await page.getByRole("button", { name: "binary.txt", exact: true }).click();
    await expect(page.locator(".content:visible > p[role=status]")).toContainText("binary");
    expect(await page.locator(".toolbar:visible").innerText()).toContain("untracked · a.txt");
    expect(await page.locator(".modified-in-monaco-diff-editor:visible").count()).toBe(1);
    await expect(page.locator(".modified-in-monaco-diff-editor:visible")).toContainText("my edits");
    await app.evaluate(() => { (globalThis as any).releaseFile = undefined; });
    await page.getByRole("button", { name: "slow.txt", exact: true }).click();
    await expect.poll(() => app.evaluate(() => typeof (globalThis as any).releaseFile)).toBe("function");
    await page.getByRole("tab", { name: "a.txt", exact: true }).click();
    await app.evaluate(() => (globalThis as any).releaseFile());
    await page.getByRole("button", { name: "binary.txt", exact: true }).click();
    await expect(page.locator(".content:visible > p[role=status]")).toContainText("binary");
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveText(["a.txt"]);
    await expect(page.locator(".modified-in-monaco-diff-editor:visible")).toContainText("my edits");
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("remembered comparisons retain equal and unavailable views and retry the original file", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-view-retry-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  await writeFile(join(root, "a.txt"), "baseline\n");
  await writeFile(join(root, "b.txt"), "other\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial");
  await writeFile(join(root, "a.txt"), "changed\n");
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "Diff", exact: true }).click();
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
    const view = page.getByRole("combobox", { name: "File view", exact: true });
    await expect(view).toHaveValue("unstaged");
    await page.getByRole("button", { name: "Keep Open", exact: true }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("treeitem", { name: "b.txt", exact: true }).click();
    await page.getByRole("tab", { name: "a.txt", exact: true }).click();
    await expect(view).toHaveValue("unstaged");
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(view).toHaveValue("unstaged");
    await expect(page.locator(".modified-in-monaco-diff-editor:visible")).toContainText("changed");
    await writeFile(join(root, "a.txt"), "baseline\n");
    await expect(page.getByText("No changes", { exact: true })).toBeVisible();
    await expect(view).toHaveValue("unstaged");
    await page.getByRole("button", { name: "Diff", exact: true }).click();
    await expect(page.getByRole("button", { name: "a.txt", exact: true })).toHaveCount(0);
    await writeFile(join(root, "a.txt"), Buffer.from([0, 1, 2]));
    await expect(page.getByRole("alert").filter({ hasText: "Comparison unavailable" })).toBeVisible();
    await expect(view).toHaveValue("unstaged");
    await expect(page.getByRole("tab", { name: "a.txt", exact: true })).toHaveAttribute("aria-selected", "true");
    await writeFile(join(root, "a.txt"), "retry text\n");
    await page.getByRole("button", { name: "Retry comparison", exact: true }).click();
    await expect(page.locator(".modified-in-monaco-diff-editor:visible")).toContainText("retry text");
    await rm(join(root, "a.txt"));
    await expect(page.locator(".content:visible > p[role=status]")).toContainText("Working file unavailable");
    await expect(page.getByRole("textbox", { name: "unstaged · a.txt modified", exact: true })).not.toBeEditable();
    await expect(page.getByRole("button", { name: "Retry comparison", exact: true })).toBeVisible();
    await view.selectOption("file");
    await expect(page.getByRole("textbox", { name: "a.txt editor", exact: true })).toBeEditable();
    expect(git("show", ":a.txt")).toBe("baseline\n");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("normal and comparison cursor and scroll positions survive switching and renderer restart", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-view-positions-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  const lines = Array.from({ length: 150 }, (_, i) => "line" + String(i + 1).padStart(3, "0"));
  await writeFile(join(root, "a.txt"), lines.join("\n"));
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial");
  await writeFile(join(root, "a.txt"), lines.join("\n") + "\nworking");
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    const normal = page.getByRole("textbox", { name: "a.txt editor", exact: true });
    await normal.focus();
    await page.keyboard.press("Meta+Home");
    for (let i = 0; i < 79; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Meta+ArrowRight");
    const view = page.getByRole("combobox", { name: "File view", exact: true });
    await page.getByRole("button", { name: "Diff", exact: true }).click();
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
    const modified = page.getByRole("textbox", { name: "unstaged · a.txt modified", exact: true });
    await modified.focus();
    await page.keyboard.press("Meta+Home");
    for (let i = 0; i < 29; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Meta+ArrowRight");
    await view.selectOption("file");
    await expect(page.locator(".editor .view-lines")).toContainText("line080");
    await normal.focus();
    await page.keyboard.type("NORMAL");
    await expect(page.locator(".editor .view-lines")).toContainText("line080NORMAL");
    await view.selectOption("unstaged");
    await expect(page.locator(".modified-in-monaco-diff-editor")).toContainText("line030");
    await modified.focus();
    await page.keyboard.type("DIFF");
    await expect(page.locator(".modified-in-monaco-diff-editor")).toContainText("line030DIFF");
    await view.selectOption("file");
    await expect.poll(async () => JSON.parse(await readRecoveryFixture(join(dir, "user/client-workspace-v1.json"), "utf8")).views[root]?.fileViews?.["a.txt"]).toBe("file");
    await expect.poll(async () => JSON.parse(await readRecoveryFixture(join(dir, "user/client-workspace-v1.json"), "utf8")).drafts.find((d: { path: string }) => d.path === "a.txt")?.text).toContain("line080NORMAL");
    await expect.poll(async () => JSON.parse(await readRecoveryFixture(join(dir, "user/client-workspace-v1.json"), "utf8")).drafts.find((d: { path: string }) => d.path === "a.txt")?.text).toContain("line030DIFF");
    await page.reload();
    await expect(normal).toBeEditable();
    await expect(page.locator(".editor .view-lines")).toContainText("line080NORMAL");
    await normal.focus();
    await page.keyboard.type("RESTORED");
    await page.keyboard.press("Meta+s");
    lines[29] += "DIFF";
    lines[79] += "NORMALRESTORED";
    await expect.poll(() => readFile(join(root, "a.txt"), "utf8")).toBe(lines.join("\n") + "\nworking");
    await expect(page.getByRole("button", { name: "Save ⌘S", exact: true })).toBeEnabled();
    expect(git("show", ":a.txt")).not.toContain("NORMAL");
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("preview browsing replaces only clean previews and Keep Open retains the same tab", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-previews-")));
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
    const file = (name: string) => page.getByRole("treeitem", { name, exact: true });
    const tabs = page.getByRole("tablist", { name: "Open files" });
    await file("a.txt").click();
    await file("b.txt").click();
    await expect(tabs.getByRole("tab")).toHaveText(["b.txt"]);
    await expect(tabs.getByRole("tab")).toHaveAccessibleDescription("Preview");
    await expect(page.getByRole("tree")).toBeFocused();
    await page.getByRole("button", { name: "Keep Open", exact: true }).click();
    await file("c.txt").click();
    await expect.poll(async () => JSON.parse(await readRecoveryFixture(join(dir, "user/client-workspace-v1.json"), "utf8")).views[root]?.preview).toBe("c.txt");
    await page.reload();
    await expect(tabs.getByRole("tab", { name: "c.txt", exact: true })).toHaveAccessibleDescription("Preview");
    await file("b.txt").click();
    await expect(tabs.getByRole("tab")).toHaveText(["b.txt", "c.txt"]);
    await file("a.txt").click();
    await expect(tabs.getByRole("tab")).toHaveText(["b.txt", "a.txt"]);
    await page.getByRole("button", { name: "Diff", exact: true }).click();
    await page.getByRole("button", { name: "c.txt", exact: true }).click();
    await expect(tabs.getByRole("tab")).toHaveText(["b.txt", "c.txt"]);
    await tabs.getByRole("tab", { name: "c.txt", exact: true }).dblclick();
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
    await expect(tabs.getByRole("tab")).toHaveText(["b.txt", "c.txt", "a.txt"]);
    await tabs.getByRole("tab", { name: "a.txt", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Keep Open", exact: true }).click();
    await expect(tabs.getByRole("tab", { name: "a.txt", exact: true })).not.toHaveAccessibleDescription("Preview");
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menuitem", { name: "Keep Open", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tabs.getByRole("tab", { name: "a.txt", exact: true })).toBeFocused();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("deliberate opening and edits keep files open after undo, Save and recovery", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-preview-triggers-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  for (const name of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt"]) await writeFile(join(root, name), name);
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    const file = (name: string) => page.getByRole("treeitem", { name, exact: true });
    const tabs = page.getByRole("tablist", { name: "Open files" });
    await file("a.txt").dblclick();
    await expect(page.getByRole("textbox", { name: "a.txt editor", exact: true })).toBeFocused();
    await file("b.txt").click();
    await page.keyboard.press("Space");
    await expect(page.getByRole("tree")).toBeFocused();
    await page.keyboard.press("Meta+ArrowDown");
    await expect(page.getByRole("textbox", { name: "b.txt editor", exact: true })).toBeFocused();
    await file("c.txt").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Open File", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "c.txt editor", exact: true })).toBeFocused();
    await file("d.txt").click();
    await page.getByRole("textbox", { name: "d.txt editor", exact: true }).focus();
    await page.keyboard.type("edit");
    await page.keyboard.press("Meta+z");
    await file("e.txt").click();
    await page.getByRole("button", { name: "Diff", exact: true }).click();
    await page.getByRole("button", { name: "e.txt", exact: true }).click();
    await page.getByRole("textbox", { name: "untracked · e.txt modified", exact: true }).focus();
    await page.keyboard.type("diff edit");
    await page.keyboard.press("Meta+s");
    await expect.poll(() => readFile(join(root, "e.txt"), "utf8")).toContain("diff edit");
    await page.getByRole("button", { name: "f.txt", exact: true }).dblclick();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await file("a.txt").click();
    await page.getByRole("textbox", { name: "a.txt editor", exact: true }).focus();
    await page.keyboard.type("recovered");
    await expect.poll(async () => JSON.parse(await readRecoveryFixture(join(dir, "user/client-workspace-v1.json"), "utf8")).drafts.find((d: { path: string }) => d.path === "a.txt")?.text).toContain("recovered");
    const recovered = JSON.parse(await readRecoveryFixture(join(dir, "user/client-workspace-v1.json"), "utf8"));
    recovered.views[root].preview = "a.txt";
    await page.evaluate(state => window.escode.lifecycle("persist", state), recovered);
    await page.reload();
    await expect(tabs.getByRole("tab")).toHaveCount(6);
    await expect(page.getByRole("button", { name: "Keep Open", exact: true })).toHaveCount(0);
    await expect(page.locator(".monaco-editor:visible")).toContainText("recovered");
    await page.getByRole("button", { name: "New File", exact: true }).click();
    await page.getByRole("textbox", { name: "New file name", exact: true }).fill("new.txt");
    await page.getByRole("textbox", { name: "New file name", exact: true }).press("Enter");
    await expect(tabs.getByRole("tab", { name: "new.txt", exact: true })).not.toHaveAccessibleDescription("Preview");
    await expect(tabs.getByRole("tab")).toHaveCount(7);
    await file("b.txt").click();
    await expect(tabs.getByRole("tab")).toHaveCount(7);
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
