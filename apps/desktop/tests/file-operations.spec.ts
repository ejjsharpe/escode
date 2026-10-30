import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("dirty descendants move through Monaco and bridge, undo, save conflict and restart", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-move-ui-")));
  const root = join(base, "repo"),
    user = join(base, "user");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "folder"));
  await writeFile(
    join(root, "folder/a.ts"),
    Array.from({ length: 100 }, (_, i) => `// line ${i}`).join("\n"),
  );
  await writeFile(join(root, "folder/b.txt"), "disk b");
  let app = await launchDesktop(user);
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "folder", exact: true }).click();
    await page.getByRole("treeitem", { name: /^b.txt/ }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("dirty b");
    await page.getByRole("treeitem", { name: "a.ts", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("dirty a");
    await page
      .getByRole("treeitem", { name: "folder", exact: true })
      .locator(":scope > .tree-row")
      .click({ button: "right" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Rename folder", exact: true }).click();
    await expect(page.getByText(/Earlier text undo history resets/)).toBeVisible();
    await page.getByRole("textbox", { name: "Rename folder" }).fill("moved");
    await page.keyboard.press("Enter");
    await expect(page.locator(".content:visible > [role=status]")).toContainText(
      "Earlier text undo history was reset",
    );
    await expect(page.locator(".toolbar")).toContainText("moved/a.ts");
    await expect(page.locator(".monaco-editor:visible")).toContainText("dirty a");
    await expect(page.locator(".editor:visible")).toHaveAttribute("data-language", "typescript");
    await expect(page.locator(".editor:visible")).toHaveAttribute(
      "data-model-uri",
      "file://" + root + "/moved/a.ts",
    );
    await page.locator(".monaco-editor:visible textarea").focus();
    await page.keyboard.type(" subsequent");
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts.find(
            (d: any) => d.path === "moved/a.ts",
          )?.text,
      )
      .toContain("dirty a subsequent");
    await page.keyboard.press("Meta+z");
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts.find(
            (d: any) => d.path === "moved/a.ts",
          )?.text,
      )
      .not.toContain("subsequent");
    const state = JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8"));
    expect(state.drafts.map((d: any) => d.path).sort()).toEqual(["moved/a.ts", "moved/b.txt"]);
    expect(state.drafts[0].text).toContain("dirty");
    expect(await readFile(join(root, "moved/b.txt"), "utf8")).toBe("disk b");
    await writeFile(join(root, "moved/a.ts"), "external");
    await page.getByRole("button", { name: "Save ⌘S" }).click();
    await expect(page.locator(".conflict")).toContainText("moved/a.ts changed on disk");
    app.process().kill("SIGKILL");
    await new Promise((resolve) => app.process().once("exit", resolve));
    // Explicit recovery of the test-owned store after confirmed process death.
    await rm(join(user, "foundation/owner.lock"));
    app = await launchDesktop(user);
    page = await app.firstWindow();
    await expect(page.locator(".monaco-editor:visible")).toContainText("dirty a");
    await expect(page.locator(".toolbar")).toContainText("moved/a.ts");
    await expect(page.getByRole("treeitem", { name: "moved", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.getByRole("treeitem", { name: /^b.txt/ }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("dirty b");
    await page.getByRole("button", { name: "Save ⌘S" }).click();
    await expect.poll(() => readFile(join(root, "moved/b.txt"), "utf8")).toBe("dirty b");
    await page.getByRole("treeitem", { name: /^a.ts/ }).click({ button: "right" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Rename moved/a.ts", exact: true }).click();
    await page.getByRole("textbox", { name: "Rename moved/a.ts" }).fill("a.json");
    await page.keyboard.press("Enter");
    await expect(page.locator(".content:visible > [role=status]")).toContainText(
      "Earlier text undo history was reset",
    );
    await page.getByRole("treeitem", { name: /^a.json/ }).click();
    await expect(page.locator(".editor:visible")).toHaveAttribute("data-language", "json");
    await expect(page.locator(".editor:visible")).toHaveAttribute(
      "data-model-uri",
      "file://" + root + "/moved/a.json",
    );
    await expect(page.locator(".monaco-editor:visible")).toContainText("dirty a");
    expect(await readFile(join(root, "moved/a.json"), "utf8")).toBe("external");
    await expect(readFile(join(root, "moved/a.ts"))).rejects.toThrow();
  } finally {
    app.process().kill("SIGKILL");
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("Trash cancellation, conflict and native failure retain dirty drafts; pending confirmation stays at its origin", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-trash-ui-")));
  const roots = [join(base, "one"), join(base, "two")],
    user = join(base, "user");
  for (const root of roots) {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a.txt"), "disk");
  }
  const app = await launchDesktop(user);
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
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("unsaved");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args: any[]) => {
        (globalThis as any).confirmation = args.at(-1);
        return { response: 2, checkboxChecked: false };
      };
    });
    await page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
    await expect(page.locator(".content:visible > [role=status]")).toContainText("Cancelled");
    expect((await app.evaluate(() => (globalThis as any).confirmation)).detail).toContain(
      "Dirty descendants (1)",
    );
    await writeFile(join(roots[0], "a.txt"), "external");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
    await expect(page.locator(".content:visible > [role=status]")).toContainText("Save conflict");
    expect(JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts[0].text).toBe(
      "unsaved",
    );
    await expect(page.locator(".conflict")).toContainText("a.txt changed on disk");
    await page.locator(".conflict").getByRole("button", { name: "Cancel", exact: true }).click();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () =>
        new Promise((resolve) => {
          (globalThis as any).confirmTrash = () => resolve({ response: 1, checkboxChecked: false });
        });
    });
    await page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).confirmTrash)).toBe(true);
    await page.getByRole("button", { name: "two", exact: true }).click();
    // Fail native execution while another project is visible.
    await app.evaluate(() => {
      const cp = process.getBuiltinModule("child_process") as any,
        execute = cp.execFileSync;
      cp.execFileSync = (...args: any[]) => {
        if (args[1]?.[0] === "trash") {
          cp.execFileSync = execute;
          throw Error("injected native Trash failure");
        }
        return execute(...args);
      };
      (globalThis as any).confirmTrash();
    });
    await page.getByRole("button", { name: "one", exact: true }).click();
    await expect(page.locator(".content:visible > [role=status]")).toContainText(
      "injected native Trash failure",
    );
    expect(await readFile(join(roots[0], "a.txt"), "utf8")).toBe("external");
    expect(await readFile(join(roots[1], "a.txt"), "utf8")).toBe("disk");
    expect(JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts[0].text).toBe(
      "unsaved",
    );
    // Capture the actual native result solely to inspect and clean up test-owned Trash fixtures.
    await app.evaluate(({ dialog }) => {
      const cp = process.getBuiltinModule("child_process") as any,
        execute = cp.execFileSync;
      (globalThis as any).trashFixtures = [];
      cp.execFileSync = (...args: any[]) => {
        const value = execute(...args);
        if (args[1]?.[0] === "trash") (globalThis as any).trashFixtures.push(value.toString());
        return value;
      };
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
    await expect(page.locator(".content:visible > [role=status]")).toContainText(
      "Moved to macOS Trash",
    );
    expect(JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts).toEqual([]);
    await page.getByRole("button", { name: "two", exact: true }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("save before trash");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
    await expect(page.locator(".content:visible > [role=status]")).toContainText(
      "Moved to macOS Trash",
    );
    const trashFiles = await app.evaluate(() => (globalThis as any).trashFixtures as string[]);
    expect(trashFiles).toHaveLength(2);
    expect(await readFile(trashFiles[0], "utf8")).toBe("external");
    expect(await readFile(trashFiles[1], "utf8")).toBe("save before trash");
    for (const file of trashFiles) await rm(file);
  } finally {
    const fixtures = await app
      .evaluate(() => (globalThis as any).trashFixtures ?? [])
      .catch(() => []);
    for (const file of fixtures) await rm(file, { force: true });
    app.process().kill("SIGKILL");
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});
test("mutation IPC rejects other senders, unopened checkouts and protected app state", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-op-authority-")));
  const root = join(base, "repo"),
    user = join(root, "app-state");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "keep");
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.locator("header")).toContainText(root);
    await expect(page.getByRole("treeitem", { name: "app-state", exact: true })).toHaveCount(0);
    for (const operation of ["files", "read", "save"] as const) {
      const error = await page.evaluate(
        async ({ root, operation }) => {
          try {
            if (operation === "files") await window.escode.listDirectory(root, "app-state").then((result) => { if (result.kind !== "available") throw Error(result.message); return result.listing.entries; });
            else if (operation === "read")
              await window.escode.project("read", root, "app-state/client-workspace-v1.json");
            else
              await window.escode.project(
                "save",
                root,
                "app-state/client-workspace-v1.json",
                "overwrite",
                "bad",
              );
            return "accepted";
          } catch (error) {
            return String(error);
          }
        },
        { root, operation },
      );
      expect(error).toContain("App state is unavailable");
    }
    for (const path of [".git", "app-state", "./a.txt", "../repo/a.txt", "/tmp"]) {
      const error = await page.evaluate(
        async ({ root, path }) => {
          try {
            await window.escode.project("entry-action", root, path, "copy-path");
            return "accepted";
          } catch (error) {
            return String(error);
          }
        },
        { root, path },
      );
      expect(error).not.toBe("accepted");
    }
    expect(
      await page.evaluate(async (root) => {
        try {
          const result = await window.escode.listDirectory(root, "app-state");
          if (result.kind !== "available") throw Error(result.message);
          return "accepted";
        } catch (error) {
          return String(error);
        }
      }, root),
    ).toContain("App state is unavailable");
    for (const [parent, name] of [
      ["app-state", "new"],
      ["", "app-state"],
      [".git", "new"],
      ["", "../escape"],
    ]) {
      const error = await page.evaluate(
        async ({ root, parent, name }) => {
          try {
            await window.escode.project("create-entry", root, parent, name, "file");
            return "accepted";
          } catch (error) {
            return String(error);
          }
        },
        { root, parent, name },
      );
      expect(error).not.toBe("accepted");
    }
    for (const path of [".", "../repo/a.txt", ".git", "app-state"]) {
      const error = await page.evaluate(
        async ({ root, path }) => {
          try {
            await window.escode.project("file-operation", root, "move", path, "new");
            return "accepted";
          } catch (e) {
            return String(e);
          }
        },
        { root, path },
      );
      expect(error).not.toBe("accepted");
    }
    expect(
      await page.evaluate(async () => {
        try {
          await window.escode.project("file-operation", "/unapproved", "move", "a", "b");
          return "accepted";
        } catch (e) {
          return String(e);
        }
      }),
    ).toContain("approve");
    const otherSender = await app.evaluate(async ({ BrowserWindow, app }, root) => {
      const original = BrowserWindow.getAllWindows()[0];
      const other = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: app.getAppPath() + "/dist/host/preload.cjs",
          contextIsolation: true,
          sandbox: true,
        },
      });
      try {
        await other.loadURL(original.webContents.getURL());
        return await other.webContents.executeJavaScript(
          `window.escode.project("file-operation", ${JSON.stringify(root)}, "move", "a.txt", "stolen").then(() => "accepted", e => String(e))`,
        );
      } finally {
        other.destroy();
      }
    }, root);
    expect(otherSender).toContain("Invalid sender");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("keep");
  } finally {
    app.process().kill("SIGKILL");
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

for (const choice of ["Save", "Discard", "Cancel"] as const) {
  test(`batch Trash ${choice}: hidden nested selection, mixed entries and per-item retention`, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "escode-batch-trash-")));
    const root = join(base, "repo"),
      user = join(base, "user");
    execFileSync("git", ["init", root]);
    await mkdir(join(root, "folder"));
    await writeFile(join(root, "folder/a.txt"), "disk a");
    await writeFile(join(root, "clean.txt"), "clean bytes");
    await writeFile(join(root, "fail.txt"), "failed bytes");
    const app = await launchDesktop(user);
    try {
      const page = await app.firstWindow();
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await page.getByRole("treeitem", { name: /^fail.txt/ }).click();
      await page.locator(".monaco-editor:visible").click();
      await page.keyboard.press("Meta+a");
      await page.keyboard.type("unsaved failed");
      await page.getByRole("treeitem", { name: "folder", exact: true }).click();
      await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
      await page.locator(".monaco-editor:visible").click();
      await page.keyboard.press("Meta+a");
      await page.keyboard.type("unsaved a");
      // Select the dirty child and its folder, then retain that selection hidden by collapse.
      await page
        .getByRole("treeitem", { name: "folder", exact: true })
        .locator(":scope > .tree-row")
        .click({ modifiers: ["Meta"] });
      await page.getByRole("button", { name: "Collapse All", exact: true }).click();
      await page
        .getByRole("treeitem", { name: "clean.txt", exact: true })
        .click({ modifiers: ["Meta"] });
      await page.getByRole("treeitem", { name: /^fail.txt/ }).click({ modifiers: ["Meta"] });
      await app.evaluate(({ dialog }, choice) => {
        const cp = process.getBuiltinModule("child_process") as any,
          execute = cp.execFileSync;
        (globalThis as any).trashFixtures = [];
        cp.execFileSync = (...args: any[]) => {
          if (args[1]?.[0] === "trash" && args[1]?.includes("fail.txt"))
            throw Error("injected permission failure");
          const result = execute(...args);
          if (args[1]?.[0] === "trash") (globalThis as any).trashFixtures.push(result.toString());
          return result;
        };
        dialog.showMessageBox = async (...args: any[]) => {
          (globalThis as any).confirmation = args.at(-1);
          return {
            response: choice === "Save" ? 0 : choice === "Discard" ? 1 : 2,
            checkboxChecked: false,
          };
        };
      }, choice);
      await page.getByRole("tree", { name: "Files", exact: true }).focus();
      await page.keyboard.press("Meta+Backspace");
      await expect.poll(() => app.evaluate(() => !!(globalThis as any).confirmation)).toBe(true);
      const confirmation = await app.evaluate(() => (globalThis as any).confirmation);
      expect(confirmation.message).toBe("Move 3 items to macOS Trash?");
      expect(confirmation.detail).toContain(root + "/folder");
      expect(confirmation.detail).toContain("Dirty descendants (2)");
      expect(confirmation.detail).toContain(root + "/folder/a.txt");
      if (choice === "Cancel") {
        await expect(page.locator(".content:visible > [role=status]")).toContainText("Cancelled");
        expect(await readFile(join(root, "folder/a.txt"), "utf8")).toBe("disk a");
        expect(
          JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts.find(
            (d: any) => d.path === "folder/a.txt",
          ).text,
        ).toBe("unsaved a");
      } else {
        await expect(page.locator(".content:visible > [role=status]")).toContainText(
          "injected permission failure",
        );
        await expect(readFile(join(root, "folder/a.txt"))).rejects.toThrow();
        await expect(readFile(join(root, "clean.txt"))).rejects.toThrow();
        expect(await readFile(join(root, "fail.txt"), "utf8")).toBe(
          choice === "Save" ? "unsaved failed" : "failed bytes",
        );
        const fixtures = await app.evaluate(() => (globalThis as any).trashFixtures as string[]);
        expect(fixtures).toHaveLength(2);
        expect(await readFile(join(fixtures[0], "a.txt"), "utf8")).toBe(
          choice === "Save" ? "unsaved a" : "disk a",
        );
        expect(await readFile(fixtures[1], "utf8")).toBe("clean bytes");
        const retained = JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts;
        expect(retained.map((d: any) => d.path)).toEqual(["fail.txt"]);
        expect(retained[0].text).toBe("unsaved failed");
        await expect(page.getByRole("tree", { name: "Files", exact: true })).toBeFocused();
        if (choice === "Discard") await page.screenshot({ path: "/tmp/escode-files-42-batch.png" });
      }
    } finally {
      const fixtures = await app
        .evaluate(() => (globalThis as any).trashFixtures ?? [])
        .catch(() => []);
      for (const path of fixtures) await rm(path, { recursive: true, force: true });
      app.process().kill("SIGKILL");
      await rm(base, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}

for (const change of ["missing", "root swap"] as const) {
  test(`batch confirmation revalidates ${change} and reports actual per-item disk outcomes`, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "escode-batch-origin-")));
    const root = join(base, "repo"),
      user = join(base, "user");
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a.txt"), "original a");
    await writeFile(join(root, "b.txt"), "original b");
    const app = await launchDesktop(user);
    try {
      const page = await app.firstWindow();
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await page.getByRole("treeitem", { name: "a.txt", exact: true }).click({ button: "right" });
      await page.keyboard.press("Escape");
      await page
        .getByRole("treeitem", { name: "b.txt", exact: true })
        .click({ modifiers: ["Meta"] });
      await app.evaluate(({ dialog }) => {
        const cp = process.getBuiltinModule("child_process") as any,
          execute = cp.execFileSync;
        (globalThis as any).trashFixtures = [];
        cp.execFileSync = (...args: any[]) => {
          const result = execute(...args);
          if (args[1]?.[0] === "trash") (globalThis as any).trashFixtures.push(result.toString());
          return result;
        };
        dialog.showMessageBox = async () =>
          new Promise((resolve) => {
            (globalThis as any).confirmTrash = () =>
              resolve({ response: 0, checkboxChecked: false });
          });
      });
      // Context menu keeps the selected batch.
      await page.getByRole("treeitem", { name: "b.txt", exact: true }).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
      await expect.poll(() => app.evaluate(() => !!(globalThis as any).confirmTrash)).toBe(true);
      if (change === "missing") await rm(join(root, "a.txt"));
      else {
        const { rename } = await import("node:fs/promises");
        await rename(root, root + "-original");
        execFileSync("git", ["init", root]);
        await writeFile(join(root, "a.txt"), "replacement a");
        await writeFile(join(root, "b.txt"), "replacement b");
      }
      await app.evaluate(() => (globalThis as any).confirmTrash());
      await expect(page.locator(".content:visible > [role=status]")).toContainText(
        root + "/a.txt:",
      );
      if (change === "missing") {
        await expect(page.locator(".content:visible > [role=status]")).toContainText(
          "Moved to macOS Trash",
        );
        const fixtures = await app.evaluate(() => (globalThis as any).trashFixtures as string[]);
        expect(fixtures).toHaveLength(1);
        expect(await readFile(fixtures[0], "utf8")).toBe("original b");
      } else {
        await expect(page.locator(".content:visible > [role=status]")).toContainText("replaced");
        expect(await readFile(join(root, "a.txt"), "utf8")).toBe("replacement a");
        expect(await readFile(join(root + "-original", "b.txt"), "utf8")).toBe("original b");
        expect(await app.evaluate(() => (globalThis as any).trashFixtures)).toEqual([]);
      }
    } finally {
      const fixtures = await app
        .evaluate(() => (globalThis as any).trashFixtures ?? [])
        .catch(() => []);
      for (const path of fixtures) await rm(path, { recursive: true, force: true });
      app.process().kill("SIGKILL");
      await rm(base, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}

test("mixed batch save conflict retains the failed draft and uses ordinary conflict controls", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-batch-conflict-")));
  const root = join(base, "repo"),
    user = join(base, "user");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "disk a");
  await writeFile(join(root, "b.txt"), "disk b");
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("retained a");
    await writeFile(join(root, "a.txt"), "external a");
    await page.getByRole("treeitem", { name: "b.txt", exact: true }).click({ modifiers: ["Meta"] });
    await app.evaluate(({ dialog }) => {
      const cp = process.getBuiltinModule("child_process") as any,
        execute = cp.execFileSync;
      (globalThis as any).trashFixtures = [];
      cp.execFileSync = (...args: any[]) => {
        const result = execute(...args);
        if (args[1]?.[0] === "trash") (globalThis as any).trashFixtures.push(result.toString());
        return result;
      };
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.getByRole("tree", { name: "Files", exact: true }).focus();
    await page.keyboard.press("Meta+Delete");
    await expect(page.locator(".conflict")).toContainText("a.txt changed on disk");
    await expect(page.locator(".content:visible > [role=status]")).toContainText(
      "Save conflict: a.txt",
    );
    await expect(page.locator(".content:visible > [role=status]")).toContainText(
      "b.txt: Moved to macOS Trash",
    );
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("external a");
    const drafts = JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts;
    expect(drafts).toHaveLength(1);
    expect(drafts[0].text).toBe("retained a");
    await page.locator(".conflict").getByRole("button", { name: "Overwrite", exact: true }).click();
    await expect.poll(() => readFile(join(root, "a.txt"), "utf8")).toBe("retained a");
    await expect(page.locator(".conflict")).toHaveCount(0);
  } finally {
    const fixtures = await app
      .evaluate(() => (globalThis as any).trashFixtures ?? [])
      .catch(() => []);
    for (const path of fixtures) await rm(path, { recursive: true, force: true });
    app.process().kill("SIGKILL");
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});
