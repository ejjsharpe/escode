import { readRecoveryFixture } from "./desktop";
import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, rename, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

const row = (page: Page, path: string) => page.locator(`[data-path="${path}"] > .tree-row`);
async function begin(page: Page, source: string, target: string, copy = false) {
  await expect(row(page, source)).toBeVisible();
  await expect(row(page, target)).toBeVisible();
  const from = await row(page, source).boundingBox(),
    to = await row(page, target).boundingBox();
  if (!from || !to) throw Error("Missing drag rows");
  if (copy) await page.keyboard.down("Alt");
  await page.mouse.move(from.x + 45, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + 50, to.y + to.height / 2, { steps: 15 });
  // Chromium starts HTML drag after crossing the threshold; send another move for dragover.
  await page.mouse.move(to.x + 52, to.y + to.height / 2);
}
async function finish(page: Page, copy = false) {
  await page.mouse.up();
  if (copy) await page.keyboard.up("Alt");
}
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-drag-44-")));
  const root = join(base, "origin"),
    other = join(base, "other"),
    user = join(base, "user");
  for (const dir of [root, other]) {
    execFileSync("git", ["init", dir]);
    await mkdir(join(dir, "target/nested"), { recursive: true });
    await mkdir(join(dir, "folder"));
    await writeFile(join(dir, "a.ts"), "source disk");
    await writeFile(join(dir, "b.ts"), "second disk");
    await writeFile(join(dir, "folder/child.ts"), "child disk");
  }
  const app = await launchDesktop(user),
    page = await app.firstWindow();
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    (globalThis as any).prompts = [];
    (globalThis as any).choice = "Move";
    dialog.showMessageBox = (async (_: unknown, options: any) => {
      (globalThis as any).prompts.push(options);
      return {
        response: options.buttons.indexOf((globalThis as any).choice),
        checkboxChecked: false,
      };
    }) as typeof dialog.showMessageBox;
  }, root);
  await page.getByRole("button", { name: "Open project…" }).click();
  await expect(row(page, "a.ts")).toBeVisible();
  return {
    app,
    page,
    root,
    other,
    user,
    close: async () => {
      const exit = new Promise((resolve) => app.process().once("exit", resolve));
      app.process().kill("SIGKILL");
      await exit;
      await rm(base, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

test("real drag hover, Option copy and confirmed dirty move retain disk, drafts and save identity", async () => {
  const f = await fixture();
  const { page, app, root, user } = f;
  try {
    await row(page, "a.ts").click();
    await page.locator(".monaco-editor:visible textarea").focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("unsaved source");
    await expect(row(page, "a.ts")).toContainText("•");
    await begin(page, "a.ts", "target", true);
    await expect(page.getByRole("status").filter({ hasText: /^Copy to target$/ })).toBeVisible();
    await expect(row(page, "target")).toHaveClass(/tree-drop/);
    await expect(row(page, "target/nested")).toBeVisible();
    await page.screenshot({ path: "/tmp/escode-files-44-copy-hover.png" });
    await finish(page, true);
    await expect
      .poll(() => readFile(join(root, "target/a.ts"), "utf8").catch(String))
      .toBe("source disk");
    const drafts = async () =>
      JSON.parse(await readRecoveryFixture(join(user, "client-workspace-v1.json"), "utf8")).drafts;
    await expect
      .poll(async () => (await drafts()).find((d: any) => d.path === "target/a.ts")?.text)
      .toBe("unsaved source");
    await expect(page.locator(".content:visible > [role=status]")).toContainText("Copied;");
    expect(await app.evaluate(() => (globalThis as any).prompts)).toEqual([]);
    await begin(page, "a.ts", "target/nested");
    await expect(
      page.getByRole("status").filter({ hasText: /^Move to target\/nested/ }),
    ).toBeVisible();
    await finish(page);
    await expect
      .poll(() => readFile(join(root, "target/nested/a.ts"), "utf8").catch(String))
      .toBe("source disk");
    await expect(readFile(join(root, "a.ts"))).rejects.toThrow();
    const prompts = await app.evaluate(() => (globalThis as any).prompts);
    expect(prompts[0].detail).toContain("Sources:\na.ts\nDestination folder: target/nested");
    await expect
      .poll(async () => (await drafts()).find((d: any) => d.path === "target/nested/a.ts")?.text)
      .toBe("unsaved source");
    await expect(page.locator('[data-path="target/nested"]')).toHaveAttribute(
      "aria-expanded",
      "true",
    ); // active moved file is revealed
    await expect(page.locator(".content:visible > [role=status]")).toContainText("Moved.");
    await row(page, "target/nested/a.ts").click();
    await expect(page.locator(".editor:visible")).toHaveAttribute(
      "data-model-uri",
      "file://" + root + "/target/nested/a.ts",
    );
    await expect(page.locator(".editor:visible")).toHaveAttribute("data-language", "typescript");
    await page.locator(".monaco-editor:visible textarea").focus();
    await page.keyboard.press("Meta+ArrowRight");
    await page.keyboard.type("!");
    await page.keyboard.press("Meta+z");
    await page.keyboard.press("Meta+s");
    await expect
      .poll(() => readFile(join(root, "target/nested/a.ts"), "utf8"))
      .toBe("unsaved source");
    expect(await readFile(join(root, "target/a.ts"), "utf8")).toBe("source disk");
  } finally {
    await f.close();
  }
});

test("move Cancel has no mutation; nested selection pruned; missing captured item gives partial results", async () => {
  const f = await fixture();
  const { page, app, root } = f;
  try {
    await app.evaluate(() => {
      (globalThis as any).choice = "Cancel";
    });
    await begin(page, "a.ts", "target");
    await finish(page);
    await expect(page.locator(".content:visible > [role=status]")).toContainText("cancelled");
    expect(await readFile(join(root, "a.ts"), "utf8")).toBe("source disk");
    await expect(readFile(join(root, "target/a.ts"))).rejects.toThrow();
    await app.evaluate(() => {
      (globalThis as any).choice = "Move";
    });
    await row(page, "folder").click();
    await row(page, "folder/child.ts").click({ modifiers: ["Meta"] });
    await row(page, "b.ts").click({ modifiers: ["Meta"] });
    await begin(page, "folder", "target");
    await rm(join(root, "b.ts"));
    await finish(page);
    await expect
      .poll(() => readFile(join(root, "target/folder/child.ts"), "utf8").catch(String))
      .toBe("child disk");
    await expect(page.locator(".content:visible > [role=status]")).toContainText("b.ts");
    const prompts = await app.evaluate(() => (globalThis as any).prompts);
    expect(prompts.at(-1).detail).toContain("Sources:\nfolder\nb.ts\nDestination");
    await expect(page.getByRole("tree", { name: "Files", exact: true })).toBeFocused();
  } finally {
    await f.close();
  }
});

test("invalid and forged drops cannot mutate; pending confirmation remains bound across project navigation", async () => {
  const f = await fixture();
  const { page, app, root, other } = f;
  try {
    await row(page, "folder").click();
    await begin(page, "folder", "folder/child.ts");
    await expect(page.locator(".tree-drop")).toHaveCount(0);
    await finish(page);
    expect(await readFile(join(root, "folder/child.ts"), "utf8")).toBe("child disk");
    await expect(
      page.evaluate(
        (root) => window.escode.project("transfer", root, "drag-copy", "target", ["forged"]),
        root,
      ),
    ).rejects.toThrow("No current escode");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = () =>
        new Promise((resolve) => {
          (globalThis as any).answer = () => resolve({ response: 0, checkboxChecked: false });
        });
    });
    await begin(page, "a.ts", "target");
    await finish(page);
    await expect.poll(() => app.evaluate(() => typeof (globalThis as any).answer)).toBe("function");
    await app.evaluate(({ dialog }, other) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [other] });
    }, other);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.locator("header")).toContainText(other);
    await app.evaluate(() => (globalThis as any).answer());
    await expect
      .poll(() => readFile(join(root, "target/a.ts"), "utf8").catch(String))
      .toBe("source disk");
    expect(await readFile(join(other, "a.ts"), "utf8")).toBe("source disk");
    await expect(readFile(join(other, "target/a.ts"))).rejects.toThrow();
    await expect(page.locator("header")).toContainText(other);
  } finally {
    await f.close();
  }
});

test("Option drop uses shared dirty collision choices, keeps originals and leaves keyboard clipboard intact", async () => {
  const f = await fixture();
  const { page, app, root, user } = f;
  try {
    await writeFile(join(root, "target/a.ts"), "destination disk");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await row(page, "target").click();
    await row(page, "target/a.ts").click();
    await page.locator(".monaco-editor:visible textarea").focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("destination unsaved");
    await expect(row(page, "target/a.ts")).toContainText("•");
    await row(page, "b.ts").click();
    await page.getByRole("tree", { name: "Files", exact: true }).focus();
    await page.keyboard.press("Meta+c");
    await app.evaluate(() => {
      (globalThis as any).choice = "Keep Both";
    });
    await begin(page, "a.ts", "target", true);
    await finish(page, true);
    await expect
      .poll(() => readFile(join(root, "target/a copy.ts"), "utf8").catch(String))
      .toBe("source disk");
    await expect(page.locator(".content:visible > [role=status]")).toContainText("Copied;");
    const prompts = await app.evaluate(() => (globalThis as any).prompts);
    expect(prompts.map((p: any) => p.buttons)).toEqual([
      ["Open affected files", "Keep Both", "Cancel"],
    ]);
    expect(await readFile(join(root, "target/a.ts"), "utf8")).toBe("destination disk");
    expect(
      JSON.parse(await readRecoveryFixture(join(user, "client-workspace-v1.json"), "utf8")).drafts.find(
        (d: any) => d.path === "target/a.ts",
      ).text,
    ).toBe("destination unsaved");
    await row(page, "target").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Paste", exact: true }).click();
    await expect
      .poll(() => readFile(join(root, "target/b.ts"), "utf8").catch(String))
      .toBe("second disk");
    expect((await app.evaluate(() => (globalThis as any).prompts)).length).toBe(1);
  } finally {
    await f.close();
  }
});

test("confirmation revalidates destination identity; cross-checkout references and protected sources fail", async () => {
  const f = await fixture();
  const { page, app, root, other } = f;
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = () =>
        new Promise((resolve) => {
          (globalThis as any).answer = () => resolve({ response: 0, checkboxChecked: false });
        });
    });
    await begin(page, "a.ts", "target");
    await finish(page);
    await expect.poll(() => app.evaluate(() => typeof (globalThis as any).answer)).toBe("function");
    const { rename, symlink } = await import("node:fs/promises");
    await rename(join(root, "target"), join(root, "retained-target"));
    await symlink(join(other, "target"), join(root, "target"));
    await app.evaluate(() => (globalThis as any).answer());
    await expect(page.locator(".content:visible > [role=status]")).toContainText(
      /changed|symbolic|symlink|link|aliases/i,
    );
    expect(await readFile(join(root, "a.ts"), "utf8")).toBe("source disk");
    await expect(readFile(join(other, "target/a.ts"))).rejects.toThrow();
    for (const source of ["../other/a.ts", ".git/config", "target"]) {
      await expect(
        page.evaluate(({ root, source }) => window.escode.project("drag-capture", root, [source]), {
          root,
          source,
        }),
      ).rejects.toThrow();
    }
    const token = await page.evaluate(
      (root) => window.escode.project("drag-capture", root, ["a.ts"]),
      root,
    );
    await app.evaluate(({ dialog }, other) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [other] });
    }, other);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.locator("header")).toContainText(other);
    await expect(
      page.evaluate(
        ({ other, token }) =>
          window.escode.project("transfer", other, "drag-copy", "target", [token]),
        { other, token },
      ),
    ).rejects.toThrow("No current escode");
    expect(await readFile(join(root, "a.ts"), "utf8")).toBe("source disk");
  } finally {
    await f.close();
  }
});

test("cancelled hover and navigation clear timers and drop authority", async () => {
  const f = await fixture();
  const { page, root } = f;
  try {
    await begin(page, "a.ts", "target");
    await page.keyboard.press("Escape");
    await finish(page);
    // Observe past the 650 ms hover deadline to catch a cancelled timer reopening the folder.
    await page.waitForTimeout(750);
    await expect(page.locator('[data-path="target"]')).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".tree-drop")).toHaveCount(0);
    await begin(page, "a.ts", "target");
    await page.evaluate(() =>
      (
        Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent === "Agents",
        ) as HTMLButtonElement
      ).click(),
    );
    await finish(page);
    await page.getByRole("button", { name: "origin", exact: true }).click();
    await page.waitForTimeout(750);
    await expect(page.locator('[data-path="target"]')).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".tree-drop")).toHaveCount(0);
    expect(await readFile(join(root, "a.ts"), "utf8")).toBe("source disk");
    await expect(readFile(join(root, "target/a.ts"))).rejects.toThrow();
    await row(page, "target").dispatchEvent("drop", {
      dataTransfer: await page.evaluateHandle(() => {
        const d = new DataTransfer();
        d.setData("application/x-escode-tree", "forged");
        return d;
      }),
    });
    await expect(page.getByRole("alert")).toContainText("Only a drag from this checkout");
  } finally {
    await f.close();
  }
});

test("pending drag move keeps its checkout when a chat selects a linked worktree", async () => {
  const f = await fixture();
  const { page, app, root } = f;
  const linked = join(root, "..", "linked");
  try {
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    ]);
    execFileSync("git", ["-C", root, "worktree", "add", "--detach", linked]);
    await mkdir(join(linked, "target"));
    await writeFile(join(linked, "a.ts"), "linked bytes");
    await page.evaluate(
      async ({ root, linked }) => {
        await window.escode.chat("create", root, root);
        await window.escode.chat("create", root, linked);
      },
      { root, linked },
    );
    await page.reload();
    await expect(row(page, "a.ts")).toBeVisible();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = () =>
        new Promise((resolve) => {
          (globalThis as any).answer = () => resolve({ response: 0, checkboxChecked: false });
        });
    });
    await begin(page, "a.ts", "target");
    await finish(page);
    await expect.poll(() => app.evaluate(() => typeof (globalThis as any).answer)).toBe("function");
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "Chat 2", exact: true }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.locator(".view-nav:visible")).toContainText(linked);
    await app.evaluate(() => (globalThis as any).answer());
    await expect
      .poll(() => readFile(join(root, "target/a.ts"), "utf8").catch(String))
      .toBe("source disk");
    expect(await readFile(join(linked, "a.ts"), "utf8")).toBe("linked bytes");
    await expect(readFile(join(linked, "target/a.ts"))).rejects.toThrow();
    await expect(page.locator(".view-nav:visible")).toContainText(linked);
  } finally {
    await f.close();
  }
});

for (const gesture of ["Option-drag", "clipboard"] as const) {
  test(`${gesture} Replace revalidates a source replaced during collision consent before destination Trash`, async () => {
    const f = await fixture();
    const { page, app, root } = f;
    try {
      await writeFile(join(root, "target/a.ts"), "original destination bytes");
      const destinationBefore = await stat(join(root, "target/a.ts"));
      await app.evaluate(({ dialog }) => {
        (globalThis as any).mutations = [];
        (globalThis as any).trashedPaths = [];
        const cp = process.getBuiltinModule("child_process") as any;
        const execute = cp.execFileSync,
          spawn = cp.spawn;
        cp.execFileSync = (...args: any[]) => {
          if (["trash", "move"].includes(args[1]?.[0]))
            (globalThis as any).mutations.push(args[1][0]);
          const result = execute(...args);
          if (args[1]?.[0] === "trash") (globalThis as any).trashedPaths.push(result.toString());
          return result;
        };
        cp.spawn = (...args: any[]) => {
          if (args[1]?.[0] === "copy") (globalThis as any).mutations.push("copy");
          return spawn(...args);
        };
        dialog.showMessageBox = (async (_: unknown, options: any) => {
          (globalThis as any).collision = options;
          return new Promise((resolve) => {
            (globalThis as any).replace = () =>
              resolve({ response: options.buttons.indexOf("Replace"), checkboxChecked: false });
          });
        }) as typeof dialog.showMessageBox;
      });
      if (gesture === "Option-drag") {
        await begin(page, "a.ts", "target", true);
        await finish(page, true);
      } else {
        await row(page, "a.ts").click();
        await page.getByRole("tree", { name: "Files", exact: true }).focus();
        await page.keyboard.press("Meta+c");
        await row(page, "target").click();
        await page.keyboard.press("Meta+v");
      }
      await expect
        .poll(() => app.evaluate(() => typeof (globalThis as any).replace))
        .toBe("function");
      expect((await app.evaluate(() => (globalThis as any).collision)).buttons).toContain(
        "Replace",
      );
      // Retain the captured inode so the new source cannot accidentally reuse it.
      await rename(join(root, "a.ts"), join(root, "captured-a.ts"));
      await writeFile(join(root, "a.ts"), "replacement source bytes");
      const replacement = await stat(join(root, "a.ts"));
      expect(replacement.ino).not.toBe((await stat(join(root, "captured-a.ts"))).ino);
      await app.evaluate(() => (globalThis as any).replace());
      const result = page.locator(".content:visible > [role=status]");
      await expect(result).toContainText("Captured source changed");
      expect(await readFile(join(root, "target/a.ts"), "utf8")).toBe("original destination bytes");
      expect((await stat(join(root, "target/a.ts"))).ino).toBe(destinationBefore.ino);
      expect(await readFile(join(root, "a.ts"), "utf8")).toBe("replacement source bytes");
      expect((await stat(join(root, "a.ts"))).ino).toBe(replacement.ino);
      expect(await readFile(join(root, "captured-a.ts"), "utf8")).toBe("source disk");
      expect(await app.evaluate(() => (globalThis as any).mutations)).toEqual([]);
      await expect(result).not.toContainText(/Moved to macOS Trash|Copied;/);
    } finally {
      const paths = await app.evaluate(() => (globalThis as any).trashedPaths ?? []);
      await f.close();
      for (const path of paths) await rm(path, { force: true });
    }
  });
}
