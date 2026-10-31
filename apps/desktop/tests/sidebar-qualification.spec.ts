import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop, auditTextContrast } from "./desktop";

test("Files Diff Chats retain keyboard controls at desktop narrow short and native 200 percent", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-sidebar-qualification-")));
  const root = join(dir, "project");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "example.txt"), "A changed file for sidebar qualification\n");
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "example.txt", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("A changed file");
    for (const [width, height, zoom] of [[1000,700,1], [600,700,1], [1000,450,1], [1200,900,2]]) {
      await page.setViewportSize({ width, height });
      await app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom);
      for (const mode of ["Files", "Diff", "Chats"]) {
        const control = page.getByRole("button", { name: mode, exact: true });
        await control.focus();
        await page.keyboard.press("Enter");
        await expect(control).toBeFocused();
        await expect(control).toHaveAttribute("aria-pressed", "true");
        await expect(control).toBeInViewport();
        const contrast = await control.evaluate(element => {
          const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
          const luminance = (values: number[]) => values.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
          let parent: Element | null = element;
          while (parent && getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)") parent = parent.parentElement;
          const foreground = luminance(rgb(getComputedStyle(element).color));
          const background = luminance(rgb(getComputedStyle(parent!).backgroundColor));
          return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
        if (mode !== "Chats") expect((await page.locator(".toolbar > span").boundingBox())!.height).toBeLessThan(40);
        expect(await auditTextContrast(page)).toEqual([]);
        await page.screenshot({ path: `test-results/sidebar-${mode}-${width}-${height}-${zoom}.png` });
      }
      const resize = page.getByRole("separator", { name: "Resize sidebar", exact: true });
      await resize.focus();
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      await expect(resize).toBeFocused();
      await expect(resize).toHaveAttribute("aria-valuenow", "200");
    }
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
