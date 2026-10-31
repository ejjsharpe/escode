import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath, mkdir } from "node:fs/promises";
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
  await mkdir(join(a, "node_modules"));
  await writeFile(join(a, "node_modules/known.txt"), "deliberately excluded");
  await writeFile(join(a, "binary.txt"), Buffer.from([0, 1]));
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    const open = async (root: string) => {
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await expect(page.locator("header")).toContainText(root);
    };
    await open(a);
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Rename a.txt", exact: true })).toBeFocused();
    await page.keyboard.press("Meta+p");
    await expect(page.getByRole("dialog", { name: "Find file", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("alpha draft");
    await page.getByRole("button", { name: "Hide Git-ignored files", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    // Lookup selection and unsupported activation preserve the current dirty editor.
    await page.keyboard.press("Meta+p");
    const lookup = page.getByRole("dialog", { name: "Find file", exact: true });
    const exactPath = lookup.getByLabel("Exact file path");
    await expect(lookup).toContainText(a);
    await exactPath.fill("binary.txt");
    await page.keyboard.press("Meta+p");
    await expect(exactPath).toHaveValue("binary.txt");
    await page.screenshot({ path: "test-results/exact-lookup-popup.png" });
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveText(["a.txt"]);
    await page.keyboard.press("Enter");
    await expect(lookup.getByRole("status")).toContainText("binary");
    await expect(exactPath).toHaveValue("binary.txt");
    await page.keyboard.press("Escape");
    await expect(page.locator(".monaco-editor textarea:focus")).toHaveCount(1);
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.getByRole("button", { name: "Find file", exact: true }).click();
    await expect(exactPath).toHaveValue("");
    await exactPath.fill(join(b, "a.txt"));
    await page.keyboard.press("Enter");
    await expect(lookup.getByRole("status")).toContainText("outside");
    await exactPath.fill(join(a, "node_modules/known.txt"));
    await lookup.getByRole("button", { name: "Open file", exact: true }).click();
    await expect(lookup).toHaveCount(0);
    await expect(page.locator(".monaco-editor:visible")).toContainText("deliberately excluded");
    await expect(page.getByRole("tab", { name: "node_modules/known.txt", exact: true })).not.toHaveAccessibleDescription(/Preview/);
    await page.getByRole("button", { name: "Find file", exact: true }).click();
    await exactPath.fill("a.txt");
    await page.keyboard.press("Enter");
    await expect(lookup).toHaveCount(0);
    await expect(page.locator(".monaco-editor:visible")).toContainText("alpha draft");
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveCount(2);
    await page.getByRole("button", { name: "Close node_modules/known.txt", exact: true }).click();
    await expect(page.getByRole("tab", { name: "node_modules/known.txt", exact: true })).toHaveCount(0);
    expect(await readFile(join(a, "a.txt"), "utf8")).toBe(a);
    await open(b);
    await expect(
      page.getByRole("button", { name: "Hide Git-ignored files", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await page.locator(".monaco-editor:visible").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("beta draft");
    await page.keyboard.press("Meta+s");
    await expect.poll(() => readFile(join(b, "a.txt"), "utf8")).toBe("beta draft");
    expect(await readFile(join(a, "a.txt"), "utf8")).toBe(a);
    await open(a);
    await expect(page.locator(".monaco-editor:visible")).toContainText("alpha draft");
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveText(["a.txt"]);
    await expect(
      page
        .getByRole("navigation", { name: "Projects" })
        .locator("button[aria-pressed]")
        .filter({ hasNotText: "Agents" }),
    ).toHaveCount(2);
    // Each explicitly opened checkout has a fixed tab. Seed chats without connecting to Codex.
    await open(worktree);
    await expect(
      page
        .getByRole("navigation", { name: "Projects" })
        .locator("button[aria-pressed]")
        .filter({ hasNotText: "Agents" }),
    ).toHaveCount(3);
    await expect(page.getByRole("navigation", { name: "Projects" })).toContainText("alpha · other · worktree");
    await expect(page.locator('.project-tab[data-active="true"] > button[aria-pressed]')).toHaveAttribute("aria-description", `other · ${worktree}`);
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
    await expect(page.getByRole("button", { name: "Chat 2", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Chat 1", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("original message draft");
    await expect(page.getByLabel("Message Codex")).toBeEnabled();
    await page.getByLabel("Message Codex").focus();
    await page.keyboard.press("Meta+p");
    await page.getByLabel("Exact file path").fill("a.txt");
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Message Codex")).toBeFocused();
    await expect(page.getByLabel("Message Codex")).toHaveValue("original message draft");
    await page.keyboard.press("Meta+p");
    await expect(page.getByLabel("Exact file path")).toHaveValue("");
    await page.getByLabel("Exact file path").fill("a.txt");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Find file", exact: true })).toHaveCount(0);
    await expect(page.locator(".monaco-editor textarea:focus")).toHaveCount(1);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("original message draft");
    await open(worktree);
    await expect(page.locator(".view-nav:visible")).toContainText(worktree);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.getByRole("button", { name: "Chat 1", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Chat 2", exact: true }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("worktree message draft");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hide Git-ignored files", exact: true })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText(a);
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveText(["a.txt"]);
    await expect(page.getByRole("tree", { name: "Files", exact: true })).toHaveAttribute(
      "aria-activedescendant",
      worktree + ":a.txt",
    );
    await open(a);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "Chat 1", exact: true }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Hide Git-ignored files", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Chats", exact: true }).click();
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
    await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveText(["a.txt"]);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await open(b);
    await page
      .getByRole("navigation", { name: "Projects" })
      .locator("button[aria-pressed]").filter({ hasText: "changed-branch" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Message Codex")).toHaveValue("original message draft");
    await page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: "Agents", exact: true }).click();
    await page.locator(".agent-row").filter({ hasText: "Chat 2" }).click();
    await expect(page.getByLabel("Message Codex")).toHaveValue("worktree message draft");
    await expect(page.locator("header")).toContainText("agents");
    await page.getByRole("button", { name: "Open checkout", exact: true }).click();
    await expect(page.locator("header")).toContainText(worktree);
    await expect(page.getByRole("navigation", { name: "Projects" }).locator("button[aria-pressed]").filter({ hasNotText: "Agents" })).toHaveCount(3);
    await expect(page.locator(".view-nav:visible")).toContainText(worktree);
    await page.locator('.project-tab[data-active="true"] .project-tab-close').click();
    await expect(page.getByRole("navigation", { name: "Projects" }).locator("button[aria-pressed]").filter({ hasNotText: "Agents" })).toHaveCount(2);
    await open(a);
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.locator(".monaco-editor:visible")).toContainText("alpha draft");
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

test("cancelled and edited lookup invocations reject delayed validation and file activation", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-lookup-races-")));
  const root = join(dir, "repo");
  execFileSync("git", ["init", root]);
  await writeFile(join(root, "a.txt"), "original editor");
  await writeFile(join(root, "slow.txt"), "delayed lookup document");
  const app = await launchDesktop(join(dir, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(() => {
      const events = process.getBuiltinModule("events"), emit = events.EventEmitter.prototype.emit;
      events.EventEmitter.prototype.emit = function(event: string, ...args: any[]) {
        if (event === "message" && typeof (this as any).send === "function") {
          const text = Buffer.from(args[0]).toString();
          if (text.includes('"tag":"searchFiles"')) ((globalThis as any).searchRequests ??= []).push(text);
        }
        if (event === "message" && typeof (this as any).send === "function" && !(this as any).lookupDelay) {
          const socket = this as any, send = socket.send;
          socket.lookupDelay = true;
          socket.send = function(...values: any[]) {
            const state = globalThis as any;
            if (state.lookupNeedle && Buffer.from(values[0]).toString().includes(state.lookupNeedle)) {
              state.lookupNeedle = undefined;
              state.releaseLookup = () => send.apply(socket, values);
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
    await page.getByRole("button", { name: "Open project…", exact: true }).click();
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).click();
    for (const needle of ['"slow.txt"', "delayed lookup document"]) {
      await app.evaluate((_electron, needle) => {
        (globalThis as any).lookupNeedle = needle;
        (globalThis as any).releaseLookup = undefined;
      }, needle);
      await page.getByRole("button", { name: "Find file", exact: true }).click();
      await page.getByLabel("Exact file path").fill("slow.txt");
      await page.keyboard.press("Enter");
      await expect.poll(() => app.evaluate(() => typeof (globalThis as any).releaseLookup)).toBe("function");
      if (needle.includes("slow.txt")) {
        await page.getByLabel("Exact file path").fill("a.txt");
        await app.evaluate(() => (globalThis as any).releaseLookup());
        // Another host query is a response barrier for the released validation.
        await page.evaluate(root => window.escode.lookupFile(root, "a.txt"), root);
        await expect(page.getByLabel("Exact file path")).toHaveValue("a.txt");
      }
      await page.keyboard.press("Escape");
      if (!needle.includes("slow.txt")) {
        await app.evaluate(() => (globalThis as any).releaseLookup());
        await page.evaluate(root => window.escode.lookupFile(root, "a.txt"), root);
      }
      await expect(page.getByRole("tablist", { name: "Open files" }).getByRole("tab")).toHaveText(["a.txt"]);
      await expect(page.locator(".monaco-editor:visible")).toContainText("original editor");
    }
    await page.getByRole("button", { name: "Find file", exact: true }).click();
    await page.getByLabel("Exact file path").fill("slow.txt");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Find file", exact: true })).toHaveCount(0);
    await expect(page.locator(".monaco-editor:visible")).toContainText("delayed lookup document");
    await expect(page.getByRole("tab", { name: "slow.txt", exact: true })).not.toHaveAccessibleDescription(/Preview/);
    await page.screenshot({ path: "test-results/exact-lookup.png" });
    // Global activation must not resurrect a checkout closed while validation is in flight.
    const second = join(dir, "second");
    execFileSync("git", ["init", second]);
    await writeFile(join(second, "slow.txt"), "second checkout");
    await app.evaluate(({ dialog }, second) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [second] });
    }, second);
    await page.getByRole("button", { name: "Open project…", exact: true }).click();
    await expect(page.locator("header")).toContainText(second);
    await app.evaluate(() => {
      (globalThis as any).searchRequests = [];
      (globalThis as any).lookupNeedle = '"positions"';
      (globalThis as any).releaseLookup = undefined;
    });
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.getByRole("button", { name: "Find file", exact: true }).click();
    await page.getByLabel("Exact file path").fill("slow.txt");
    await expect.poll(() => app.evaluate(() => typeof (globalThis as any).releaseLookup)).toBe("function");
    await page.evaluate(root => window.escode.lookupFile(root, "a.txt"), root);
    expect(await app.evaluate(() => (globalThis as any).searchRequests.length)).toBe(1);
    await page.locator(".project-tab-close").first().evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option")).toContainText(second);
    await app.evaluate(() => (globalThis as any).releaseLookup());
    await expect(page.getByRole("option")).toHaveCount(1);
    await app.evaluate(() => {
      (globalThis as any).lookupNeedle = '"slow.txt"';
      (globalThis as any).releaseLookup = undefined;
    });
    await page.keyboard.press("Enter");
    await expect.poll(() => app.evaluate(() => typeof (globalThis as any).releaseLookup)).toBe("function");
    // Exercise the existing close control while the native response is held at the wire.
    await page.locator(".project-tab-close").evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole("dialog", { name: "Find file", exact: true })).toContainText("No open checkouts");
    await app.evaluate(() => (globalThis as any).releaseLookup());
    await page.evaluate(root => window.escode.lookupFile(root, "a.txt"), root);
    await expect(page.locator(".project-tab")).toHaveCount(0);
    await expect(page.locator("header")).toContainText("agents");
    await expect(page.getByLabel("Exact file path")).toHaveValue("slow.txt");
    await page.keyboard.press("Escape");

  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
