import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";

test("packaged retention settings support keyboard editing and persisted Never", async () => {
  const user = await mkdtemp(join(tmpdir(), "escode-retention-ui-"));
  let app = await launchDesktop(user, undefined, true);
  try {
    let page = await app.firstWindow();
    const settings = page.locator("summary", { hasText: "Settings" });
    await settings.focus(); await page.keyboard.press("Enter");
    const days = page.getByRole("spinbutton", { name: "Inactivity period (days)" });
    await expect(days).toHaveValue("30");
    await expect(page.getByText(/cannot recover expired contents/)).toBeVisible();
    await expect(page.getByText(/not a storage-size limit/)).toBeVisible();
    await days.fill("7"); await page.getByRole("button", { name: "Save retention" }).click();
    await expect(page.getByRole("status")).toContainText("retention saved");
    await expect(page.getByRole("button", { name: "Save retention" })).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.escode.checkpointRetention())).toBe(7);
    const never = page.getByRole("checkbox", { name: "Never expire" });
    await never.focus(); await page.keyboard.press("Space");
    await expect(days).toBeDisabled();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Save retention" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.escode.checkpointRetention())).toBeNull();
    await app.close(); app = await launchDesktop(user, undefined, true); page = await app.firstWindow();
    await page.locator("summary", { hasText: "Settings" }).click();
    await expect(page.getByRole("checkbox", { name: "Never expire" })).toBeChecked();
    await page.screenshot({ path: "test-results/retention-settings.png" });
  } finally { await app.close(); await rm(user, { recursive: true, force: true }); }
});
