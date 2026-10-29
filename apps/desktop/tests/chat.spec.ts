import { test, expect, _electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import electron from "electron";
// Explicit opt-in: this exercises installed, authenticated Codex and consumes a turn.
test("saved Codex chat streams and reopens via a fresh connection", async () => {
  test.skip(
    process.env.ESCODE_LIVE_CHAT !== "1",
    "Set ESCODE_LIVE_CHAT=1 with supported authenticated Codex.",
  );
  test.setTimeout(180000);
  const root = await mkdtemp(join(tmpdir(), "escode-chat-ui-"));
  const userData = await mkdtemp(join(tmpdir(), "escode-chat-user-"));
  execFileSync("git", ["init", root]);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ESCODE_DEV_URL;
  const packaged = process.env.ESCODE_PACKAGED_CHAT === "1";
  if (packaged) env.PATH = "/usr/bin:/bin";
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
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "New chat on current checkout" }).click();
    await expect(page.getByRole("status")).toHaveText("Ready", { timeout: 45000 });
    await page
      .getByLabel("Message Codex")
      .fill("Reply with exactly ESCODE_UI_OK. Do not use tools or change files.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByLabel("Conversation history")).toContainText("ESCODE_UI_OK", {
      timeout: 90000,
    });
    await expect(page.getByRole("status")).toHaveText("Ready", { timeout: 90000 });
    await expect(page.getByLabel("Conversation history").locator("article")).toHaveCount(2);
    await page.getByLabel("Message Codex").fill("retained draft");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("retained draft");
    await page.getByRole("button", { name: "Retry connection / reload history" }).click();
    await expect(page.getByRole("status")).toHaveText("Ready", { timeout: 45000 });
    await expect(page.getByLabel("Conversation history").locator("article")).toHaveCount(2);
    await expect(page.getByLabel("Conversation history")).toContainText("ESCODE_UI_OK");
    await expect(page.getByLabel("Message Codex")).toHaveValue("retained draft");
    await page.screenshot({
      path: `test-results/chat-${packaged ? "packaged" : "unpackaged"}.png`,
    });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
