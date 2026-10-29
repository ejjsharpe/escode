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
    await page.getByRole("button", { name: "▸ folder", exact: true }).click();
    await page.getByRole("button", { name: /^b.txt/ }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("dirty b");
    await page.getByRole("button", { name: "a.ts", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.type("dirty a");
    await page.getByRole("button", { name: "↑ Parent folder" }).click();
    await page.getByRole("button", { name: "Rename/move folder", exact: true }).click();
    await expect(page.getByText(/Earlier text undo history resets/)).toBeVisible();
    await page.getByRole("textbox", { name: "Checkout-relative destination" }).fill("moved");
    await page.getByRole("button", { name: "Apply move", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Earlier text undo history was reset");
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
          JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts.find(
            (d: any) => d.path === "moved/a.ts",
          )?.text,
      )
      .toContain("dirty a subsequent");
    await page.keyboard.press("Meta+z");
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts.find(
            (d: any) => d.path === "moved/a.ts",
          )?.text,
      )
      .not.toContain("subsequent");
    const state = JSON.parse(await readFile(join(user, "workspace.json"), "utf8"));
    expect(state.drafts.map((d: any) => d.path).sort()).toEqual(["moved/a.ts", "moved/b.txt"]);
    expect(state.drafts[0].text).toContain("dirty");
    expect(await readFile(join(root, "moved/b.txt"), "utf8")).toBe("disk b");
    await writeFile(join(root, "moved/a.ts"), "external");
    await page.getByRole("button", { name: "Save ⌘S" }).click();
    await expect(page.locator(".conflict")).toContainText("moved/a.ts changed on disk");
    app.process().kill("SIGKILL");
    await new Promise((resolve) => app.process().once("exit", resolve));
    app = await launchDesktop(user);
    page = await app.firstWindow();
    await expect(page.locator(".monaco-editor:visible")).toContainText("dirty a");
    await expect(page.locator(".toolbar")).toContainText("moved/a.ts");
    await page.getByRole("button", { name: "▸ moved", exact: true }).click();
    await page.getByRole("button", { name: /^b.txt/ }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("dirty b");
    await page.getByRole("button", { name: "Save ⌘S" }).click();
    await expect.poll(() => readFile(join(root, "moved/b.txt"), "utf8")).toBe("dirty b");
    await page.getByRole("button", { name: "Rename/move moved/a.ts", exact: true }).click();
    await page.getByRole("textbox", { name: "Checkout-relative destination" }).fill("moved/a.json");
    await page.getByRole("button", { name: "Apply move", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Earlier text undo history was reset");
    await page.getByRole("button", { name: /^a.json/ }).click();
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
    await rm(base, { recursive: true, force: true });
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
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
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
    await expect(page.getByRole("status")).toContainText("Cancelled");
    expect((await app.evaluate(() => (globalThis as any).confirmation)).detail).toContain(
      "Dirty descendants (1)",
    );
    await writeFile(join(roots[0], "a.txt"), "external");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Save conflict");
    expect(JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts[0].text).toBe(
      "unsaved",
    );
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
    await expect(page.getByRole("status")).toContainText("injected native Trash failure");
    expect(await readFile(join(roots[0], "a.txt"), "utf8")).toBe("external");
    expect(await readFile(join(roots[1], "a.txt"), "utf8")).toBe("disk");
    expect(JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts[0].text).toBe(
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
    await expect(page.getByRole("status")).toContainText("Moved to macOS Trash");
    expect(JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts).toEqual([]);
    await page.getByRole("button", { name: "two", exact: true }).click();
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("save before trash");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Moved to macOS Trash");
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
    await rm(base, { recursive: true, force: true });
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
    await rm(base, { recursive: true, force: true });
  }
});
