import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("fresh summaries exclude old metadata and bodies, release detail polling during navigation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "escode-summaries-"));
  const user = join(directory, "user");
  const root = join(directory, "project");
  execFileSync("git", ["init", root]);
  await mkdir(user);
  const legacy = '[{"id":"old-chat","draft":"legacy secret"}]';
  await writeFile(join(user, "chats.json"), legacy);
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await app.evaluate(async ({ dialog, webContents }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      (globalThis as any).detailCalls = {};
      const debugger_ = webContents.getAllWebContents()[0].debugger;
      debugger_.attach("1.3");
      await debugger_.sendCommand("Network.enable");
      debugger_.on("message", (_event: unknown, method: string, params: any) => {
        if (method !== "Network.webSocketFrameSent") return;
        try {
          const request = JSON.parse(params.response.payloadData);
          if (request.tag !== "chatSnapshot") return;
          const counts = (globalThis as any).detailCalls;
          counts[request.payload.id] = (counts[request.payload.id] ?? 0) + 1;
        } catch { /* Ignore other transport frames. */ }
      });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: "project", exact: true })).toHaveAttribute("aria-pressed", "true");
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
    await expect.poll(() => app.evaluate((_e, id) => (globalThis as any).detailCalls[id] ?? 0, draft.id)).toBeGreaterThan(0);
    const second = await page.evaluate(async () => {
      const chat = await window.escode.chat("createDraft", null);
      await window.escode.chat("draft", null, chat.id, "second composer");
      return chat;
    });
    await expect(page.locator(".agent-row")).toHaveCount(2);
    await page.locator(".agent-row").filter({ hasText: "Chat 2" }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("second composer");
    await page.waitForTimeout(400);
    const previous = await app.evaluate((_e, id) => (globalThis as any).detailCalls[id], draft.id);
    await page.waitForTimeout(700);
    expect(await app.evaluate((_e, id) => (globalThis as any).detailCalls[id], draft.id)).toBe(previous);
    await page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: "project", exact: true }).click();
    await page.waitForTimeout(400);
    const calls = await app.evaluate(() => (globalThis as any).detailCalls);
    await page.waitForTimeout(700);
    expect(await app.evaluate(() => (globalThis as any).detailCalls)).toEqual(calls);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    // A context change keeps the identity in the shared list without duplicate rows.
    await page.evaluate(id => window.escode.chat("context", null, id, null), draft.id);
    await expect(page.locator(".agent-row")).toHaveCount(2);
    expect(second.id).not.toBe(draft.id);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
