import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("file tabs reuse dirty buffers and insert to the right without reordering existing files", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-file-tabs-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  for (const name of ["a.txt", "b.txt", "c.txt"]) await writeFile(join(root, name), name);
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    const treeFile = (name: string) => page.getByRole("treeitem", { name, exact: true });
    const tabs = page.getByRole("tablist", { name: "Open files" });
    await treeFile("a.txt").click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("retained draft");
    await treeFile("b.txt").click();
    await tabs.getByRole("tab", { name: "a.txt", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("retained draft");
    await treeFile("c.txt").click();
    await expect(tabs.getByRole("tab")).toHaveText(["a.txt", "c.txt", "b.txt"]);
    await treeFile("b.txt").click();
    await expect(tabs.getByRole("tab")).toHaveText(["a.txt", "c.txt", "b.txt"]);
    await expect(tabs.getByRole("tab", { name: "b.txt", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect.poll(async () => JSON.parse(await readFile(join(dir, "user/client-workspace-v1.json"), "utf8")).views[root]?.openFiles).toEqual(["a.txt", "c.txt", "b.txt"]);
    await page.reload();
    await expect(tabs.getByRole("tab")).toHaveText(["a.txt", "c.txt", "b.txt"]);
    await expect(tabs.getByRole("tab", { name: "b.txt", exact: true })).toHaveAttribute("aria-selected", "true");
    await tabs.getByRole("tab", { name: "a.txt", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("retained draft");
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed and delayed opens retain the newer file and its edits", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-file-races-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "a baseline");
  await writeFile(join(root, "slow.txt"), "delayed document");
  await writeFile(join(root, "binary.txt"), Buffer.from([0, 1, 2]));
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(() => {
      const events = process.getBuiltinModule("events");
      const emit = events.EventEmitter.prototype.emit;
      events.EventEmitter.prototype.emit = function(event: string, ...args: any[]) {
        if (event === "message" && typeof (this as any).send === "function" && !(this as any).heldFileResponse) {
          const socket = this as any, send = socket.send;
          socket.heldFileResponse = true;
          socket.send = function(...values: any[]) {
            if (Buffer.from(values[0]).toString().includes("delayed document")) {
              (globalThis as any).releaseFile = () => send.apply(socket, values);
            } else return send.apply(socket, values);
          };
        }
        return emit.call(this, event, ...args);
      };
    });
    await page.reload();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("my edits");
    await page.getByRole("treeitem", { name: "slow.txt", exact: true }).click();
    await expect.poll(() => app.evaluate(() => typeof (globalThis as any).releaseFile)).toBe("function");
    await page.getByRole("tab", { name: "a.txt", exact: true }).click();
    await app.evaluate(() => (globalThis as any).releaseFile());
    // The next host read finishes after the delayed read, so its error is also a response barrier.
    await page.getByRole("treeitem", { name: "binary.txt", exact: true }).click();
    await expect(page.locator(".content:visible > p[role=status]")).toContainText("binary");
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveText(["a.txt"]);
    await expect(page.getByRole("tab", { name: "a.txt", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".monaco-editor:visible")).toContainText("my edits");
    // A failed comparison must preserve the current editor as well.
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.getByRole("button", { name: "a.txt", exact: true }).click();
    await expect(page.locator(".toolbar:visible")).toContainText("untracked · a.txt");
    await page.getByRole("button", { name: "binary.txt", exact: true }).click();
    await expect(page.locator(".content:visible > p[role=status]")).toContainText("binary");
    expect(await page.locator(".toolbar:visible").innerText()).toContain("untracked · a.txt");
    expect(await page.locator(".modified-in-monaco-diff-editor:visible").count()).toBe(1);
    await expect(page.locator(".modified-in-monaco-diff-editor:visible")).toContainText("my edits");
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
