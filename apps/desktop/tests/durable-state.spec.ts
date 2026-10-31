import { DatabaseSync } from "node:sqlite";
import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchDesktop } from "./desktop";

test("packaged SQLite worker retains authenticated drafts and identities on restart", async () => {
  const user = await mkdtemp(join(tmpdir(), "escode-durable-packaged-"));
  let app = await launchDesktop(user, undefined, true);
  try {
    let page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "Open project…" })).toBeVisible();
    const chat = await page.evaluate(() => window.escode.chat("createDraft", null));
    await page.evaluate(chat => window.escode.chat("draft", null, chat.id, "retained draft"), chat);
    const identity = () => { const db = new DatabaseSync(join(user, "durable-chats-v1.sqlite-state-v1/state.sqlite"), { readOnly: true }); try { return db.prepare("SELECT hostId, clientId FROM identity").get()!; } finally { db.close(); } };
    const before = identity();
    await app.close();
    app = await launchDesktop(user, undefined, true);
    page = await app.firstWindow();
    await expect(page.getByRole("button", { name: "Open project…" })).toBeVisible();
    const reopened = await page.evaluate(chat => window.escode.chat("open", null, chat.id), chat);
    expect(reopened).toMatchObject({ chatId: chat.id, threadId: null });
    expect(await page.evaluate(chat => window.escode.chat("composer", null, chat.id), chat)).toBe("retained draft");
    const after = identity();
    expect([after.hostId, after.clientId]).toEqual([before.hostId, before.clientId]);
  } finally { await app.close(); await rm(user, { recursive: true, force: true }); }
});
