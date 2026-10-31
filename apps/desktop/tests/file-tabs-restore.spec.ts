import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("missing restored files retain selection and retry current disk without replacing other tabs", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-tabs-restore-")));
  const root = join(dir, "repo"), user = join(dir, "user");
  execFileSync("git", ["init", root]);
  for (const name of ["a.txt", "b.txt"]) await writeFile(join(root, name), name);
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).dblclick();
    await page.getByRole("treeitem", { name: "b.txt", exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).views[root]?.path).toBe("b.txt");
    await page.getByRole("button", { name: "Close repo project", exact: true }).click();
    await expect(page.getByRole("tablist", { name: "Open files" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveText(["a.txt", "b.txt"]);
    await expect.poll(async () => JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).projects).toContainEqual({ project: root, root });
    await expect.poll(async () => JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).selected).toBe(root);
    await rm(join(root, "b.txt"));
    await page.reload();
    const tabs = page.getByRole("tablist", { name: "Open files" });
    await expect(tabs.getByRole("tab")).toHaveText(["a.txt", "b.txt"]);
    await expect(tabs.getByRole("tab", { name: "b.txt", exact: true })).toHaveAccessibleDescription("Preview");
    await expect(page.getByRole("button", { name: "Retry file", exact: true })).toBeVisible();
    await tabs.getByRole("tab", { name: "a.txt", exact: true }).click();
    await tabs.getByRole("tab", { name: "b.txt", exact: true }).click();
    await expect(tabs.getByRole("tab", { name: "b.txt", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".monaco-editor:visible")).toHaveCount(0);
    await writeFile(join(root, "b.txt"), "current replacement bytes");
    await page.getByRole("button", { name: "Retry file", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("current replacement bytes");
    await expect(tabs.getByRole("tab")).toHaveText(["a.txt", "b.txt"]);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});


test("restart and Retry reject a replacement checkout while retaining exact tabs and drafts", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-tabs-identity-")));
  const root = join(dir, "repo"), original = join(dir, "original"), user = join(dir, "user");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "loaded baseline");
  await writeFile(join(root, "b.txt"), "clean original");
  let app = await launchDesktop(user);
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).dblclick();
    await page.getByRole("textbox", { name: "a.txt editor", exact: true }).focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("retained recovery text");
    await page.getByRole("treeitem", { name: "b.txt", exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts[0]?.text).toBe("retained recovery text");
    await expect.poll(async () => JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).views[root]?.path).toBe("b.txt");
    const exited = new Promise(resolve => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exited;
    await rm(join(user, "foundation", "owner.lock"));
    await rename(root, original);
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a.txt"), "replacement a");
    await writeFile(join(root, "b.txt"), "replacement b");
    app = await launchDesktop(user);
    page = await app.firstWindow();
    const tabs = page.getByRole("tablist", { name: "Open files" });
    await expect(tabs.getByRole("tab")).toHaveText(["a.txt", "b.txt"]);
    await expect(page.getByRole("button", { name: "Retry checkout", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Retry checkout", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toHaveCount(0);
    await tabs.getByRole("tab", { name: "a.txt", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("retained recovery text");
    await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("replacement a");
    await rename(root, join(dir, "replacement"));
    await rename(original, root);
    await page.getByRole("button", { name: "Retry checkout", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry file", exact: true })).toHaveCount(0);
    await tabs.getByRole("tab", { name: "b.txt", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("clean original");
    await tabs.getByRole("tab", { name: "a.txt", exact: true }).click();
    await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
    await expect.poll(() => readFile(join(root, "a.txt"), "utf8")).toBe("retained recovery text");
    await expect(page.getByRole("button", { name: "Save ⌘S", exact: true })).toBeEnabled();
    await expect(page.locator(".content:visible > p[role=status]")).toHaveText("Saved a.txt");
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.close(); await rm(dir, { recursive: true, force: true });
  }
});

test("restored conflict comparisons read current disk and retain the loaded recovery baseline", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-tabs-conflict-")));
  const root = join(dir, "repo"), user = join(dir, "user");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "loaded original");
  const app = await launchDesktop(user);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.getByRole("textbox", { name: "a.txt editor", exact: true }).focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("my recovered draft");
    await writeFile(join(root, "a.txt"), "first external");
    await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).views[root]?.fileViews?.["a.txt"]).toBe("conflict");
    await expect.poll(async () => JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts[0]?.text).toBe("my recovered draft");
    await writeFile(join(root, "a.txt"), "latest external");
    await page.reload();
    await expect(page.getByRole("combobox", { name: "File view", exact: true })).toHaveValue("conflict");
    await expect(page.locator(".monaco-diff-editor:visible")).toContainText("latest external");
    await expect(page.locator(".modified-in-monaco-diff-editor:visible")).toContainText("my recovered draft");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
    await expect(page.locator(".conflict")).toBeVisible();
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("latest external");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.close(); await rm(dir, { recursive: true, force: true });
  }
});
