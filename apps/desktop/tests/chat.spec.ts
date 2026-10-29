import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";
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
  const packaged = process.env.ESCODE_PACKAGED_CHAT === "1" || process.env.ESCODE_PACKAGED === "1";
  const app = await launchDesktop(userData, process.env.ESCODE_TEST_CODEX_DIR, packaged);
  try {
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    const page = await app.firstWindow();
    const tools = (await page.evaluate(() => window.escode.toolStatus())) as {
      codex: { path?: string; version?: string };
    };
    console.log("Codex under test:", tools.codex.path, tools.codex.version);
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
    await expect(
      page.getByLabel("Conversation history").getByRole("heading", { name: "You", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByLabel("Conversation history").getByRole("heading", { name: "Codex", exact: true }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Retry connection / reload history" }).click();
    await expect(page.getByRole("status")).toHaveText("Ready", { timeout: 45000 });
    await page.getByLabel("Message Codex").fill("retained draft");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("retained draft");
    await page.getByRole("button", { name: "Retry connection / reload history" }).click();
    await expect(page.getByRole("status")).toHaveText("Ready", { timeout: 45000 });
    await expect(
      page.getByLabel("Conversation history").getByRole("heading", { name: "You", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByLabel("Conversation history").getByRole("heading", { name: "Codex", exact: true }),
    ).toHaveCount(1);
    await expect(page.getByLabel("Conversation history")).toContainText("ESCODE_UI_OK");
    await expect(page.getByLabel("Message Codex")).toHaveValue("retained draft");
    await page.screenshot({
      path: `test-results/chat-${packaged ? "packaged" : "unpackaged"}.png`,
    });
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options?: any) => ({
        response: options.buttons[0] === "Save" ? 1 : 0,
        checkboxChecked: false,
      });
    });
    await app.close();
    await rm(root, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
