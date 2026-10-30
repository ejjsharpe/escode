import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("diff edits share the working buffer, save explicitly and preserve the index", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-editable-diff-")));
  const root = join(dir, "repo");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "original\n");
  await writeFile(join(root, "missing.txt"), "old missing\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial");
  await writeFile(join(root, "a.txt"), "staged\n");
  await writeFile(join(root, "missing.txt"), "staged missing\n");
  git("add", ".");
  await writeFile(join(root, "a.txt"), "working\n");
  await writeFile(join(root, "new.txt"), "untracked text\n");
  await rm(join(root, "missing.txt"));
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…", exact: true }).click();
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.getByRole("heading", { name: "staged", exact: true }).locator("..").getByRole("button", { name: "a.txt", exact: true }).click();
    await page.getByRole("heading", { name: "staged", exact: true }).locator("..").getByRole("button", { name: "missing.txt", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Working file unavailable");
    await expect(page.getByRole("textbox", { name: "staged · missing.txt modified", exact: true })).not.toBeEditable();
    await page.getByRole("heading", { name: "staged", exact: true }).locator("..").getByRole("button", { name: "a.txt", exact: true }).click();
    const modified = page.locator(".monaco-diff-editor .modified .monaco-editor");
    await expect(modified).toContainText("working");
    await expect(page.getByRole("textbox", { name: "staged · a.txt · working copy original", exact: true })).not.toBeEditable();
    await modified.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("edited in diff");
    await expect(page.locator(".toolbar")).toContainText("Unsaved");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("working\n");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.locator(".editor .monaco-editor")).toContainText("edited in diff");
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await expect(modified).toContainText("edited in diff");
    await modified.click();
    await page.keyboard.press("Meta+s");
    await expect.poll(() => readFile(join(root, "a.txt"), "utf8")).toBe("edited in diff");
    expect(git("show", ":a.txt")).toBe("staged\n");
    expect(git("show", "HEAD:a.txt")).toBe("original\n");
    await expect(page.locator(".toolbar")).not.toContainText("Unsaved");
    await modified.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("unsaved diff work");
    await writeFile(join(root, "a.txt"), "external change");
    await page.keyboard.press("Meta+s");
    await expect(page.locator(".conflict")).toBeVisible();
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("external change");
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Disk versus your edits original", exact: true })).not.toBeEditable();
    await expect(modified).toContainText("unsaved diff work");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.locator(".editor .monaco-editor")).toContainText("unsaved diff work");
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.getByRole("heading", { name: "untracked", exact: true }).locator("..").getByRole("button", { name: "new.txt", exact: true }).click();
    await expect(modified).toContainText("untracked text");
    await page.evaluate(() => {
      const groups = [...document.querySelectorAll("h2")];
      const select = (area: string, path: string) => {
        const group = groups.find(h => h.textContent === area)?.parentElement;
        const button = [...(group?.querySelectorAll("button") ?? [])].find(b => b.textContent === path);
        if (!button) throw Error("Missing change " + area + " " + path);
        button.click();
      };
      select("staged", "missing.txt");
      select("unstaged", "a.txt");
    });
    await expect(modified).toContainText("unsaved diff work");
    await page.getByRole("heading", { name: "unstaged", exact: true }).locator("..").getByRole("button", { name: "a.txt", exact: true }).click();
    await expect(modified).toContainText("unsaved diff work");
    await rm(join(root, "new.txt"));
    await rm(join(root, "a.txt"));
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.getByRole("heading", { name: "staged", exact: true }).locator("..").getByRole("button", { name: "a.txt", exact: true }).click();
    await expect(modified).toContainText("unsaved diff work");
    expect(git("show", ":a.txt")).toBe("staged\n");
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
