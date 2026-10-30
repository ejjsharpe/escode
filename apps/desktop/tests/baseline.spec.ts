import { test, expect, _electron } from "@playwright/test";
import electron from "electron";
import { createServer } from "vite-plus";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir, cpus, totalmem } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

// Opt-in diagnostic: two real provider turns, never part of ordinary smoke runs.
for (const mode of ["development", "packaged"] as const) {
  test(`practical baseline: ${mode}`, async ({}, testInfo) => {
    test.skip(process.env.ESCODE_BASELINE !== "1", "Set ESCODE_BASELINE=1 to consume live Codex turns.");
    test.setTimeout(240000);
    const base = await realpath(await mkdtemp(join(tmpdir(), "escode-baseline-")));
    const root = join(base, "repo"), user = join(base, "user");
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    const observations: { step: string; ms: number }[] = [];
    const memory: unknown[] = [];
    const record = (step: string, start: number) => {
      observations.push({ step, ms: performance.now() - start });
      console.log(mode, observations.at(-1));
    };
    const output: Record<string, unknown> = {
      mode, recordedAt: new Date().toISOString(),
      source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      macOS: execFileSync("sw_vers", { encoding: "utf8" }).trim(),
      cpu: cpus()[0].model, logicalCores: cpus().length, ramBytes: totalmem(),
      bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(),
      fixture: "100 tracked UTF-8 files in 10 folders; one commit; one live chat",
      observations, memory,
    };
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    let app: Awaited<ReturnType<typeof launchDesktop>> | undefined;
    try {
      execFileSync("git", ["init", root]);
      for (let i = 0; i < 10; i++) {
        await mkdir(join(root, `folder-${i}`));
        for (let j = 0; j < 10; j++) await writeFile(join(root, `folder-${i}/file-${j}.txt`), "baseline original\n");
      }
      git("add", ".");
      git("-c", "user.name=Baseline", "-c", "user.email=baseline@example.invalid", "commit", "-m", "fixture");
      if (mode === "development") {
        server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: true } });
        await server.listen();
      }
      const launch = () => {
        if (!server) return launchDesktop(user, undefined, true);
        const env: Record<string, string> = { ...process.env, ESCODE_DEV_URL: server.resolvedUrls!.local[0].replace(/\/$/, "") };
        delete env.ELECTRON_RUN_AS_NODE;
        return _electron.launch({ executablePath: electron as unknown as string, args: [".", `--user-data-dir=${user}`], env });
      };
      const started = performance.now();
      app = await launch();
      let page = await app.firstWindow();
      await expect(page.getByRole("button", { name: "Open project…" })).toBeVisible();
      record("fresh launch to Open project visible (server already listening)", started);
      output.runtime = await app.evaluate(() => process.versions);
      output.tools = await page.evaluate(() => window.escode.toolStatus());
      const sample = async (step: string) => memory.push({ step, processes: await app!.evaluate(({ app }) => app.getAppMetrics().map(({ pid, type, memory }) => ({ pid, type, memory }))) });
      await sample("fresh idle");
      await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
      let start = performance.now();
      await page.getByRole("button", { name: "Open project…" }).click();
      await expect(page.getByRole("treeitem", { name: "folder-0", exact: true })).toBeVisible();
      record("open project to root listing visible", start);
      await page.getByRole("treeitem", { name: "folder-0", exact: true }).locator(":scope > .tree-row").click();
      await expect(page.getByRole("treeitem", { name: "file-0.txt", exact: true })).toBeVisible();
      start = performance.now();
      await writeFile(join(root, "folder-0/external.txt"), "external\n");
      await expect(page.getByRole("treeitem", { name: "external.txt", exact: true })).toBeVisible();
      record("external create to loaded directory row visible", start);
      start = performance.now();
      await writeFile(join(root, "folder-0/file-0.txt"), "baseline modified\n");
      await page.getByRole("button", { name: "Source Control", exact: true }).click();
      await expect(page.getByRole("button", { name: "folder-0/file-0.txt", exact: true })).toBeVisible();
      record("external edit and Source Control selection to status visible", start);
      start = performance.now();
      await page.getByRole("button", { name: "folder-0/file-0.txt", exact: true }).click();
      await expect(page.locator(".monaco-diff-editor")).toContainText("baseline modified");
      record("select changed file to diff visible", start);
      start = performance.now();
      await writeFile(join(root, "folder-0/file-0.txt"), "baseline refreshed\n");
      await expect(page.locator(".monaco-diff-editor")).toContainText("baseline refreshed");
      record("external edit to selected diff refreshed", start);
      await sample("files and diff loaded");
      await page.getByRole("button", { name: "Chats", exact: true }).click();
      start = performance.now();
      await page.getByRole("button", { name: "New chat on current checkout" }).click();
      await expect(page.getByRole("status")).toHaveText("Draft");
      record("new chat to Draft visible", start);
      await page.getByLabel("Message Codex").fill("Reply with exactly BASELINE_OK. Do not use tools or change files.");
      start = performance.now();
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      // Match the assistant body, not the echoed user prompt.
      await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Codex", exact: true }) })).toContainText("BASELINE_OK", { timeout: 120000 });
      record("Send to assistant text visible", start);
      await expect(page.getByRole("status")).toHaveText("Ready", { timeout: 120000 });
      record("Send to Ready", start);
      await sample("chat completed");
      start = performance.now();
      await page.getByRole("button", { name: "Retry connection / reload history" }).click();
      await expect(page.getByRole("status")).toHaveText("Ready", { timeout: 45000 });
      await expect(page.getByLabel("Conversation history").getByRole("heading", { name: "You", exact: true })).toHaveCount(1);
      await expect(page.getByLabel("Conversation history").getByRole("heading", { name: "Codex", exact: true })).toHaveCount(1);
      record("Retry to Ready with one conversation turn", start);
      await sample("reconnected");
      await app.close();
      start = performance.now();
      app = await launch();
      page = await app.firstWindow();
      await expect(page.getByLabel("Conversation history")).toContainText("BASELINE_OK", { timeout: 45000 });
      await expect(page.getByRole("status")).toHaveText("Ready", { timeout: 45000 });
      record("restored launch to saved chat Ready", start);
      await sample("restored chat");
      expect(git("diff", "--name-only")).toBe("folder-0/file-0.txt");
      expect(git("ls-files", "--others", "--exclude-standard")).toBe("folder-0/external.txt");
      output.result = "passed";
    } finally {
      await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await server?.close();
      await rm(base, { recursive: true, force: true });
      output.result ??= "incomplete";
      await writeFile(testInfo.outputPath("baseline.json"), JSON.stringify(output, null, 2) + "\n");
    }
  });
}
