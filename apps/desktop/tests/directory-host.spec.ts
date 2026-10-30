import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchDesktop } from "./desktop";

test("Files uses authenticated directory contracts with denied paths and no listing IPC", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-directory-host-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "folder"));
  await writeFile(join(root, "folder/a.txt"), "disk");
  await symlink(base, join(root, "outside"));
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    expect(await page.evaluate((root) => window.escode.listDirectory(root, ""), root)).toMatchObject({ kind: "denied" });
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("treeitem", { name: "folder", exact: true })).toBeVisible();
    await page.getByRole("treeitem", { name: "folder", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "a.txt", exact: true })).toBeVisible();
    expect(await page.evaluate((root) => window.escode.listDirectory(root, "folder"), root)).toMatchObject({
      kind: "available", listing: { entries: [{ path: "folder/a.txt", directory: false }], ignored: [] },
    });
    for (const path of ["../", "/tmp", ".git", "folder/../../", "outside"])
      expect((await page.evaluate(({ root, path }) => window.escode.listDirectory(root, path), { root, path })).kind).not.toBe("available");
    const oldRoute = await page.evaluate((root) => (window.escode.project as any)("files-filter", root, "").then(() => "accepted", String), root);
    expect(oldRoute).toContain("Invalid project request");
  } finally { await app.close(); await rm(base, { recursive: true, force: true }); }
});
