import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-trash-handoff-")));
  const root = join(base, "repo"),
    user = join(base, "user");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "folder"));
  for (const file of ["a.txt", "folder/one.txt", "folder/two.txt"])
    await writeFile(join(root, file), "disk " + file);
  const app = await launchDesktop(user);
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    const cp = process.getBuiltinModule("child_process") as any,
      execute = cp.execFileSync;
    (globalThis as any).trashFixtures = [];
    cp.execFileSync = (...args: any[]) => {
      const value = execute(...args);
      if (args[1]?.[0] === "trash") (globalThis as any).trashFixtures.push(value.toString());
      return value;
    };
  }, root);
  await page.getByRole("button", { name: "Open project…" }).click();
  return { base, root, user, app, page };
}
async function edit(page: Page, name: string, text: string) {
  await page.getByRole("treeitem", { name: new RegExp("^" + name) }).click();
  await page.locator(".monaco-editor:visible").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type(text);
}
async function kill(app: ElectronApplication) {
  const exited = new Promise<void>((resolve) => app.process().once("exit", () => resolve()));
  app.process().kill("SIGKILL");
  await exited;
}
async function cleanup(app: ElectronApplication, base: string, trash: string[] = []) {
  const fixtures = await app
    .evaluate(() => (globalThis as any).trashFixtures ?? [])
    .catch(() => []);
  await kill(app);
  for (const path of new Set([...trash, ...fixtures]))
    await rm(path, { recursive: true, force: true });
  await rm(base, { recursive: true, force: true, maxRetries: 3 });
}

for (const failure of ["workspace", "renderer workspace", "acknowledgement"] as const) {
  test(`native Trash success remains visible through ${failure} failure and fresh-process recovery`, async () => {
    const f = await fixture();
    let app = f.app;
    let trash: string[] = [];
    try {
      await edit(f.page, "a.txt", "saved and trashed");
      await app.evaluate((_, failure) => {
        const fs = process.getBuiltinModule("fs/promises") as any,
          rename = fs.rename;
        let workspaceWrites = 0;
        fs.rename = async (...args: any[]) => {
          const destination = String(args[1]);
          const trashed = (globalThis as any).trashFixtures.length > 0;
          if (trashed && destination.endsWith("/workspace.json")) {
            workspaceWrites++;
            if (
              failure === "workspace" ||
              (failure === "renderer workspace" && workspaceWrites > 1)
            )
              throw Error("probe persistence denied");
          }
          if (
            trashed &&
            destination.endsWith("/file-operation.json") &&
            failure === "acknowledgement" &&
            (await fs.readFile(args[0], "utf8")) === "null"
          )
            throw Error("probe acknowledgement denied");
          return rename(...args);
        };
      }, failure);
      await f.page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
      await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
        "a.txt: Moved to macOS Trash",
      );
      await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
        failure !== "acknowledgement" ? "probe persistence denied" : "probe acknowledgement denied",
      );
      await expect(f.page.getByRole("treeitem", { name: /^a.txt/ })).toHaveCount(0);
      await expect(readFile(join(f.root, "a.txt"))).rejects.toThrow();
      const intent = JSON.parse(await readFile(join(f.user, "file-operation.json"), "utf8"));
      if (failure === "renderer workspace") expect(intent).toBe(null);
      else expect(intent).toMatchObject({ kind: "trash", source: "a.txt", completed: true });
      trash = await app.evaluate(() => (globalThis as any).trashFixtures);
      expect(await readFile(trash[0], "utf8")).toBe("saved and trashed");
      // Pending intent continues to block another mutation until a durable handoff/restart.
      if (failure !== "renderer workspace")
        expect(
          await f.page.evaluate(async (root) => {
            try {
              await window.escode.project("create-entry", root, "", "blocked.txt", "file");
              return "accepted";
            } catch (error) {
              return String(error);
            }
          }, f.root),
        ).toContain("pending reconciliation");
      await kill(app);
      app = await launchDesktop(f.user);
      const page = await app.firstWindow();
      await expect(page.getByRole("treeitem", { name: /^folder/ })).toBeVisible();
      await expect(page.getByRole("treeitem", { name: /^a.txt/ })).toHaveCount(0);
      await expect
        .poll(async () => JSON.parse(await readFile(join(f.user, "file-operation.json"), "utf8")))
        .toBe(null);
      expect(JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8")).drafts).toEqual([]);
      expect(await readFile(trash[0], "utf8")).toBe("saved and trashed");
    } finally {
      await cleanup(app, f.base, trash);
    }
  });
}

for (const next of ["retry Trash", "ordinary Save", "external change"] as const) {
  test(`completed save survives native Trash failure: ${next}`, async () => {
    const f = await fixture();
    try {
      await edit(f.page, "a.txt", "first save");
      await f.app.evaluate(() => {
        const cp = process.getBuiltinModule("child_process") as any,
          execute = cp.execFileSync;
        cp.execFileSync = (...args: any[]) => {
          if (args[1]?.[0] === "trash") {
            cp.execFileSync = execute;
            throw Error("probe native Trash failed");
          }
          return execute(...args);
        };
      });
      await f.page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
      await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
        "probe native Trash failed",
      );
      expect(await readFile(join(f.root, "a.txt"), "utf8")).toBe("first save");
      const draft = JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8")).drafts[0];
      expect(draft.text).toBe("first save");
      expect(draft.disk.text).toBe("first save");
      await edit(f.page, "a.txt", "second save");
      if (next === "external change")
        await writeFile(join(f.root, "a.txt"), "real external writer");
      if (next === "ordinary Save") {
        await f.page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
        await expect.poll(() => readFile(join(f.root, "a.txt"), "utf8")).toBe("second save");
        await expect(f.page.locator(".conflict")).toHaveCount(0);
      } else {
        await f.page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
        if (next === "external change") {
          await expect(f.page.locator(".conflict")).toContainText("a.txt changed on disk");
          expect(await readFile(join(f.root, "a.txt"), "utf8")).toBe("real external writer");
          expect(
            JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8")).drafts[0].text,
          ).toBe("second save");
        } else {
          await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
            "a.txt: Moved to macOS Trash",
          );
          await expect(f.page.locator(".conflict")).toHaveCount(0);
          const paths = await f.app.evaluate(() => (globalThis as any).trashFixtures);
          expect(await readFile(paths[0], "utf8")).toBe("second save");
        }
      }
    } finally {
      await cleanup(f.app, f.base);
    }
  });
}

test("partial descendant save carries its new baseline through later conflict and fresh process", async () => {
  const f = await fixture();
  let app = f.app;
  try {
    await f.page.getByRole("treeitem", { name: "folder", exact: true }).click();
    await edit(f.page, "one.txt", "saved descendant");
    await edit(f.page, "two.txt", "conflicted descendant");
    await writeFile(join(f.root, "folder/two.txt"), "external two");
    await f.page
      .getByRole("treeitem", { name: "folder", exact: true })
      .locator(":scope > .tree-row")
      .click({ button: "right" });
    await f.page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
    await expect(f.page.locator(".conflict")).toContainText("folder/two.txt changed on disk");
    expect(await readFile(join(f.root, "folder/one.txt"), "utf8")).toBe("saved descendant");
    const drafts = JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8")).drafts;
    expect(drafts.find((d: any) => d.path === "folder/one.txt").disk.text).toBe("saved descendant");
    expect(drafts.find((d: any) => d.path === "folder/two.txt").disk.text).toBe(
      "disk folder/two.txt",
    );
    await kill(app);
    app = await launchDesktop(f.user);
    const page = await app.firstWindow();
    await expect(page.getByRole("treeitem", { name: /^one.txt/ })).toBeVisible();
    await edit(page, "one.txt", "after restart");
    await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
    await expect.poll(() => readFile(join(f.root, "folder/one.txt"), "utf8")).toBe("after restart");
    await expect(page.locator(".conflict")).toHaveCount(0);
    await edit(page, "two.txt", "still retained two");
    await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
    await expect(page.locator(".conflict")).toContainText("folder/two.txt changed on disk");
    expect(await readFile(join(f.root, "folder/two.txt"), "utf8")).toBe("external two");
  } finally {
    await cleanup(app, f.base);
  }
});

test("completed save with failed baseline persistence blocks Trash and recovers its baseline on restart", async () => {
  const f = await fixture();
  let app = f.app;
  try {
    await edit(f.page, "a.txt", "completed but not handed off");
    await app.evaluate(() => {
      const cp = process.getBuiltinModule("child_process") as any,
        execute = cp.execFileSync;
      const fs = process.getBuiltinModule("fs/promises") as any,
        rename = fs.rename;
      let saved = false;
      cp.execFileSync = (...args: any[]) => {
        const value = execute(...args);
        if (args[1]?.[0] === "replace") saved = true;
        return value;
      };
      fs.rename = async (...args: any[]) => {
        if (saved && String(args[1]).endsWith("/workspace.json"))
          throw Error("probe baseline handoff denied");
        return rename(...args);
      };
    });
    await f.page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText("Saved a.txt");
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
      "probe baseline handoff denied",
    );
    await expect(f.page.locator(".monaco-editor:visible")).toContainText(
      "completed but not handed off",
    );
    expect(await readFile(join(f.root, "a.txt"), "utf8")).toBe("completed but not handed off");
    expect(await app.evaluate(() => (globalThis as any).trashFixtures)).toEqual([]);
    expect(JSON.parse(await readFile(join(f.user, "file-operation.json"), "utf8"))).toMatchObject({
      kind: "save",
      completed: true,
      savedDisk: { text: "completed but not handed off" },
    });
    await kill(app);
    app = await launchDesktop(f.user);
    const page = await app.firstWindow();
    await expect(page.locator(".monaco-editor:visible")).toContainText(
      "completed but not handed off",
    );
    await expect
      .poll(async () => JSON.parse(await readFile(join(f.user, "file-operation.json"), "utf8")))
      .toBe(null);
    expect(
      JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8")).drafts[0].disk.text,
    ).toBe("completed but not handed off");
    await edit(page, "a.txt", "new edit after recovery");
    await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
    await expect
      .poll(() => readFile(join(f.root, "a.txt"), "utf8"))
      .toBe("new edit after recovery");
    await expect(page.locator(".conflict")).toHaveCount(0);
  } finally {
    await cleanup(app, f.base);
  }
});

for (const completion of ["crash", "continue"] as const) {
  test(`Agents navigation cannot regress completed batch facts before delivery: ${completion}`, async () => {
    const f = await fixture();
    let app = f.app;
    let trash: string[] = [];
    try {
      await writeFile(join(f.root, "b.txt"), "clean b");
      await f.page.getByRole("button", { name: "Refresh", exact: true }).click();
      await f.page.getByRole("treeitem", { name: "folder", exact: true }).click();
      await edit(f.page, "one.txt", "retained unrelated edits");
      await edit(f.page, "a.txt", "saved a");
      await f.page
        .getByRole("treeitem", { name: "b.txt", exact: true })
        .click({ modifiers: ["Meta"] });
      await app.evaluate(() => {
        const cp = process.getBuiltinModule("child_process") as any,
          execute = cp.execFileSync;
        let failed = false;
        cp.execFileSync = (...args: any[]) => {
          if (!failed && args[1]?.[0] === "trash" && args[1].includes("a.txt")) {
            failed = true;
            throw Error("probe a Trash failed");
          }
          return execute(...args);
        };
        const fs = process.getBuiltinModule("fs/promises") as any,
          rename = fs.rename;
        let paused = false;
        fs.rename = async (...args: any[]) => {
          const clearing =
            String(args[1]).endsWith("/file-operation.json") &&
            (await fs.readFile(args[0], "utf8")) === "null";
          const value = await rename(...args);
          if (!paused && clearing && (globalThis as any).trashFixtures.length > 0) {
            paused = true;
            await new Promise<void>((resolve) => {
              (globalThis as any).resumeBatch = resolve;
            });
          }
          return value;
        };
      });
      await f.page
        .getByRole("button", { name: "Move to Trash 2 selected items", exact: true })
        .click();
      await expect.poll(() => app.evaluate(() => !!(globalThis as any).resumeBatch)).toBe(true);
      expect(JSON.parse(await readFile(join(f.user, "file-operation.json"), "utf8"))).toBe(null);
      expect(await readFile(join(f.root, "a.txt"), "utf8")).toBe("saved a");
      await expect(readFile(join(f.root, "b.txt"))).rejects.toThrow();
      await f.page.getByRole("button", { name: "Agents", exact: true }).click();
      await expect
        .poll(
          async () => JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8")).selected,
        )
        .toBe("agents");
      const state = JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8"));
      expect(state.drafts.find((d: any) => d.path === "a.txt")).toMatchObject({
        text: "saved a",
        disk: { text: "saved a" },
      });
      expect(state.drafts.find((d: any) => d.path === "folder/one.txt").text).toBe(
        "retained unrelated edits",
      );
      expect(state.views[f.root].files.selected).not.toContain("b.txt");
      trash = await app.evaluate(() => (globalThis as any).trashFixtures);
      expect(await readFile(trash[0], "utf8")).toBe("clean b");
      // Files/saves remain blocked while the old renderer has not consumed its batch results.
      expect(
        await f.page.evaluate(async (root) => {
          try {
            await window.escode.project("save", root, "a.txt", "stale save", "unused");
            return "accepted";
          } catch (error) {
            return String(error);
          }
        }, f.root),
      ).toContain("File operation");
      if (completion === "crash") {
        await kill(app);
        app = await launchDesktop(f.user);
        const page = await app.firstWindow();
        await page.getByRole("button", { name: "repo", exact: true }).click();
        await edit(page, "a.txt", "saved after restart");
        await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
        await expect
          .poll(() => readFile(join(f.root, "a.txt"), "utf8"))
          .toBe("saved after restart");
        await expect(page.locator(".conflict")).toHaveCount(0);
        await writeFile(join(f.root, "a.txt"), "real external change");
        await edit(page, "a.txt", "retained after external change");
        await page.getByRole("button", { name: "Save ⌘S", exact: true }).click();
        await expect(page.locator(".conflict")).toContainText("a.txt changed on disk");
        expect(await readFile(join(f.root, "a.txt"), "utf8")).toBe("real external change");
        expect(
          JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8")).drafts.find(
            (d: any) => d.path === "folder/one.txt",
          ).text,
        ).toBe("retained unrelated edits");
      } else {
        await app.evaluate(() => (globalThis as any).resumeBatch());
        await f.page.getByRole("button", { name: "repo", exact: true }).click();
        await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
          "b.txt: Moved to macOS Trash",
        );
        await edit(f.page, "a.txt", "second batch saved a");
        await f.page.getByRole("button", { name: "Move to Trash a.txt", exact: true }).click();
        await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
          "a.txt: Moved to macOS Trash",
        );
        await expect(f.page.getByRole("treeitem", { name: /^a.txt/ })).toHaveCount(0);
        // Released facts must not delete future drafts at a legitimately recreated path.
        await f.page.evaluate(
          (root) => window.escode.project("create-entry", root, "", "a.txt", "file"),
          f.root,
        );
        await f.page.getByRole("button", { name: "Refresh", exact: true }).click();
        await edit(f.page, "a.txt", "new incarnation");
        await f.page.getByRole("button", { name: "Agents", exact: true }).click();
        await expect
          .poll(
            async () =>
              JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8")).drafts.find(
                (d: any) => d.path === "a.txt",
              )?.text,
          )
          .toBe("new incarnation");
      }
    } finally {
      await cleanup(app, f.base, trash);
    }
  });
}

for (const change of [
  "editor close",
  "retained dirty editor",
  "checkout replaced",
  "quit",
] as const) {
  test(`pending batch retains its authority only while valid: ${change}`, async () => {
    const f = await fixture();
    try {
      await expect(f.page.getByRole("treeitem", { name: "a.txt", exact: true })).toBeVisible();
      const other = join(f.base, "other");
      execFileSync("git", ["init", other]);
      await writeFile(join(other, "a.txt"), "other checkout");
      await writeFile(join(f.root, "b.txt"), "origin sibling");
      if (change !== "editor close") {
        await edit(f.page, "a.txt", "saved origin edits");
        await f.page.getByRole("treeitem", { name: "folder", exact: true }).click();
        await edit(f.page, "one.txt", "unrelated retained edits");
        await expect
          .poll(async () => {
            const state = JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8"));
            return state.drafts.find((d: any) => d.path === "folder/one.txt")?.text;
          })
          .toBe("unrelated retained edits");
      }
      await f.app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () =>
          new Promise<any>((resolve) => {
            (globalThis as any).confirmBatch = () =>
              resolve({ response: 0, checkboxChecked: false });
          });
      });
      // Start through the real IPC boundary; keep delivery pending independently of view lifetime.
      await f.page.evaluate((root) => {
        (window as any).pendingBatch = window.escode.project("trash-selection", root, [
          "a.txt",
          "b.txt",
        ]);
      }, f.root);
      await expect.poll(() => f.app.evaluate(() => !!(globalThis as any).confirmBatch)).toBe(true);
      if (change === "editor close") {
        await f.page.locator('.project-tab[data-active="true"] .project-tab-close').click();
        await expect(f.page.getByRole("button", { name: "repo", exact: true })).toHaveCount(0);
      } else {
        // Host editor finish retains the session even with recovery work still in memory.
        await f.page.evaluate((root) => window.escode.lifecycle("finish", root), f.root);
        await f.page.getByRole("button", { name: "Agents", exact: true }).click();
      }
      await f.app.evaluate(({ dialog }, other) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [other] });
      }, other);
      await f.page.getByRole("button", { name: "Open project…" }).click();
      await expect(f.page.getByRole("button", { name: "other", exact: true })).toBeVisible();
      if (change === "checkout replaced") {
        await f.app.evaluate((_, root) => {
          const fs = process.getBuiltinModule("fs") as any;
          fs.renameSync(root, root + "-original");
          fs.mkdirSync(root);
          fs.writeFileSync(root + "/a.txt", "replacement contents");
        }, f.root);
      }
      if (change === "quit") {
        // Hold the process open after real quit authorization to observe the pending IPC denial.
        await f.app.evaluate(({ app }) => {
          app.quit = () => {};
        });
        await f.page.evaluate(() => window.escode.lifecycle("finish"));
      }
      await f.app.evaluate(() => (globalThis as any).confirmBatch());
      const result = await f.page.evaluate(() => (window as any).pendingBatch);
      expect(result.results).toHaveLength(2);
      expect(await readFile(join(other, "a.txt"), "utf8")).toBe("other checkout");
      if (change === "checkout replaced" || change === "quit") {
        expect(result.results.every((r: any) => !r.applied)).toBe(true);
        expect(result.results[0].message).toContain(change === "quit" ? "quitting" : "replaced");
        expect(await f.app.evaluate(() => (globalThis as any).trashFixtures)).toEqual([]);
        expect(await readFile(join(f.root, "a.txt"), "utf8")).toBe(
          change === "quit" ? "disk a.txt" : "replacement contents",
        );
        if (change === "checkout replaced")
          expect(await readFile(join(f.root + "-original", "a.txt"), "utf8")).toBe("disk a.txt");
      } else {
        expect(result.results.every((r: any) => r.applied)).toBe(true);
        expect(result.results[0].intent.root).toBe(f.root);
        const paths = await f.app.evaluate(() => (globalThis as any).trashFixtures);
        expect(await readFile(paths[1], "utf8")).toBe("origin sibling");
        expect(await readFile(paths[0], "utf8")).toBe(
          change === "editor close" ? "disk a.txt" : "saved origin edits",
        );
        await expect(readFile(join(f.root, "a.txt"))).rejects.toThrow();
      }
      const state = JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8"));
      if (change !== "editor close") {
        expect(state.drafts.find((d: any) => d.path === "folder/one.txt")).toMatchObject({
          root: f.root,
          text: "unrelated retained edits",
          disk: { text: "disk folder/one.txt" },
        });
        if (change === "retained dirty editor") {
          expect(result.saves[0]).toMatchObject({
            path: "a.txt",
            disk: { text: "saved origin edits" },
          });
          expect(state.drafts.some((d: any) => d.path === "a.txt")).toBe(false);
        } else {
          expect(state.drafts.find((d: any) => d.path === "a.txt")).toMatchObject({
            root: f.root,
            text: "saved origin edits",
            disk: { text: "disk a.txt" },
          });
        }
      }
    } finally {
      await cleanup(f.app, f.base);
    }
  });
}
