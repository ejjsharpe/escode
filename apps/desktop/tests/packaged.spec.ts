import { test, expect } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";
import { execFileSync } from "node:child_process";
test("packaged app loads CSS, Monaco and tools without a development PATH", async () => {
  const user = await mkdtemp(join(tmpdir(), "escode-packaged-"));
  const root = join(user, "repo");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "fixture.json"), '{"broken": }');
  const app = await launchDesktop(user, undefined, true);
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByRole("button", { name: "Open project…" })).toBeVisible();
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(24, 32, 43)");
    expect(await page.evaluate(() => typeof (window as any).require)).toBe("undefined");
    expect(await page.evaluate(() => Object.keys((window as any).escode))).toEqual([
      "lifecycle",
      "onClose",
      "chat",
      "toolStatus",
      "project",
    ]);
    await expect(page.evaluate(() => (window as any).escode.toolStatus())).resolves.toHaveProperty(
      "git.version",
    );
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "fixture.json", exact: true }).click();
    await expect(page.locator(".squiggly-error")).toBeVisible();
    expect(errors).toEqual([]);
    await page.screenshot({ path: "test-results/packaged.png" });
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options?: any) => ({
        response: options.buttons[0] === "Save" ? 1 : 0,
        checkboxChecked: false,
      });
    });
    await app.close();
    await rm(user, { recursive: true, force: true });
  }
});
