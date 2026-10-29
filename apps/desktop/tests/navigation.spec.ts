import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("projects and checkout selections retain buffers, drafts and mode without duplicate tabs", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-navigation-")));
  const a = join(dir, "alpha"),
    b = join(dir, "beta"),
    worktree = join(dir, "worktree");
  for (const root of [a, b]) {
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a.txt"), root);
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "initial",
    ]);
  }
  execFileSync("git", ["-C", a, "worktree", "add", "-b", "other", worktree]);
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    const open = async (root: string) => {
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await expect(page.locator("header")).toContainText(root === worktree ? a : root);
    };
    await open(a);
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("alpha draft");
    await open(b);
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("beta draft");
    await page.keyboard.press("Meta+s");
    await expect.poll(() => readFile(join(b, "a.txt"), "utf8")).toBe("beta draft");
    expect(await readFile(join(a, "a.txt"), "utf8")).toBe(a);
    await open(a);
    await expect(page.locator(".monaco-editor:visible")).toContainText("alpha draft");
    await expect(
      page
        .getByRole("navigation", { name: "Projects" })
        .getByRole("button")
        .filter({ hasNotText: "Agents" }),
    ).toHaveCount(2);
    // A related checkout belongs to the existing repository tab. Seed saved chats without connecting to Codex.
    await open(worktree);
    await expect(
      page
        .getByRole("navigation", { name: "Projects" })
        .getByRole("button")
        .filter({ hasNotText: "Agents" }),
    ).toHaveCount(2);
    const ids = await page.evaluate(
      async ({ a, worktree }) => {
        const first = await window.escode.chat("create", a, a);
        const second = await window.escode.chat("create", a, worktree);
        await window.escode.chat("draft", a, first.id, "original message draft");
        await window.escode.chat("draft", a, second.id, "worktree message draft");
        return [first.id, second.id];
      },
      { a, worktree },
    );
    expect(ids).toHaveLength(2);
    const rejected = await page.evaluate(
      async ({ a, b }) => {
        try {
          await window.escode.chat("create", a, b);
          return false;
        } catch {
          return true;
        }
      },
      { a, b },
    );
    expect(rejected).toBe(true);
    execFileSync("git", ["-C", a, "switch", "-c", "changed-branch"]);
    // Reload only here to load seeded associations; ordinary navigation never reloads.
    await page.reload();
    await open(a);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.getByRole("button", { name: "Chat 2", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Chat 2", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("worktree message draft");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.locator(".view-nav:visible")).toContainText(worktree);
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText(a);
    await expect(page.getByRole("tree", { name: "Files", exact: true })).toHaveAttribute(
      "aria-activedescendant",
      worktree + ":a.txt",
    );
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "Chat 1", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("original message draft");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.getByRole("tree", { name: "Files", exact: true })).toHaveAttribute(
      "aria-activedescendant",
      a + ":a.txt",
    );
    await expect(
      page.getByRole("treeitem", { name: "a.txt, unsaved", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".monaco-editor:visible")).toContainText("alpha draft");
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await open(b);
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: "alpha", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Message Codex")).toHaveValue("original message draft");
    await page.screenshot({ path: "test-results/navigation.png" });
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options?: any) => ({
        response: options.buttons[0] === "Save" ? 1 : 0,
        checkboxChecked: false,
      });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
