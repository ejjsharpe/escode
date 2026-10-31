import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { launchDesktop, readChats } from "./desktop";

// Opt-in paid turn, fresh app state and repository; never opens personal chats.
test("installed provider historical UI survives restart and recovery without replay", async () => {
  test.skip(process.env.ESCODE_LIVE_CHAT !== "1", "Requires authenticated installed Codex");
  test.setTimeout(180000);
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-141-live-")));
  const root = join(dir, "repo"), user = join(dir, "user"), recovered = join(dir, "recovered");
  await mkdir(root); await mkdir(recovered);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]);
  git("init"); await writeFile(join(root, "saved.txt"), "original"); git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "fixture");
  let app = await launchDesktop(user, process.env.ESCODE_TEST_CODEX_DIR, true);
  const close = async () => {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await app.close();
  };
  const show = async () => {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    return page;
  };
  try {
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    let page = await app.firstWindow();
    await page.evaluate(() => window.escode.chat("targets"));
    await page.getByRole("button", { name: "Open project…" }).click();
    page = await show();
    await page.getByRole("button", { name: "New chat on current checkout" }).click();
    await page.getByLabel("Message Codex").fill("Reply exactly ESCODE_HISTORICAL_LIVE_OK. Do not use tools or change files.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Ready$/ })).toBeVisible({ timeout: 90000 });
    await expect(page.getByLabel("Conversation history")).toContainText("ESCODE_HISTORICAL_LIVE_OK");
    await page.getByLabel("Message Codex").fill("retained unsent recovery text");
    await page.getByText("Historical boundaries", { exact: true }).click();
    await page.getByRole("button", { name: "Load boundaries", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Before message/ })).toHaveCount(1);
    await page.getByRole("button", { name: /^After turn/ }).click();
    await expect(page.getByRole("region", { name: "Boundary inspection", exact: true })).toBeVisible();
    const chats = await page.evaluate(readChats, root);
    expect(chats).toHaveLength(1);
    const thread = chats[0].threadId;
    await close();
    app = await launchDesktop(user, process.env.ESCODE_TEST_CODEX_DIR, true);
    page = await show();
    await expect(page.getByLabel("Message Codex")).toHaveValue("retained unsent recovery text");
    const state = join(user, "durable-chats-v1.sqlite-state-v1");
    const db = new DatabaseSync(join(state, "state.sqlite"));
    const owner = db.prepare("SELECT hostId,clientId FROM identity").get()!;
    db.close();
    const exe = resolve("release/mac-arm64/escode.app/Contents/MacOS/escode");
    const admin = resolve("release/mac-arm64/escode.app/Contents/Resources/app.asar/dist/host/recovery-admin.cjs");
    const run = (...args: string[]) => JSON.parse(execFileSync(exe, [admin, ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PATH: `${process.env.ESCODE_TEST_CODEX_DIR}:/usr/bin:/bin` }, encoding: "utf8" }));
    expect(run("copy", state, join(dir, "copy"), join(user, "live-spool-v1")).complete).toBe(true);
    await close();
    const destination = join(recovered, "durable-chats-v1.sqlite-state-v1");
    run("recover", join(dir, "copy"), destination, String(owner.hostId), String(owner.clientId));
    expect(run("reconcile", destination, String(owner.hostId), String(owner.clientId)).ready).toBe(true);
    app = await launchDesktop(recovered, process.env.ESCODE_TEST_CODEX_DIR, true);
    page = await app.firstWindow();
    const restored = await page.evaluate(readChats, root);
    expect(restored).toHaveLength(1); expect(restored[0].threadId).toBe(thread);
    expect(restored[0].draft).toBe("retained unsent recovery text");
    page = await show();
    await expect(page.getByLabel("Message Codex")).toHaveValue("retained unsent recovery text");
    await page.getByRole("button", { name: "Retry connection / reload history" }).click();
    await expect(page.getByLabel("Conversation history")).toContainText("ESCODE_HISTORICAL_LIVE_OK", { timeout: 45000 });
    await expect(page.getByLabel("Conversation history").getByRole("heading", { name: "You", exact: true })).toHaveCount(1);
    expect(await readFile(join(root, "saved.txt"), "utf8")).toBe("original");
    console.log("#141 installed provider: UI before/after inspection, restart, consistent copy/recover/provider reconciliation; exact source thread and unsent draft retained");
  } finally {
    await close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
