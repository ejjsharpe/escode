import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("reveal, collapse, ignored dirty file, failure recovery, context paths and restart", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-46-ui-")));
  const root = join(base, "repo"),
    other = join(base, "other"),
    user = join(base, "user");
  for (const path of [root, other]) execFileSync("git", ["init", path]);
  await mkdir(join(root, "folder/deep"), { recursive: true });
  await writeFile(join(root, "folder/deep/ignored.log"), "ignored disk");
  await writeFile(join(root, "folder/deep/normal.txt"), "normal disk");
  await writeFile(join(root, ".gitignore"), "*.log\n");
  await Promise.all(
    Array.from({ length: 80 }, (_, i) => writeFile(join(root, `z-${i}.txt`), "disk")),
  );
  let app = await launchDesktop(user);
  try {
    let page = await app.firstWindow();
    const open = async (path: string) => {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      }, path);
      await page.getByRole("button", { name: "Open project…" }).click();
    };
    await open(root);
    const row = (name: string) =>
      page.getByRole("treeitem", { name, exact: true }).locator(":scope > .tree-row");
    await row("folder").click();
    await row("deep").click();
    await row("ignored.log").click();
    const editor = () => page.locator(".monaco-editor textarea");
    await editor().focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("ignored unsaved");
    await row("folder").click();
    await expect(page.getByRole("treeitem", { name: "deep", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "deep", exact: true })).toHaveCount(0);
    const tree = page.getByRole("tree", { name: "Files", exact: true });
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => tree.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await page.getByRole("button", { name: "Reveal Active File", exact: true }).click();
    await expect(
      page.getByRole("treeitem", { name: "ignored.log, unsaved", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: "ignored.log, unsaved", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Reveal Active File", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Hide Git-ignored files", exact: true }).click();
    await expect(
      page.getByRole("treeitem", { name: "ignored.log, unsaved", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".monaco-editor")).toContainText("ignored unsaved");
    await page.getByRole("button", { name: "Reveal Active File", exact: true }).click();
    await page.getByRole("button", { name: "Show ignored files", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Reveal Active File", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("treeitem", { name: "ignored.log, unsaved", exact: true }),
    ).toBeVisible();
    // Selecting another editor file reveals it without taking focus from Monaco.
    await row("normal.txt").click();
    await editor().focus();
    await expect(editor()).toBeFocused();
    await expect(page.getByRole("treeitem", { name: "normal.txt", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await app.evaluate(({ shell }) => {
      (globalThis as any).finderTargets = [];
      shell.showItemInFolder = (path: string) => {
        (globalThis as any).finderTargets.push(path);
      };
    });
    const clipboardText = () =>
      app.evaluate(async ({ clipboard }) => {
        const item = (await clipboard.read()).find((i) => i.types.includes("text/plain"));
        return item ? (await item.getType("text/plain")).text() : "";
      });
    await row("ignored.log, unsaved").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy Relative Path", exact: true }).click();
    expect(await clipboardText()).toBe("folder/deep/ignored.log");
    await row("ignored.log, unsaved").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy Path", exact: true }).click();
    expect(await clipboardText()).toBe(join(root, "folder/deep/ignored.log"));
    await row("ignored.log, unsaved").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Reveal in Finder", exact: true }).click();
    expect(await app.evaluate(() => (globalThis as any).finderTargets)).toEqual([
      join(root, "folder/deep/ignored.log"),
    ]);
    await page
      .getByRole("tree", { name: "Files", exact: true })
      .evaluate((el) =>
        el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      );
    await page.getByRole("menuitem", { name: "Copy Path", exact: true }).click();
    expect(await clipboardText()).toBe(root);
    await page.getByRole("button", { name: "Hide Git-ignored files", exact: true }).click();
    await app.evaluate(() => {
      const cp = process.getBuiltinModule("child_process") as any,
        original = cp.execFileSync;
      (globalThis as any).failIgnore = true;
      cp.execFileSync = (...args: any[]) => {
        if ((globalThis as any).failIgnore && args[1]?.includes("check-ignore"))
          throw Object.assign(Error("Git fixture unavailable"), { status: 128 });
        return original(...args);
      };
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Git ignore filter unavailable" }),
    ).toContainText("All files are shown");
    await expect(
      page.getByRole("treeitem", { name: "ignored.log, unsaved", exact: true }),
    ).toBeVisible();
    await app.evaluate(() => {
      (globalThis as any).failIgnore = false;
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByRole("treeitem", { name: "ignored.log, unsaved", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Git ignore filter unavailable" }),
    ).toHaveCount(0);
    await row("folder").click();
    await open(other);
    await expect(
      page.getByRole("button", { name: "Hide Git-ignored files", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: "repo", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Hide Git-ignored files", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => {
        const state = JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8"));
        return (
          state.selected === root &&
          state.views[root].files.hideIgnored &&
          !state.views[root].files.expanded.includes("folder")
        );
      })
      .toBe(true);
    app.process().kill("SIGKILL");
    await new Promise((resolve) => app.process().once("exit", resolve));
    // Explicit recovery of the test-owned store after confirmed process death.
    await rm(join(user, "foundation/owner.lock"));
    app = await launchDesktop(user);
    page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "Hide Git-ignored files", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("treeitem", { name: "deep", exact: true })).toHaveCount(0);
    await expect(page.locator(".monaco-editor")).toContainText("normal disk");
    await page.getByRole("button", { name: "Reveal Active File", exact: true }).click();
    await expect(page.getByRole("treeitem", { name: "normal.txt", exact: true })).toBeVisible();
    expect(
      JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8")).drafts.find(
        (d: any) => d.path === "folder/deep/ignored.log",
      )?.text,
    ).toBe("ignored unsaved");
    await page.screenshot({ path: "test-results/files-reveal.png" });
    await page.getByRole("button", { name: "Collapse All", exact: true }).click();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.evaluate(() => {
      const then = Promise.prototype.then;
      // oxlint-disable-next-line unicorn/no-thenable -- Pause consumption of a real host listing for the origin race.
      Object.defineProperty(Promise.prototype, "then", {
        value: function (fulfilled: any, rejected: any): any {
          return then.call(
            this,
            (value: any) => {
              if (value?.entries?.some((e: any) => e.path === "folder/deep")) {
                // oxlint-disable-next-line unicorn/no-thenable -- Restore before holding the single response.
                Object.defineProperty(Promise.prototype, "then", { value: then });
                return new Promise((resolve) => {
                  (window as any).releaseReveal = () =>
                    resolve(fulfilled ? fulfilled(value) : value);
                });
              }
              return fulfilled ? fulfilled(value) : value;
            },
            rejected,
          );
        },
      });
    });
    await page.getByRole("button", { name: "Reveal Active File", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).releaseReveal))
      .toBe("function");
    await row("z-0.txt").click();
    await editor().focus();
    await page.evaluate(() => (window as any).releaseReveal());
    await expect(editor()).toBeFocused();
    await expect(page.locator(".toolbar:visible")).toContainText("z-0.txt");
    await expect(page.getByRole("treeitem", { name: "folder", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByRole("treeitem", { name: "normal.txt", exact: true })).toHaveCount(0);
  } finally {
    if (app.process().exitCode === null) {
      app.process().kill("SIGKILL");
      await new Promise((resolve) => app.process().once("exit", resolve));
    }
    await rm(base, { recursive: true, force: true });
  }
});

for (const change of ["editor close", "retained dirty editor", "root replacement", "quit"] as const) {
  test(`context authority and filter memory across ${change}`, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "escode-46-authority-")));
    const root = join(base, "repo"), other = join(base, "other"), user = join(base, "user");
    for (const path of [root, other]) {
      execFileSync("git", ["init", path]);
      await writeFile(join(path, "active.log"), "active disk");
      await writeFile(join(path, "context.txt"), path);
      await writeFile(join(path, ".gitignore"), "*.log\n");
    }
    const app = await launchDesktop(user);
    try {
      const page = await app.firstWindow();
      const open = async (path: string) => {
        await app.evaluate(({ dialog }, path) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
        }, path);
        await page.getByRole("button", { name: "Open project…" }).click();
      };
      await open(root);
      await page.getByRole("treeitem", { name: "active.log", exact: true }).click();
      if (change !== "editor close") {
        await page.locator(".monaco-editor textarea").focus();
        await page.keyboard.press("Meta+a");
        await page.keyboard.type("retained ignored draft");
      }
      await page.getByRole("button", { name: "Hide Git-ignored files", exact: true }).click();
      await expect.poll(async () => {
        const state = JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8"));
        return state.views[root]?.files?.hideIgnored &&
          (change === "editor close" || state.drafts.some((d: any) => d.text === "retained ignored draft"));
      }).toBe(true);
      await app.evaluate(({ shell }) => {
        (globalThis as any).finderTargets = [];
        shell.showItemInFolder = (path: string) => { (globalThis as any).finderTargets.push(path); };
        const fs = process.getBuiltinModule("fs/promises") as any;
        const read = fs.readFile;
        fs.readFile = (...args: any[]) => {
          const result = read(...args);
          if (!String(args[0]).endsWith("/host-chats-v1.json")) return result;
          fs.readFile = read;
          return new Promise((resolve, reject) => {
            (globalThis as any).releaseContext = () => result.then(resolve, reject);
          });
        };
      });
      // Hold real checkout authorization, then change presentation/lifetime before the side effect.
      await page.evaluate((root) => {
        (window as any).pendingContext = window.escode.project("entry-action", root, "context.txt", "finder")
          .then(() => "ok", String);
      }, root);
      await expect.poll(() => app.evaluate(() => typeof (globalThis as any).releaseContext)).toBe("function");
      if (change === "editor close") {
        await page.locator('.project-tab[data-active="true"] .project-tab-close').click();
        await expect(page.getByRole("button", { name: "repo", exact: true })).toHaveCount(0);
      } else {
        await page.evaluate((root) => window.escode.lifecycle("finish", root), root);
        await page.getByRole("button", { name: "Agents", exact: true }).click();
      }
      await open(other);
      if (change === "root replacement") {
        await app.evaluate((_, root) => {
          const fs = process.getBuiltinModule("fs") as any;
          fs.renameSync(root, root + "-original");
          fs.mkdirSync(root);
          fs.writeFileSync(root + "/context.txt", "replacement sentinel");
        }, root);
      }
      if (change === "quit") {
        await app.evaluate(({ app }) => { app.quit = () => {}; });
        await page.evaluate(() => window.escode.lifecycle("finish"));
      }
      await app.evaluate(() => (globalThis as any).releaseContext());
      const result = await page.evaluate(() => (window as any).pendingContext);
      const denied = change === "root replacement" || change === "quit";
      expect(result).toMatch(denied ? /replaced|quitting/ : /^ok$/);
      expect(await app.evaluate(() => (globalThis as any).finderTargets)).toEqual(denied ? [] : [join(root, "context.txt")]);
      const listing = await page.evaluate((root) => window.escode.listDirectory(root, "").then((result) => { if (result.kind !== "available") throw Error(result.message); return result.listing; }).then(
        (value) => value, (error) => String(error)), root);
      if (denied) expect(listing).toMatch(/replaced|quitting/);
      else {
        if (typeof listing === "string") throw Error(listing);
        expect(listing.ignored).toEqual(["active.log"]);
      }
      // Watch authority follows the retained session, with replaced roots and quit still denied.
      await page.evaluate((root) => {
        (window as any).watchResult = "pending";
        (window as any).releaseWatch = window.escode.watchFiles(root, [""], (error) => {
          (window as any).watchResult = error ?? "changed";
        });
      }, root);
      if (denied) {
        await expect.poll(() => page.evaluate(() => (window as any).watchResult)).toMatch(/replaced|closed/);
      } else {
        let notification = 0;
        await expect.poll(async () => {
          await writeFile(join(root, "watch-after-close.txt"), String(notification++));
          return page.evaluate(() => (window as any).watchResult);
        }).toBe("changed");
      }
      await page.evaluate(() => (window as any).releaseWatch());
      const state = JSON.parse(await readFile(join(user, "client-workspace-v1.json"), "utf8"));
      expect(state.views[root].files.hideIgnored).toBe(true);
      if (change !== "editor close") expect(state.drafts.find((d: any) => d.root === root)).toMatchObject({
        text: "retained ignored draft", disk: { text: "active disk" },
      });
      expect(await readFile(join(other, "context.txt"), "utf8")).toBe(other);
      const original = change === "root replacement" ? root + "-original" : root;
      expect(await readFile(join(original, "active.log"), "utf8")).toBe("active disk");
    } finally {
      app.process().kill("SIGKILL");
      await new Promise((resolve) => app.process().once("exit", resolve));
      await rm(base, { recursive: true, force: true });
    }
  });
}
