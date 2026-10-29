import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

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
  const app = await launchDesktop(join(dir, "user"));
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
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options?: any) => {
        if (options.message === "Remove managed worktree?") {
          if (
            !options.detail.includes("Retained branch:") ||
            !options.detail.includes("Affected chats:")
          )
            throw Error("Missing removal context");
          return { response: 0, checkboxChecked: false };
        }
        return { response: 2, checkboxChecked: false };
      };
    });
    const removal = page
      .getByRole("region", { name: "Managed worktree removal", exact: true })
      .filter({ hasText: path });
    // A durable draft in the target checkout blocks removal even while another checkout is selected.
    const state = await page.evaluate(() => window.escode.lifecycle("load"));
    state.state.drafts.push({
      root: path,
      path: "a.txt",
      text: "recover me",
      disk: { text: "committed", version: "baseline" },
    });
    await page.evaluate((state) => window.escode.lifecycle("persist", state), state.state);
    // Exercise the host boundary directly so renderer persistence does not replace the test draft.
    const blocked = await page.evaluate(
      async ({ root, path }) => {
        try {
          await window.escode.project("worktree-remove", root, path);
          return "unexpected success";
        } catch (error) {
          return String(error);
        }
      },
      { root, path },
    );
    expect(blocked).toContain("recovery drafts");
    state.state.drafts = state.state.drafts.filter((d) => d.root !== path);
    await page.evaluate((state) => window.escode.lifecycle("persist", state), state.state);
    await removal.getByRole("button", { name: "Remove managed worktree…" }).click();
    await page.getByRole("button", { name: "Chat 1", exact: true }).click();
    await expect(
      page.getByText("Checkout removed. History and drafts are retained; this chat cannot run.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Message Codex")).toHaveValue("keep this draft");
    expect(git("worktree", "list", "--porcelain")).not.toContain(path);
    await page.screenshot({ path: "test-results/worktree-removal.png" });
    await page.getByRole("button", { name: "Create worktree and chat", exact: true }).click();
    await expect(page.getByRole("button", { name: "Chat 4", exact: true })).toBeVisible();
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
