import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rename, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { WorkspaceState } from "../host/workspace";
import { launchDesktop } from "./desktop";

test("legacy saved-project migration and interrupted move recovery survive together across restart", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-agents-files-")));
  const root = join(base, "open"),
    closed = join(base, "closed"),
    historical = join(base, "historical"),
    user = join(base, "user");
  for (const repo of [root, closed, historical]) execFileSync("git", ["init", repo]);
  await mkdir(user);
  await mkdir(join(root, "folder"));
  const disk = {
    text: "disk baseline",
    version: createHash("sha256").update("disk baseline").digest("hex"),
  };
  await writeFile(join(root, "folder/a.ts"), disk.text);
  const approved = [
    { project: root, root },
    { project: closed, root: closed },
  ];
  await writeFile(join(user, "approved-projects.json"), JSON.stringify(approved));
  const records = [
    {
      id: "closed-chat",
      project: closed,
      checkout: closed,
      threadId: null,
      draft: "closed legacy text",
    },
    {
      id: "historical-chat",
      project: historical,
      checkout: historical,
      threadId: null,
      draft: "unapproved retained text",
    },
  ];
  await writeFile(join(user, "chats.json"), JSON.stringify(records));
  // Legacy workspace deliberately has no savedProjects registration yet.
  const legacy: WorkspaceState = {
    projects: [approved[0]],
    selected: root,
    views: { [root]: { path: "folder/a.ts", directory: "folder" } },
    drafts: [{ root, path: "folder/a.ts", text: "unsaved recovered text", disk }],
  };
  await writeFile(join(user, "workspace.json"), JSON.stringify(legacy));
  const checkout = await stat(root),
    source = await stat(join(root, "folder"));
  await writeFile(
    join(user, "file-operation.json"),
    JSON.stringify({
      root,
      checkoutIdentity: `${checkout.dev}:${checkout.ino}`,
      kind: "move",
      source: "folder",
      destination: "moved",
      identity: `${source.dev}:${source.ino}`,
    }),
  );
  // Seed the interrupted handoff: disk rename happened, completion/storage did not.
  await rename(join(root, "folder"), join(root, "moved"));
  let app = await launchDesktop(user);
  try {
    const expectedSaved = [...approved, { project: historical, root: historical }];
    for (let restart = 0; restart < 2; restart++) {
      const page = await app.firstWindow();
      await expect(page.locator(".toolbar:visible")).toContainText("moved/a.ts");
      await expect(page.locator(".monaco-editor:visible")).toContainText("unsaved recovered text");
      // Inspect renderer-persisted state before invoking load again can mask a migration loss.
      await expect
        .poll(
          async () =>
            JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).savedProjects,
        )
        .toEqual(expectedSaved);
      const durable: WorkspaceState = JSON.parse(
        await readFile(join(user, "workspace.json"), "utf8"),
      );
      expect(durable.views[root]).toMatchObject({ path: "moved/a.ts", directory: "moved" });
      expect(durable.drafts).toEqual([
        { root, path: "moved/a.ts", text: "unsaved recovered text", disk },
      ]);
      expect(await readFile(join(user, "file-operation.json"), "utf8")).toBe("null");
      await expect(readFile(join(root, "folder/a.ts"))).rejects.toThrow();
      expect(await readFile(join(root, "moved/a.ts"), "utf8")).toBe(disk.text);
      await page.getByRole("button", { name: "Agents", exact: true }).click();
      await expect(page.locator(".agent-row")).toHaveCount(2);
      await expect(page.locator(".agent-row").filter({ hasText: "closed" })).toBeVisible();
      await page.locator(".agent-row").filter({ hasText: "historical" }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "Open this project first" }),
      ).toBeVisible();
      const denial = await page.evaluate(async (root) => {
        try {
          await window.escode.chat("open", root, "historical-chat");
          return "accepted";
        } catch (error) {
          return String(error);
        }
      }, historical);
      expect(denial).toContain("Open this project first");
      expect(JSON.parse(await readFile(join(user, "approved-projects.json"), "utf8"))).toEqual(
        approved,
      );
      expect(
        JSON.parse(await readFile(join(user, "chats.json"), "utf8")).map((c: any) => c.draft),
      ).toEqual(records.map((c) => c.draft));
      await page
        .getByRole("navigation", { name: "Projects" })
        .getByRole("button", { name: "open", exact: true })
        .click();
      if (restart === 0) {
        await expect
          .poll(
            async () => JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).selected,
          )
          .toBe(root);
        const exit = new Promise((resolve) => app.process().once("exit", resolve));
        app.process().kill("SIGKILL");
        await exit;
        app = await launchDesktop(user);
      }
    }
  } finally {
    app.process().kill("SIGKILL");
    await rm(base, { recursive: true, force: true });
  }
});
