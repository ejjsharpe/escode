import { test, expect, _electron } from "@playwright/test";
import { resolve } from "node:path";
test("packaged app loads CSS, Monaco and tools without a development PATH", async () => {
  const app = await _electron.launch({
    executablePath: resolve("release/mac-arm64/escode.app/Contents/MacOS/escode"),
    env: { HOME: process.env.HOME!, PATH: "/usr/bin:/bin", TMPDIR: process.env.TMPDIR! },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByRole("button", { name: "Open project…" })).toBeVisible();
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(24, 32, 43)");
    expect(await page.evaluate(() => typeof (window as any).require)).toBe("undefined");
    expect(await page.evaluate(() => Object.keys((window as any).escode))).toEqual([
      "chat",
      "toolStatus",
      "project",
    ]);
    await expect(page.evaluate(() => (window as any).escode.toolStatus())).resolves.toHaveProperty(
      "git.version",
    );
    expect(errors).toEqual([]);
    await page.screenshot({ path: "test-results/packaged.png" });
  } finally {
    await app.close();
  }
});
