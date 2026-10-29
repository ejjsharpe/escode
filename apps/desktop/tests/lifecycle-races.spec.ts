import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

for (const dirty of [false, true]) {
  test(`file close locks editing and duplicate closes while ${dirty ? "discarding" : "closing a clean file"}`, async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-file-close-")));
    const root = join(dir, "repo"),
      user = join(dir, "user");
    execFileSync("git", ["init", root]);
    await writeFile(join(root, "a.txt"), "original");
    const app = await launchDesktop(user);
    try {
      const page = await app.firstWindow();
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
        (globalThis as any).dirtyPrompts = 0;
        dialog.showMessageBox = async () => {
          (globalThis as any).dirtyPrompts++;
          return { response: 1, checkboxChecked: false };
        };
      }, root);
      await page.getByRole("button", { name: "Open project…" }).click();
      await page.getByRole("button", { name: "a.txt", exact: true }).click();
      if (dirty) {
        await page.locator(".monaco-editor:visible").click();
        await page.keyboard.press("Meta+a");
        await page.keyboard.type("discard this");
      }
      await expect
        .poll(async () => {
          const state = JSON.parse(await readFile(join(user, "workspace.json"), "utf8"));
          return dirty ? state.drafts[0]?.text : state.views[root]?.path;
        })
        .toBe(dirty ? "discard this" : "a.txt");
      // Hold the actual atomic replacement so user input can arrive before close completes.
      await app.evaluate(() => {
        const fs = process.getBuiltinModule("fs/promises") as any;
        const rename = fs.rename;
        fs.rename = async (...args: unknown[]) => {
          if (!String(args[1]).endsWith("/workspace.json")) return rename(...args);
          fs.rename = rename;
          await new Promise<void>((resolve) => {
            (globalThis as any).releasePersistence = resolve;
          });
          return rename(...args);
        };
      });
      await page.getByRole("button", { name: "Close file", exact: true }).click();
      await expect
        .poll(() => app.evaluate(() => !!(globalThis as any).releasePersistence))
        .toBe(true);
      await page.evaluate(() =>
        document.querySelector<HTMLTextAreaElement>(".monaco-editor textarea")!.focus(),
      );
      await page.keyboard.type("late input");
      await expect(
        page.getByRole("button", { name: "Close file", exact: true, includeHidden: true }),
      ).toBeDisabled();
      await expect(page.locator(".monaco-editor:visible")).not.toContainText("late input");
      await app.evaluate(() => {
        (globalThis as any).releasePersistence();
        delete (globalThis as any).releasePersistence;
      });
      await expect(page.locator(".monaco-editor:visible")).toHaveCount(0);
      expect(await app.evaluate(() => (globalThis as any).dirtyPrompts)).toBe(dirty ? 1 : 0);
      await app.close();
      expect(JSON.parse(await readFile(join(user, "workspace.json"), "utf8")).drafts).toEqual([]);
      expect(await readFile(join(root, "a.txt"), "utf8")).toBe("original");
    } finally {
      try {
        app.process().kill("SIGKILL");
      } catch {
        /* Already closed. */
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("an IPC open delayed in metadata validation cannot reopen a closed project", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-ipc-close-")));
  const root = join(dir, "repo"),
    user = join(dir, "user");
  execFileSync("git", ["init", root]);
  await writeFile(
    join(dir, "codex"),
    `#!/usr/bin/env node
const {createInterface}=require('node:readline'); const {writeFileSync}=require('node:fs');
if(process.argv.includes('--version')) { console.log('codex-cli 0.165.0'); process.exit(); }
writeFileSync('server-pid',String(process.pid));
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(!m.id||!m.method)return; let result={};
 if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
 if(m.method==='account/read')result={account:{}};
 if(m.method==='thread/start')result={thread:{id:'thread'},cwd:process.cwd(),model:'fixture',sandbox:{type:'readOnly'},approvalPolicy:'on-request'};
 process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
});
`,
    { mode: 0o700 },
  );
  const app = await launchDesktop(user, dir);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.locator("header")).toContainText(root);
    const chat = await page.evaluate((root) => window.escode.chat("create", root, root), root);
    await app.evaluate(() => {
      const fs = process.getBuiltinModule("fs/promises") as any;
      const read = fs.readFile;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      (globalThis as any).releaseMetadata = () => {
        fs.readFile = read;
        release();
      };
      (globalThis as any).metadataReads = 0;
      fs.readFile = async (...args: unknown[]) => {
        if (String(args[0]).endsWith("/chats.json")) {
          (globalThis as any).metadataReads++;
          await gate;
        }
        return read(...args);
      };
    });
    await page.evaluate(
      ({ root, id }) => {
        (window as any).pendingOpen = window.escode.chat("open", root, id).then(
          () => "connected",
          () => "rejected",
        );
      },
      { root, id: chat.id },
    );
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).metadataReads))
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    await expect(
      page.getByRole("navigation", { name: "Projects", exact: true }).getByRole("button"),
    ).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Close project", exact: true })).toHaveCount(0);
    await app.evaluate(() => {
      (globalThis as any).releaseMetadata();
      delete (globalThis as any).releaseMetadata;
    });
    expect(await page.evaluate(() => (window as any).pendingOpen)).toBe("rejected");
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(root)).not.toContain("server-pid");
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.locator("header")).toContainText(root);
    expect(await page.evaluate((root) => window.escode.chat("list", root), root)).toHaveLength(1);
  } finally {
    await app.evaluate(() => {
      (globalThis as any).releaseMetadata?.();
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
