import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";

test("Agents composer and navigation fit desktop and short windows", async () => {
  const user = await mkdtemp(join(tmpdir(), "escode-agents-design-"));
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "Message Codex", exact: true });
    await expect(composer).toBeFocused();
    await composer.fill("Review the changes and explain what needs attention.");
    for (const [width, height] of [[1440, 900], [1024, 768], [728, 600]]) {
      await page.setViewportSize({ width, height });
      await composer.scrollIntoViewIfNeeded();
      await expect(composer).toBeInViewport({ ratio: 1 });
      const send = page.getByRole("button", { name: "Send message", exact: true });
      await send.scrollIntoViewIfNeeded();
      await expect(send).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      await expect(composer).toHaveValue("Review the changes and explain what needs attention.");
      await page.screenshot({ path: `test-results/agents-design-${width}.png` });
    }
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await app.close();
    await rm(user, { recursive: true, force: true });
  }
});
