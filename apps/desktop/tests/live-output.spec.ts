import { test, expect } from "@playwright/test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchDesktop } from "./desktop";

test("installed provider streams a setup-created new-format saved association", async () => {
  test.skip(process.env.ESCODE_LIVE_CHAT !== "1", "Consumes one installed Codex turn");
  test.setTimeout(180000);
  const user = await mkdtemp(join(tmpdir(), "escode-live-output-"));
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    console.log("Packaged runtime", await app.evaluate(() => process.versions));
    console.log("Installed provider", await page.evaluate(() => window.escode.toolStatus()));
    const id = await page.evaluate(async () => {
      const chat = await window.escode.chat("createDraft", null);
      await window.escode.chat("send", null, chat.id,
        "Print twenty numbered lines, each containing ESCODE_STREAM_OK. Do not use tools or change files.");
      return chat.id;
    });
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.locator(".agent-row").click();
    const observed = await page.evaluate(id => new Promise<{ batches: number; maximumBytes: number; threadId: string | null }>((resolve, reject) => {
      let batches = 0, maximumBytes = 0;
      const timer = setTimeout(() => { off(); reject(Error("Streaming timed out")); }, 120000);
      const off = window.escode.chatLive(null, id, snapshot => {
        batches++;
        maximumBytes = Math.max(maximumBytes, new TextEncoder().encode(JSON.stringify(snapshot)).length);
        if (!snapshot.busy && snapshot.items.some(item => item.type === "agentMessage" && item.text.includes("ESCODE_STREAM_OK"))) {
          clearTimeout(timer); off(); resolve({ batches, maximumBytes, threadId: snapshot.threadId });
        }
      }, error => { clearTimeout(timer); off(); reject(Error(error)); });
    }), id);
    expect(observed.threadId).toBeTruthy();
    expect(observed.maximumBytes).toBeLessThan(160 * 1024);
    await expect(page.getByLabel("Conversation history")).toContainText("ESCODE_STREAM_OK");
    await expect(page.getByRole("status")).toHaveText("Ready");
    // Locate the new-format spool without assuming the foundation generation's directory name.
    const findSpool = async (dir: string): Promise<string | undefined> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const path = join(dir, entry.name);
        if (entry.name === "live-spool-v1") return path;
        if (entry.name.startsWith("foundation")) { const found = await findSpool(path); if (found) return found; }
      }
      return undefined;
    };
    const spool = await findSpool(user);
    expect(spool).toBeTruthy();
    const sizes = await Promise.all((await readdir(spool!)).map(async name => (await stat(join(spool!, name))).size));
    console.log("Live output observed bounds", { ...observed, spoolFiles: sizes.length, spoolBytes: sizes.reduce((a, b) => a + b, 0) });
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(64 * 1024 * 1024);
  } finally { await app.close(); await rm(user, { recursive: true, force: true }); }
});
