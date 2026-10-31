import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("inline create and rename: names, cancellation, blur, click-away, case and scoped keys", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-inline-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "folder"));
  await writeFile(join(root, "folder/a.txt"), "original");
  await writeFile(join(root, "folder/taken.txt"), "keep");
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    const tree = page.getByRole("tree", { name: "Files", exact: true });
    // A collapsed, never-loaded destination still gives the inline field keyboard focus.
    await page.getByRole("treeitem", { name: "folder", exact: true }).click({ button: "right" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "New File", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "New file name", exact: true })).toBeFocused();
    let input = page.getByRole("textbox", { name: "New file name", exact: true });
    await input.fill("../escape");
    await input.press("Enter");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.fill("a.txt");
    await input.press("Enter");
    await expect(page.locator(".tree-edit [role=alert]")).toContainText("already in use");
    await expect(input).toHaveValue("a.txt");
    await input.fill("new.ts");
    await input.press("Enter");
    await expect(page.locator(".toolbar")).toContainText("folder/new.ts");
    expect(await readFile(join(root, "folder/new.ts"), "utf8")).toBe("");
    await expect(page.locator(".editor:visible")).toHaveAttribute("data-language", "typescript");
    await tree.focus();
    await page.keyboard.press("Enter");
    input = page.getByRole("textbox", { name: "Rename folder/new.ts", exact: true });
    await expect(input).toBeFocused();
    expect(
      await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
    ).toEqual([0, 3]);
    await input.fill("cancelled.ts");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(tree).toBeFocused();
    await page.keyboard.press("Enter");
    input = page.getByRole("textbox", { name: "Rename folder/new.ts", exact: true });
    await input.fill("taken.txt");
    await input.press("Enter");
    await expect(page.locator(".tree-edit [role=alert]")).toContainText("already in use");
    await expect(input).toHaveValue("taken.txt");
    await page.screenshot({ path: "test-results/files-inline-error.png" });
    await page.screenshot({ path: "test-results/files-inline-error.png" });
    expect(await readFile(join(root, "folder/taken.txt"), "utf8")).toBe("keep");
    await input.fill("NEW.ts");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(input).toHaveValue("NEW.ts");
    expect(await readFile(join(root, "folder/new.ts"), "utf8")).toBe("");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(input).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: "NEW.ts", exact: true })).toBeVisible();
    await tree.focus();
    await page.keyboard.press("Meta+Alt+Shift+n");
    input = page.getByRole("textbox", { name: "New folder name", exact: true });
    await input.fill("nested");
    await input.press("Enter");
    await expect(page.getByRole("treeitem", { name: "nested", exact: true })).toBeVisible();
    await expect(tree).toBeFocused();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "New File", exact: true }).click();
    input = page.getByRole("textbox", { name: "New file name", exact: true });
    await input.fill("from-context.txt");
    await input.press("Enter");
    await expect(page.locator(".toolbar")).toContainText("folder/from-context.txt");
    await expect(input).toHaveCount(0);
    await expect(tree).toBeFocused();
    await page.locator(".monaco-editor:visible textarea").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".tree-edit input")).toHaveCount(0);
    await tree.focus();
    await tree.dispatchEvent("contextmenu");
    await page.getByRole("menuitem", { name: "New Folder", exact: true }).click();
    input = page.getByRole("textbox", { name: "New folder name", exact: true });
    await input.fill("root-folder");
    await input.press("Enter");
    await expect(page.getByRole("treeitem", { name: "root-folder", exact: true })).toHaveAttribute(
      "aria-level",
      "1",
    );
    await page.screenshot({ path: "test-results/files-inline.png" });
  } finally {
    app.process().kill("SIGKILL");
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("pending inline rename stays with its original checkout", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-inline-origin-")));
  const roots = [join(base, "one"), join(base, "two")];
  for (const root of roots) {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a.txt"), "disk");
  }
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    for (const root of roots) {
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await expect(page.locator("header")).toContainText(root);
    }
    await page.getByRole("button", { name: "one", exact: true }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.getByRole("tree", { name: "Files", exact: true }).focus();
    await page.keyboard.press("Enter");
    const input = page.getByRole("textbox", { name: "Rename a.txt", exact: true });
    await input.fill("renamed.txt");
    await app.evaluate(() => {
      const fs = process.getBuiltinModule("fs/promises") as any;
      const rename = fs.rename;
      fs.rename = async (...args: any[]) => {
        if (String(args[1]).endsWith("/client-file-operation-v1.json")) {
          fs.rename = rename;
          await new Promise<void>((resolve) => {
            (globalThis as any).resumeRename = resolve;
          });
        }
        return rename(...args);
      };
    });
    await input.press("Enter");
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).resumeRename)).toBe(true);
    await page.getByRole("button", { name: "two", exact: true }).click();
    await app.evaluate(() => (globalThis as any).resumeRename());
    await expect
      .poll(() => readFile(join(roots[0], "renamed.txt"), "utf8").catch(() => null))
      .toBe("disk");
    expect(await readFile(join(roots[1], "a.txt"), "utf8")).toBe("disk");
    await expect(readFile(join(roots[1], "renamed.txt"))).rejects.toThrow();
    await expect(page.locator("header")).toContainText(roots[1]);
    await page.getByRole("button", { name: "one", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "renamed.txt", exact: true })).toBeVisible();
    await expect(page.locator(".tree-edit input")).toHaveCount(0);
  } finally {
    app.process().kill("SIGKILL");
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("uncertain rename retains inline input and dirty work, then restart reconciles the actual path", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-inline-uncertain-")));
  const root = join(base, "repo"),
    user = join(base, "user");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "disk");
  let app = await launchDesktop(user);
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible textarea").focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("retained dirty text");
    await page.getByRole("tree", { name: "Files", exact: true }).focus();
    await page.keyboard.press("Enter");
    let input = page.getByRole("textbox", { name: "Rename a.txt", exact: true });
    await input.fill("actual.txt");
    await app.evaluate(() => {
      const cp = process.getBuiltinModule("child_process") as any,
        execute = cp.execFileSync;
      cp.execFileSync = (...args: any[]) => {
        const value = execute(...args);
        if (args[1]?.[0] === "move") {
          cp.execFileSync = execute;
          throw Error("lost native reply after move");
        }
        return value;
      };
    });
    await input.press("Enter");
    await expect(page.locator(".tree-edit [role=alert]")).toContainText("Uncertain move");
    await expect(input).toHaveValue("actual.txt");
    expect(await readFile(join(root, "actual.txt"), "utf8")).toBe("disk");
    await expect(readFile(join(root, "a.txt"))).rejects.toThrow();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    input = page.getByRole("textbox", { name: "Rename a.txt", exact: true });
    await expect(input).toHaveValue("actual.txt");
    await expect(page.getByRole("treeitem", { name: "actual.txt", exact: true })).toBeVisible();
    await expect(page.locator(".monaco-editor:visible")).toContainText("retained dirty text");
    app.process().kill("SIGKILL");
    await new Promise((resolve) => app.process().once("exit", resolve));
    await rm(join(user, "foundation/owner.lock")); // Explicit fixture recovery after confirmed process exit.
    app = await launchDesktop(user);
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toContainText("actual.txt");
    await expect(page.locator(".monaco-editor:visible")).toContainText("retained dirty text");
    await expect(page.getByText(/Recovered move:/)).toBeVisible();
    await page.getByRole("button", { name: "Save ⌘S" }).click();
    await expect.poll(() => readFile(join(root, "actual.txt"), "utf8")).toBe("retained dirty text");
    await expect(readFile(join(root, "a.txt"))).rejects.toThrow();
  } finally {
    app.process().kill("SIGKILL");
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

for (const outcome of ["correct", "cancel"] as const) {
  test(`collapsed invalid creation stays reachable to ${outcome}`, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "escode-inline-collapse-")));
    const root = join(base, "repo");
    execFileSync("git", ["init", root]);
    await mkdir(join(root, "folder/deep"), { recursive: true });
    const app = await launchDesktop(join(base, "user"));
    try {
      const page = await app.firstWindow();
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await page.getByRole("treeitem", { name: "folder", exact: true }).click();
      await page.getByRole("treeitem", { name: "deep", exact: true }).click();
      await page.getByRole("button", { name: "New File", exact: true }).click();
      const input = page.getByRole("textbox", { name: "New file name", exact: true });
      await input.fill("../bad");
      await input.press("Enter");
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await page.getByRole("button", { name: "Collapse All", exact: true }).click();
      await expect(page.getByRole("treeitem", { name: "folder", exact: true })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(page.getByRole("treeitem", { name: "deep", exact: true })).toHaveCount(0);
      await expect(input).toHaveCount(1);
      await expect(input).toBeVisible();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("../bad");
      await expect(page.locator(".tree-edit [role=alert]")).toContainText(
        "without separators or traversal",
      );
      await page.screenshot({ path: `test-results/files-inline-collapse-${outcome}.png` });
      if (outcome === "correct") {
        await input.fill("corrected.txt");
        await input.press("Enter");
        await expect(page.locator(".toolbar")).toContainText("folder/deep/corrected.txt");
        expect(await readFile(join(root, "folder/deep/corrected.txt"), "utf8")).toBe("");
        await expect(readFile(join(root, "corrected.txt"))).rejects.toThrow();
      } else {
        await input.press("Escape");
        await expect(page.getByRole("tree", { name: "Files", exact: true })).toBeFocused();
        await expect(readFile(join(root, "folder/bad"))).rejects.toThrow();
      }
      await expect(input).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New File", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "New Folder", exact: true })).toBeEnabled();
    } finally {
      app.process().kill("SIGKILL");
      await rm(base, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}

test("creation field survives failed destination listing and missing parent without retargeting", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-inline-unavailable-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "folder"));
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "folder", exact: true }).click();
    await page.getByRole("button", { name: "New Folder", exact: true }).click();
    const input = page.getByRole("textbox", { name: "New folder name", exact: true });
    await input.fill("../bad");
    await input.press("Enter");
    await app.evaluate(() => {
      const cp = process.getBuiltinModule("child_process") as any,
        execute = cp.execFileSync;
      cp.execFileSync = (...args: any[]) => {
        if (args[1]?.[0] === "list" && args[1][1] === "folder") {
          cp.execFileSync = execute;
          throw Error("injected destination listing failure");
        }
        return execute(...args);
      };
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText(/injected destination listing failure/)).toBeVisible();
    await expect(input).toHaveCount(1);
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("../bad");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await rm(join(root, "folder"), { recursive: true });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "folder", exact: true })).toHaveCount(0);
    await expect(input).toHaveCount(1);
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("../bad");
    await expect(page.locator(".tree-edit [role=alert]")).toContainText(
      "without separators or traversal",
    );
    await input.fill("retained");
    await input.press("Enter");
    await expect(page.locator(".tree-edit [role=alert]")).toContainText("ENOENT");
    await expect(input).toHaveValue("retained");
    await expect(stat(join(root, "retained"))).rejects.toThrow();
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(page.getByRole("tree", { name: "Files", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: "New Folder", exact: true })).toBeEnabled();
  } finally {
    app.process().kill("SIGKILL");
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

for (const kind of ["file", "folder"] as const) {
  test(`New ${kind} uses the selected nested folder after Collapse All`, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "escode-create-target-")));
    const root = join(base, "repo");
    execFileSync("git", ["init", root]);
    await mkdir(join(root, "folder/deep"), { recursive: true });
    const app = await launchDesktop(join(base, "user"));
    try {
      const page = await app.firstWindow();
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await page.getByRole("treeitem", { name: "folder", exact: true }).click();
      await page.getByRole("treeitem", { name: "deep", exact: true }).click();
      await page.getByRole("button", { name: "Collapse All", exact: true }).click();
      await expect(page.getByRole("treeitem", { name: "deep", exact: true })).toHaveCount(0);
      await page
        .getByRole("button", { name: kind === "file" ? "New File" : "New Folder", exact: true })
        .click();
      const name = kind === "file" ? "probe.txt" : "probe-folder";
      const input = page.getByRole("textbox", { name: `New ${kind} name`, exact: true });
      await expect(input).toBeFocused();
      await input.fill(name);
      await input.press("Enter");
      await expect(input).toHaveCount(0);
      expect((await stat(join(root, "folder/deep", name))).isDirectory()).toBe(kind === "folder");
      if (kind === "file") {
        expect(await readFile(join(root, "folder/deep", name), "utf8")).toBe("");
        await expect(page.locator(".toolbar")).toContainText("folder/deep/probe.txt");
      }
      await expect(stat(join(root, "folder", name))).rejects.toThrow();
      await expect(stat(join(root, name))).rejects.toThrow();
    } finally {
      app.process().kill("SIGKILL");
      await rm(base, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}

test("restored hidden selection loads its type and refuses unavailable or missing entries", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-create-unknown-")));
  const root = join(base, "repo"),
    user = join(base, "user");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "folder/deep"), { recursive: true });
  let app = await launchDesktop(user);
  let childProcess = app.process();
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "folder", exact: true }).click();
    await page.getByRole("treeitem", { name: "deep", exact: true }).click();
    await page.getByRole("button", { name: "Collapse All", exact: true }).click();
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).views[root]?.files,
      )
      .toMatchObject({ expanded: [], selected: ["folder/deep"] });
    const exited = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exited;
    await rm(join(user, "foundation/owner.lock"));
    app = await launchDesktop(user);
    childProcess = app.process();
    page = await app.firstWindow();
    await expect(page.getByRole("treeitem", { name: "folder", exact: true })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "deep", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "New File", exact: true }).click();
    const resolved = page.getByRole("textbox", { name: "New file name", exact: true });
    await expect(resolved).toBeFocused();
    await expect(page.getByRole("treeitem", { name: "deep", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await resolved.press("Escape");
    await page.getByRole("button", { name: "Collapse All", exact: true }).click();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "folder", exact: true })).toBeVisible();
    await app.evaluate(() => {
      const cp = process.getBuiltinModule("child_process") as any,
        execute = cp.execFileSync;
      (globalThis as any).failSelectedEntry = true;
      cp.execFileSync = (...args: any[]) => {
        if ((globalThis as any).failSelectedEntry && args[1]?.[0] === "list" && args[1][1] === "folder") {
          throw Error("injected selected-entry listing unavailable");
        }
        return execute(...args);
      };
    });
    await page.getByRole("button", { name: "New File", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(root + "/folder/deep");
    await expect(page.getByRole("alert")).toContainText(
      "injected selected-entry listing unavailable",
    );
    await expect(page.locator(".tree-edit input")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New File", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Rename folder/deep", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Cannot rename " + root + "/folder/deep");
    await expect(page.getByRole("alert")).toContainText(
      "injected selected-entry listing unavailable",
    );
    await expect(page.locator(".tree-edit input")).toHaveCount(0);
    await app.evaluate(() => {
      const cp = process.getBuiltinModule("child_process") as any,
        execute = cp.execFileSync;
      (globalThis as any).failSelectedEntry = false;
      (globalThis as any).restoreRootListing = () => { cp.execFileSync = execute; };
      cp.execFileSync = (...args: any[]) => {
        if (args[1]?.[0] === "list" && args[1][1] === ".") {
          throw Error("injected root listing unavailable");
        }
        return execute(...args);
      };
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText(/injected root listing unavailable/)).toBeVisible();
    const tree = page.getByRole("tree", { name: "Files", exact: true });
    // Failed refresh retains the last successful root listing without retargeting the hidden selection.
    await expect(tree.getByRole("treeitem", { name: "folder", exact: true })).toBeVisible();
    await expect(tree).toHaveAttribute("data-row-count", "1");
    await tree.focus();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu")).toHaveAttribute("aria-label", "Actions for folder/deep");
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const hiddenRename = page.getByRole("textbox", { name: "Rename folder/deep", exact: true });
    await expect(hiddenRename).toBeFocused();
    await hiddenRename.press("Escape");
    await expect(tree).toBeFocused();
    await app.evaluate(() => (globalThis as any).restoreRootListing());
    // Capture the hidden target before successful observation prunes the vanished selection.
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu")).toHaveAttribute("aria-label", "Actions for folder/deep");
    await rm(join(root, "folder/deep"), { recursive: true });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("button", { name: "Rename folder/deep", exact: true })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "New Folder", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Selected entry is missing");
    await expect(page.locator(".tree-edit input")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New Folder", exact: true })).toBeEnabled();
    expect((await stat(join(root, "folder"))).isDirectory()).toBe(true);
    await expect(stat(join(root, "deep"))).rejects.toThrow();
  } finally {
    childProcess.kill("SIGKILL");
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

for (const route of ["toolbar", "keyboard", "context"] as const) {
  test(`hidden selected entry renames through ${route} without changing another path`, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "escode-hidden-rename-")));
    const root = join(base, "repo"),
      file = route === "keyboard";
    const source = file ? "folder/deep/a.txt" : "folder/deep";
    const destination = file ? "folder/deep/renamed.txt" : "folder/renamed";
    execFileSync("git", ["init", root]);
    await mkdir(join(root, "folder/deep"), { recursive: true });
    await writeFile(join(root, "folder/deep/a.txt"), "original");
    const app = await launchDesktop(join(base, "user"));
    try {
      const page = await app.firstWindow();
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await page.getByRole("treeitem", { name: "folder", exact: true }).click();
      await page.getByRole("treeitem", { name: "deep", exact: true }).click();
      if (file) {
        await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
        await page.locator(".monaco-editor:visible textarea").focus();
        await page.keyboard.press("Meta+a");
        await page.keyboard.type("unsaved hidden file");
      }
      await page.getByRole("button", { name: "Collapse All", exact: true }).click();
      const tree = page.getByRole("tree", { name: "Files", exact: true });
      async function start() {
        if (route === "toolbar")
          await page.getByRole("button", { name: "Rename " + source, exact: true }).click();
        else {
          await tree.focus();
          await page.keyboard.press(route === "keyboard" ? "Enter" : "Shift+F10");
          if (route === "context") {
            await expect(page.getByRole("menu")).toHaveAttribute(
              "aria-label",
              "Actions for " + source,
            );
            await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
          }
        }
      }
      await start();
      const input = page.getByRole("textbox", { name: "Rename " + source, exact: true });
      await expect(input).toBeFocused();
      await input.press("Escape");
      await expect(tree).toBeFocused();
      expect(await stat(join(root, source))).toBeTruthy();
      await start();
      await input.fill(file ? "renamed.txt" : "renamed");
      await input.press("Enter");
      await expect(input).toHaveCount(0);
      expect(await readFile(join(root, file ? destination : destination + "/a.txt"), "utf8")).toBe(
        "original",
      );
      await expect(stat(join(root, source))).rejects.toThrow();
      await expect(stat(join(root, file ? "renamed.txt" : "renamed"))).rejects.toThrow();
      if (file) {
        await expect(page.locator(".toolbar")).toContainText(destination);
        await expect(page.locator(".monaco-editor:visible")).toContainText("unsaved hidden file");
        await page.getByRole("button", { name: "Save ⌘S" }).click();
        await expect
          .poll(() => readFile(join(root, destination), "utf8"))
          .toBe("unsaved hidden file");
      }
    } finally {
      app.process().kill("SIGKILL");
      await rm(base, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}

test("missing hidden rename source retains the error and permits cancellation", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-hidden-missing-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "folder/deep"), { recursive: true });
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "folder", exact: true }).click();
    await page.getByRole("treeitem", { name: "deep", exact: true }).click();
    await page.getByRole("button", { name: "Collapse All", exact: true }).click();
    await rm(join(root, "folder/deep"), { recursive: true });
    await page.getByRole("button", { name: "Rename folder/deep", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Rename folder/deep", exact: true });
    await input.fill("renamed");
    await input.press("Enter");
    await expect(page.locator(".tree-edit [role=alert]")).toContainText("ENOENT");
    await expect(input).toHaveValue("renamed");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(page.getByRole("tree", { name: "Files", exact: true })).toBeFocused();
    await expect(stat(join(root, "folder/renamed"))).rejects.toThrow();
    expect((await stat(join(root, "folder"))).isDirectory()).toBe(true);
  } finally {
    app.process().kill("SIGKILL");
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("pending entry resolution retains its source across selection and project changes", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-entry-origin-")));
  const roots = [join(base, "one"), join(base, "two")];
  for (const root of roots) {
    execFileSync("git", ["init", root]);
    await mkdir(join(root, "folder/deep"), { recursive: true });
    await writeFile(join(root, "folder/deep/a.txt"), "keep");
    await writeFile(join(root, "other.txt"), "other");
  }
  let app = await launchDesktop(join(base, "user"));
  try {
    let page = await app.firstWindow();
    for (const root of roots) {
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await expect(page.locator("header")).toContainText(root);
    }
    await page.getByRole("button", { name: "one", exact: true }).click();
    await page.getByRole("treeitem", { name: "folder", exact: true }).click();
    await page.getByRole("treeitem", { name: "deep", exact: true }).click();
    await page.getByRole("button", { name: "Collapse All", exact: true }).click();
    // A fresh process excludes replies from the retired model from the interception below.
    await expect.poll(async () => JSON.parse(await readFile(join(base, "user/client-workspace-v1.json"), "utf8")).views[roots[0]].files).toMatchObject({ expanded: [], selected: ["folder/deep"] });
    const exited = new Promise(resolve => app.process().once("exit", resolve));
    app.process().kill("SIGKILL"); await exited;
    await rm(join(base, "user/foundation/owner.lock"));
    app = await launchDesktop(join(base, "user")); page = await app.firstWindow();
    await expect(page.getByRole("treeitem", { name: "other.txt", exact: true })).toBeVisible();
    await page.evaluate(() => {
      // Pause consumption of the real listing, without replacing host validation/data.
      const then = Promise.prototype.then;
      // oxlint-disable-next-line unicorn/no-thenable -- Instrument the existing Promise method in this test only.
      Object.defineProperty(Promise.prototype, "then", {
        value: function (fulfilled: any, rejected: any): any {
          return then.call(
            this,
            (value: any) => {
              if (
                Array.isArray(value?.listing?.entries) &&
                value.listing.entries.some((entry: any) => entry?.path === "folder/deep")
              ) {
                // oxlint-disable-next-line unicorn/no-thenable -- Restore the original method before pausing.
                Object.defineProperty(Promise.prototype, "then", { value: then });
                return new Promise((resolve) => {
                  (window as any).releaseEntry = () =>
                    resolve(fulfilled ? fulfilled(value) : value);
                });
              }
              return fulfilled ? fulfilled(value) : value;
            },
            rejected,
          );
        },
      });
    });
    await page.getByRole("button", { name: "Rename folder/deep", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).releaseEntry))
      .toBe("function");
    await page.getByRole("treeitem", { name: "other.txt", exact: true }).click();
    await expect(page.locator(".toolbar:visible")).toContainText("other.txt");
    await page.getByRole("button", { name: "two", exact: true }).click();
    await page.evaluate(() => (window as any).releaseEntry());
    await expect(page.locator(".tree-edit input:visible")).toHaveCount(0);
    await expect(page.locator("header")).toContainText(roots[1]);
    await page.getByRole("button", { name: "one", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Rename folder/deep", exact: true });
    await expect(input).toBeFocused();
    await input.fill("renamed");
    await input.press("Enter");
    await expect(input).toHaveCount(0);
    expect(await readFile(join(roots[0], "folder/renamed/a.txt"), "utf8")).toBe("keep");
    await expect(stat(join(roots[0], "folder/deep"))).rejects.toThrow();
    expect(await readFile(join(roots[0], "other.txt"), "utf8")).toBe("other");
    expect(await readFile(join(roots[1], "folder/deep/a.txt"), "utf8")).toBe("keep");
    await expect(stat(join(roots[1], "folder/renamed"))).rejects.toThrow();
  } finally {
    app.process().kill("SIGKILL");
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("lost native creation result retains input and does not repeat the effect", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-create-uncertain-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      const cp = process.getBuiltinModule("child_process") as any, execute = cp.execFileSync;
      let created = false;
      cp.execFileSync = (...args: any[]) => {
        if (created && args[1]?.[0] === "identity") throw Error("post-effect identity unavailable");
        const value = execute(...args);
        if (args[1]?.[0] === "create") { created = true; throw Error("lost native creation result"); }
        return value;
      };
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "New File", exact: true }).click();
    const input = page.getByRole("textbox", { name: "New file name", exact: true });
    await input.fill("new.txt");
    await input.press("Enter");
    await expect(page.locator(".tree-edit [role=alert]")).toContainText("uncertain");
    await expect(input).toHaveValue("new.txt");
    expect(await readFile(join(root, "new.txt"), "utf8")).toBe("");
    await writeFile(join(root, "new.txt"), "retained bytes");
    await input.press("Enter");
    await expect(page.locator(".tree-edit [role=alert]")).toContainText("uncertain");
    expect(await readFile(join(root, "new.txt"), "utf8")).toBe("retained bytes");
  } finally { app.process().kill("SIGKILL"); await rm(base, { recursive: true, force: true }); }
});
