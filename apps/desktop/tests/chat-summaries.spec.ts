import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";

test("fresh summaries exclude old metadata and bodies, synchronize activity, and release navigation interests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "escode-summaries-"));
  const user = join(directory, "user");
  await mkdir(user);
  const legacy = '[{"id":"old-chat","draft":"legacy secret"}]';
  await writeFile(join(user, "chats.json"), legacy);
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await expect(page.getByText("No saved chats. Start without a project or open a project.")).toBeVisible();
    const draft = await page.evaluate(() => window.escode.chat("createDraft", null));
    await page.evaluate(id => window.escode.chat("draft", null, id, "private composer"), draft.id);
    await expect(page.locator(".agent-row")).toHaveCount(1);
    const payload = await page.evaluate(() => new Promise<string>((resolve, reject) => {
      const off = window.escode.chatSummaries(value => { off(); resolve(JSON.stringify(value)); }, reject);
    }));
    expect(payload).toContain(draft.id);
    expect(payload).not.toMatch(/private composer|legacy secret|items|requests|draft":/);
    expect(await readFile(join(user, "chats.json"), "utf8")).toBe(legacy);
    await expect(page.evaluate(() => window.escode.chat("catalogue" as never))).rejects.toThrow();
    await page.locator(".agent-row").click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("private composer");
    // A context change keeps the identity in the shared list without duplicate rows.
    await page.evaluate(id => window.escode.chat("context", null, id, null), draft.id);
    await expect(page.locator(".agent-row")).toHaveCount(1);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
