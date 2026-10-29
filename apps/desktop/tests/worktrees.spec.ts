import { test, expect, _electron } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import electron from "electron";

test("create from committed state, retain unsaved edits, and explicitly reuse with a shared-files notice", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-worktree-ui-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", "-b", "main", root]);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args])
      .toString()
      .trim();
  await writeFile(join(root, "a.txt"), "committed");
  await writeFile(join(root, ".gitattributes"), "a.txt filter=broken\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial");
  await writeFile(join(root, "a.txt"), "disk edits");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ESCODE_DEV_URL;
  const app = await _electron.launch({
    executablePath: electron as unknown as string,
    args: [".", `--user-data-dir=${join(dir, "user")}`],
    env,
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("unsaved original");
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "Choose worktree…" }).click();
    await expect(page.getByLabel("Local base")).toHaveValue("HEAD");
    git("config", "filter.broken.smudge", "/usr/bin/false");
    git("config", "filter.broken.required", "true");
    await page.getByRole("button", { name: "Create worktree and chat", exact: true }).click();
    await expect(page.getByText("Possible leftovers", { exact: true })).toBeVisible();
    const failedPath = await page.getByLabel("Worktree path", { exact: true }).inputValue();
    await expect(page.getByRole("button", { name: "Chat 1", exact: true })).toHaveCount(0);
    git("config", "--unset", "filter.broken.smudge");
    git("config", "--unset", "filter.broken.required");
    await page.getByRole("button", { name: "Refresh bases and worktrees" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Creation failed. No chat started." }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Create worktree and chat", exact: true }).click();
    await expect(page.getByLabel("Worktree path", { exact: true })).toHaveCount(2);
    const path = await page.getByLabel("Worktree path", { exact: true }).last().inputValue();
    expect(path).not.toBe(failedPath);
    await expect(page.getByLabel("Worktree path", { exact: true }).first()).toHaveValue(failedPath);
    await expect(
      page.getByRole("alert").filter({ hasText: "Creation failed. No chat started." }),
    ).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Chat 1", exact: true })).toBeVisible();
    expect(await readFile(join(path, "a.txt"), "utf8")).toBe("committed");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("disk edits");
    await expect(page.getByLabel("Message Codex")).toBeVisible();
    await page.getByLabel("Message Codex").fill("keep this draft");
    await page.getByRole("button", { name: "Refresh bases and worktrees" }).click();
    await page.getByLabel("Existing project worktree").selectOption(path);
    await page.getByRole("button", { name: "Reuse worktree for chat", exact: true }).click();
    await expect(page.getByRole("button", { name: "Chat 2", exact: true })).toBeVisible();
    await expect(
      page.getByText("These chats share files in this checkout. Their edits can interact."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Chat 1", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("keep this draft");
    await page.getByLabel("Existing project worktree").selectOption(root);
    await page.getByRole("button", { name: "Reuse worktree for chat", exact: true }).click();
    await expect(page.getByRole("button", { name: "Chat 3", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("unsaved original");
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.screenshot({ path: "test-results/worktree-choices.png" });
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options: any) => ({
        response: options.buttons[0] === "Save" ? 1 : 0,
        checkboxChecked: false,
      });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
