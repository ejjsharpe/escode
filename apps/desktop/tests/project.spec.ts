import { test, expect, _electron } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import electron from "electron";
for (const packaged of [false, true]) {
  test(`${packaged ? "packaged" : "unpackaged"}: edit, navigate, cancel conflict, compare and explicitly overwrite`, async () => {
    const root = await mkdtemp(join(tmpdir(), "escode-ui-"));
    const userData = await mkdtemp(join(tmpdir(), "escode-project-user-"));
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a.txt"), "original\n");
    const env = { ...process.env };
    if (packaged) env.PATH = "/usr/bin:/bin";
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ESCODE_DEV_URL;
    const app = await _electron.launch({
      executablePath: packaged
        ? resolve("release/mac-arm64/escode.app/Contents/MacOS/escode")
        : (electron as unknown as string),
      args: [...(packaged ? [] : ["."]), `--user-data-dir=${userData}`],
      env,
    });
    try {
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Open project…" }).click();
      await expect(page.locator("header")).toContainText(root);
      await page.getByRole("button", { name: "a.txt", exact: true }).click();
      await page.locator(".monaco-editor").click();
      await page.keyboard.press("Meta+a");
      await page.keyboard.type("my edits");
      await expect(page.getByText("a.txt • Unsaved", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Source Control", exact: true }).click();
      await page.getByRole("button", { name: "Files", exact: true }).click();
      await expect(page.locator(".monaco-editor")).toContainText("my edits");
      await writeFile(join(root, "a.txt"), "external\n");
      await page.keyboard.press("Meta+s");
      await expect(page.locator(".conflict")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Source Control", exact: true }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "Compare", exact: true }).click();
      await expect(page.locator(".monaco-diff-editor")).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(await readFile(join(root, "a.txt"), "utf8")).toBe("external\n");
      await page.keyboard.press("Meta+s");
      await expect(page.locator(".conflict")).toBeVisible();
      await writeFile(join(root, "a.txt"), "changed after comparison");
      await page.getByRole("button", { name: "Overwrite", exact: true }).click();
      await expect(page.locator(".conflict")).toBeVisible();
      expect(await readFile(join(root, "a.txt"), "utf8")).toBe("changed after comparison");
      await page.getByRole("button", { name: "Compare", exact: true }).click();
      await expect(page.locator(".monaco-diff-editor")).toContainText("changed after comparison");
      await page.getByRole("button", { name: "Overwrite", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Saved a.txt");
      expect(await readFile(join(root, "a.txt"), "utf8")).toBe("my edits");
      await writeFile(join(root, "a.txt"), "reload this");
      await page.keyboard.press("Meta+s");
      await page.getByRole("button", { name: "Reload", exact: true }).click();
      await expect(page.getByRole("button", { name: "Files", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.locator(".monaco-diff-editor")).toHaveCount(0);
      await expect(page.locator(".monaco-editor")).toContainText("reload this");
      await expect(page.getByText("a.txt • Unsaved", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Source Control", exact: true }).click();
      await page.getByRole("button", { name: "a.txt", exact: true }).click();
      await expect(page.locator(".monaco-diff-editor")).toContainText("reload this");
      await writeFile(join(root, "a.txt"), "new external");
      await expect(page.locator(".monaco-diff-editor")).toContainText("new external", {
        timeout: 8000,
      });
      await page.getByRole("button", { name: "Files", exact: true }).click();
      await expect(page.getByRole("button", { name: "Files", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.locator(".monaco-diff-editor")).toHaveCount(0);
      await expect(page.locator(".monaco-editor")).toContainText("reload this");
      await page.getByRole("button", { name: "Source Control", exact: true }).click();
      await expect(page.locator(".monaco-diff-editor")).toContainText("new external");
      await page.getByRole("button", { name: "Files", exact: true }).click();
      await page.locator(".monaco-editor").click();
      await page.keyboard.press("Meta+a");
      await page.keyboard.type("retained after error");
      await rm(join(root, "a.txt"));
      await page.keyboard.press("Meta+s");
      await expect(page.getByRole("status")).toContainText("ENOENT");
      await expect(page.locator(".monaco-editor")).toContainText("retained after error");
      await page.screenshot({
        path: `test-results/project-${packaged ? "packaged" : "unpackaged"}.png`,
      });
    } finally {
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async (_window: unknown, options: any) => ({
          response: options.buttons[0] === "Save" ? 1 : 0,
          checkboxChecked: false,
        });
      });
      await app.close();
      await rm(userData, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });
}
