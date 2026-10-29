import { test, expect } from "@playwright/test";
import { mkdtemp, rm, realpath } from "node:fs/promises";
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
    await expect(page.getByRole("status")).toHaveText("Draft");
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

// Real installed provider through Electron IPC; no controlled protocol executable.
test("installed Codex accepts scratch and deferred worktree drafts through Electron and fresh history", async () => {
  test.skip(process.env.ESCODE_LIVE_CHAT !== "1", "Requires installed authenticated Codex");
  test.setTimeout(240000);
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-integrated-live-")));
  const root = join(dir, "Alpha"), user = join(dir, "user");
  execFileSync("git", ["init", root]);
  execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-m", "initial"]);
  const app = await launchDesktop(user, process.env.ESCODE_TEST_CODEX_DIR);
  try {
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.locator("header")).toContainText(root);
    const chats = await page.evaluate(async (root) => {
      const project = await window.escode.chat("createDraft", root);
      const options = await window.escode.project("worktree-options", root);
      const base = options.bases.find((b) => b.ref === options.defaultRef)!;
      await window.escode.chat("execution", root, project.id, "new", base.ref, base.commit);
      const a = await window.escode.chat("createDraft", null);
      await window.escode.chat("draft", null, a.id, "keep draft distinct");
      const b = await window.escode.chat("createDraft", null);
      await Promise.all([project, a, b].map((c) => window.escode.chat("send", c.project, c.id,
        "Reply exactly INTEGRATED_LIVE_OK. Do not use tools or change files.")));
      return [project, a, b];
    }, root);
    for (const c of chats) {
      await expect.poll(async () => (await page.evaluate((c) => window.escode.chat("snapshot", c.project, c.id), c)).busy, { timeout: 120000 }).toBe(false);
      await page.evaluate((c) => window.escode.chat("disconnect", c.project, c.id), c);
      await page.evaluate((c) => window.escode.chat("open", c.project, c.id), c);
      const snapshot = await page.evaluate((c) => window.escode.chat("snapshot", c.project, c.id), c);
      expect(snapshot.error).toBeNull();
      expect(snapshot.items.filter((i) => i.type === "userMessage")).toHaveLength(1);
      expect(snapshot.items.filter((i) => i.type === "agentMessage").map((i) => i.text).join("")).toContain("INTEGRATED_LIVE_OK");
      expect(snapshot.settings.model).toBeTruthy();
      console.log("Integrated installed-Codex settings", JSON.stringify(snapshot.settings));
    }
    const saved = await page.evaluate(async (root) => [...await window.escode.chat("list", root), ...await window.escode.chat("list", null)], root);
    expect(new Set(saved.map((c) => c.checkout)).size).toBe(3);
    expect(saved[0].checkout).not.toBe(root);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.locator(".agent-row").filter({ hasText: "No project" }).first().click();
    await expect(page.getByLabel("Conversation history")).toContainText("INTEGRATED_LIVE_OK");
    await page.screenshot({ path: "test-results/integrated-live.png" });
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
