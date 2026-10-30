import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

const row = (page: Page, path: string) => page.locator(`[data-path="${path}"] > .tree-row`);
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-import-45-")));
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

async function clipboardFiles(f: Awaited<ReturnType<typeof fixture>>, paths: string[]) {
  await f.app.evaluate(async ({ clipboard, ClipboardItem }, paths) => {
    const { pathToFileURL } = process.getBuiltinModule("url") as typeof import("node:url");
    await clipboard.write([
      new ClipboardItem({ "text/uri-list": paths.map((p) => pathToFileURL(p).href).join("\r\n") }),
    ]);
  }, paths);
}
async function paste(f: Awaited<ReturnType<typeof fixture>>, parent = "target") {
  await row(f.page, parent).click({ button: "right" });
  await f.page.getByRole("menuitem", { name: "Paste", exact: true }).click();
}
test("native clipboard copies binary and folder disk bytes, partial unsupported batch keeps originals", async () => {
  const f = await fixture();
  try {
    const binary = join(f.other, "large.bin"),
      bad = join(f.other, "bad");
    const bytes = Buffer.alloc(8 * 1024 * 1024, 0xa5);
    bytes[0] = 0;
    await writeFile(binary, bytes);
    await mkdir(bad);
    await mkdir(join(bad, ".git"));
    await clipboardFiles(f, [
      binary,
      bad,
      join(f.other, "folder"),
      join(f.other, "folder/child.ts"),
    ]);
    await paste(f);
    await expect
      .poll(() => readFile(join(f.root, "target/folder/child.ts"), "utf8").catch(String))
      .toBe("child disk");
    expect((await readFile(join(f.root, "target/large.bin"))).equals(bytes)).toBe(true);
    expect((await readFile(binary)).equals(bytes)).toBe(true);
    await expect(readFile(join(f.root, "target/bad/good"))).rejects.toThrow();
    await expect(readFile(join(f.root, "target/child.ts"))).rejects.toThrow();
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
      "Protected metadata",
    );
    await expect(f.page.getByRole("tree", { name: "Files", exact: true })).toBeFocused();
  } finally {
    await f.close();
  }
});
test("isolated preload rejects forged paths and JS Files; native-backed File drop uses disk and reload expires references", async () => {
  const f = await fixture();
  try {
    await expect(
      f.page.evaluate(() => window.escode.nativeFiles([new File(["forged"], "/etc/passwd")])),
    ).rejects.toThrow("genuine");
    await expect(
      f.page.evaluate(() =>
        window.escode.nativeFiles([{ path: "/etc/passwd" } as unknown as File]),
      ),
    ).rejects.toThrow();
    await expect(
      f.page.evaluate(
        (root) => window.escode.project("transfer", root, "import", "target", ["/etc/passwd"]),
        f.root,
      ),
    ).rejects.toThrow("expired");
    await f.page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["fake"], "fake.txt"));
      document
        .querySelector('[data-path="target"] > .tree-row')!
        .dispatchEvent(
          new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }),
        );
    });
    await expect(f.page.getByRole("alert")).toContainText("genuine native file");
    await f.page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.id = "native-fixture";
      document.body.append(input);
    });
    await f.page.locator("#native-fixture").setInputFiles(join(f.other, "a.ts"));
    // Native-backed File supplied by Chromium. Dispatch is synthetic; this is not a Finder gesture claim.
    await f.page.evaluate(() => {
      const file = (document.querySelector("#native-fixture") as HTMLInputElement).files![0];
      const transfer = new DataTransfer();
      transfer.items.add(file);
      document
        .querySelector('[data-path="target"] > .tree-row')!
        .dispatchEvent(
          new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
    });
    await expect
      .poll(() => readFile(join(f.root, "target/a.ts"), "utf8").catch(String))
      .toBe("source disk");
    expect(await readFile(join(f.other, "a.ts"), "utf8")).toBe("source disk");
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText("Copied;");
    await f.page.screenshot({ path: "/tmp/escode-files-45-import.png" });
    const token = await f.page.evaluate(() =>
      window.escode.nativeFiles(
        Array.from((document.querySelector("#native-fixture") as HTMLInputElement).files!),
      ),
    );
    await f.page.reload();
    await expect(row(f.page, "a.ts")).toBeVisible();
    await expect(
      f.page.evaluate(
        ({ root, token }) => window.escode.project("transfer", root, "import", "target", [token]),
        { root: f.root, token },
      ),
    ).rejects.toThrow("expired");
  } finally {
    await f.close();
  }
});
test("pending import Replace cannot Trash destination after source replacement; navigation preserves origin", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "target/a.ts"), "destination");
    await f.app.evaluate(({ dialog }) => {
      dialog.showMessageBox = () =>
        new Promise((resolve) => {
          (globalThis as any).replace = () => resolve({ response: 0, checkboxChecked: false });
        });
    });
    await clipboardFiles(f, [join(f.other, "a.ts")]);
    await paste(f);
    await expect
      .poll(() => f.app.evaluate(() => typeof (globalThis as any).replace))
      .toBe("function");
    const { rename } = await import("node:fs/promises");
    await rename(join(f.other, "a.ts"), join(f.other, "old-a.ts"));
    await writeFile(join(f.other, "a.ts"), "replacement");
    await f.app.evaluate(({ dialog }, other) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [other] });
    }, f.other);
    await f.page.getByRole("button", { name: "Open project…" }).click();
    await expect(f.page.locator("header")).toContainText(f.other);
    await f.app.evaluate(() => (globalThis as any).replace());
    await f.page.getByRole("button", { name: "origin", exact: true }).click();
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
      "Native source changed",
    );
    expect(await readFile(join(f.root, "target/a.ts"), "utf8")).toBe("destination");
    await expect(readFile(join(f.other, "target/a.ts"))).rejects.toThrow();
  } finally {
    await f.close();
  }
});

test("native import of generated recursive binary files leaves navigation and concurrent chat Stop responsive", async () => {
  test.setTimeout(90000);
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-import-long-45-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "bulk"));
  const bytes = Buffer.alloc(64 * 1024, 173),
    count = 8000;
  for (let batch = 0; batch < count; batch += 100)
    await Promise.all(
      Array.from({ length: 100 }, (_, i) => writeFile(join(root, `bulk/${batch + i}.bin`), bytes)),
    );
  await writeFile(
    join(base, "codex"),
    `#!/usr/bin/env node
const {createInterface}=require('node:readline');
if(process.argv.includes('--version')) {console.log('codex-cli 0.165.0');process.exit(0);}
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.id)return;let result={};
 if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
 if(m.method==='account/read')result={account:{}};
 if(m.method==='thread/start')result={thread:{id:'thread'},cwd:process.cwd(),model:'fixture',approvalPolicy:'on-request',sandbox:{type:'readOnly'}};
 if(m.method==='turn/start'){result={turn:{id:'turn'}};send({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});}
 if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn'}}});
 send({id:m.id,result});
});`,
    { mode: 0o700 },
  );
  const app = await launchDesktop(join(base, "user"), base);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      const cp = process.getBuiltinModule("child_process") as any,
        spawn = cp.spawn;
      cp.spawn = (...args: any[]) => {
        const child = spawn(...args);
        if (args[1]?.[0] === "import") {
          (globalThis as any).copyRunning = true;
          (globalThis as any).copyStarted = Date.now();
          child.on("close", () => {
            (globalThis as any).copyRunning = false;
            (globalThis as any).copyMs = Date.now() - (globalThis as any).copyStarted;
          });
        }
        return child;
      };
    }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    await expect(page.getByRole("treeitem", { name: "bulk", exact: true })).toBeVisible();
    const chat = await page.evaluate(async (root) => {
      const chat = await window.escode.chat("create", root, root);
      await window.escode.chat("open", root, chat.id);
      await window.escode.chat("send", root, chat.id, "keep running until stopped");
      return chat.id;
    }, root);
    await app.evaluate(async ({ clipboard, ClipboardItem }, root) => {
      const { pathToFileURL } = process.getBuiltinModule("url") as typeof import("node:url");
      await clipboard.write([
        new ClipboardItem({ "text/uri-list": pathToFileURL(root + "/bulk").href }),
      ]);
    }, root);
    await page.getByRole("tree", { name: "Files", exact: true }).focus();
    await page.keyboard.press("Meta+v");
    await expect.poll(() => app.evaluate(() => (globalThis as any).copyRunning)).toBe(true);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    const stopStart = Date.now();
    await page.evaluate(({ root, chat }) => window.escode.chat("stop", root, chat), { root, chat });
    const stopMs = Date.now() - stopStart;
    expect(await app.evaluate(() => (globalThis as any).copyRunning)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          ({ root, chat }) => ((project: string | null, id: string) => new Promise<import("../host/chat-service").ChatSnapshot>((resolve, reject) => { const off = window.escode.chatLive(project, id, value => { off(); resolve({ ...value, items: [...value.items], requests: [...value.requests] }); }, message => { off(); reject(Error(message)); }); }))( root, chat).then((s) => s.busy),
          { root, chat },
        ),
      )
      .toBe(false);
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).copyRunning), { timeout: 60000 })
      .toBe(false);
    const copyMs = await app.evaluate(() => (globalThis as any).copyMs);
    for (let i = 0; i < count; i++)
      expect((await readFile(join(root, `bulk copy/${i}.bin`))).equals(bytes)).toBe(true);
    console.log(
      `Generated 500 MiB / ${count} binary files: native copy ${copyMs} ms; concurrent protocol Stop ${stopMs} ms; Agents navigation completed while native copy running.`,
    );
  } finally {
    const exit = new Promise((resolve) => app.process().once("exit", resolve));
    app.process().kill("SIGKILL");
    await exit;
    await rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("imports never carry source drafts; same-folder import preserves original; dirty destination offers Keep Both", async () => {
  const f = await fixture();
  try {
    await row(f.page, "a.ts").click();
    await f.page.locator(".monaco-editor:visible textarea").focus();
    await f.page.keyboard.press("Meta+a");
    await f.page.keyboard.type("source draft");
    await expect(row(f.page, "a.ts")).toContainText("•");
    await clipboardFiles(f, [join(f.root, "a.ts")]);
    await f.page.getByRole("tree", { name: "Files", exact: true }).focus();
    await f.page.keyboard.press("Meta+v");
    await expect
      .poll(() => readFile(join(f.root, "a copy.ts"), "utf8").catch(String))
      .toBe("source disk");
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText("Copied;");
    expect(await readFile(join(f.root, "a.ts"), "utf8")).toBe("source disk");
    const drafts = JSON.parse(await readFile(join(f.user, "workspace.json"), "utf8")).drafts;
    expect(drafts.find((d: any) => d.path === "a.ts")?.text).toBe("source draft");
    expect(drafts.find((d: any) => d.path === "a copy.ts")).toBeUndefined();
    await clipboardFiles(f, [join(f.other, "a.ts")]);
    await f.app.evaluate(() => {
      (globalThis as any).choice = "Keep Both";
    });
    await f.page.keyboard.press("Meta+v");
    await expect
      .poll(() => readFile(join(f.root, "a copy 2.ts"), "utf8").catch(String))
      .toBe("source disk");
    const prompts = await f.app.evaluate(() => (globalThis as any).prompts);
    expect(prompts.at(-1).buttons).toEqual(["Open affected files", "Keep Both", "Cancel"]);
    await expect(row(f.page, "a.ts")).toContainText("•");
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText("Copied;");
    await clipboardFiles(f, [join(f.user, "workspace.json")]);
    await f.page.keyboard.press("Meta+v");
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
      "Protected app state",
    );
  } finally {
    await f.close();
  }
});

// These regressions use the actual native clipboard branch, not renderer import tokens.
async function observeImportMutations(f: Awaited<ReturnType<typeof fixture>>) {
  await f.app.evaluate(({ dialog }) => {
    (globalThis as any).mutations = [];
    (globalThis as any).trashedPaths = [];
    (globalThis as any).prompts = [];
    const cp = process.getBuiltinModule("child_process") as any;
    const execute = cp.execFileSync,
      spawn = cp.spawn;
    cp.execFileSync = (...args: any[]) => {
      if (["trash", "move"].includes(args[1]?.[0])) (globalThis as any).mutations.push(args[1][0]);
      const result = execute(...args);
      if (args[1]?.[0] === "trash") (globalThis as any).trashedPaths.push(result.toString());
      return result;
    };
    cp.spawn = (...args: any[]) => {
      const child = spawn(...args);
      if (args[1]?.[0] === "import") {
        (globalThis as any).mutations.push("import");
        (globalThis as any).importPid = child.pid;
        // Bound the known-bad recursive-copy reproduction; no retained/manual helper is touched.
        if (args[1]?.[1] === "folder") child.stdout?.once("data", () => child.kill("SIGKILL"));
        const deadline = setTimeout(() => child.kill("SIGKILL"), 500);
        child.on("close", () => clearTimeout(deadline));
      }
      return child;
    };
    dialog.showMessageBox = (async (_: unknown, options: any) => {
      (globalThis as any).prompts.push(options);
      return { response: options.buttons.indexOf("Replace"), checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
}
async function closeObserved(f: Awaited<ReturnType<typeof fixture>>) {
  const paths: string[] = await f.app.evaluate(() => (globalThis as any).trashedPaths ?? []);
  await f.close();
  for (const path of paths) await rm(path, { recursive: true, force: true });
}
async function aliasRoot(f: Awaited<ReturnType<typeof fixture>>) {
  const { stat } = await import("node:fs/promises");
  const alias = join(f.root, "..", "ORIGIN");
  const actual = await stat(f.root),
    alternate = await stat(alias).catch(() => undefined);
  test.skip(
    !alternate || alternate.dev !== actual.dev || alternate.ino !== actual.ino,
    "Fixture filesystem does not resolve the case alias to the same directory",
  );
  return alias;
}
test("R1 native clipboard case-alias same file never offers Replace or Trashes its original", async () => {
  const f = await fixture();
  try {
    const alias = await aliasRoot(f);
    const { stat } = await import("node:fs/promises");
    const before = await stat(join(f.root, "a.ts"));
    await observeImportMutations(f);
    await clipboardFiles(f, [join(alias, "a.ts")]);
    await f.page.getByRole("tree", { name: "Files", exact: true }).focus();
    await f.page.keyboard.press("Meta+v");
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
      /Copied|ENOENT|Uncertain/,
    );
    expect(await readFile(join(f.root, "a.ts"), "utf8")).toBe("source disk");
    const after = await stat(join(f.root, "a.ts"));
    expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
    expect(await f.app.evaluate(() => (globalThis as any).prompts)).toEqual([]);
    expect(await f.app.evaluate(() => (globalThis as any).mutations)).not.toContain("trash");
    expect(await readFile(join(f.root, "a copy.ts"), "utf8")).toBe("source disk");
  } finally {
    await closeObserved(f);
  }
});
test("R1 native clipboard case-alias folder descendant rejects before any staging inside original", async () => {
  const f = await fixture();
  try {
    const alias = await aliasRoot(f);
    const { readdir, stat } = await import("node:fs/promises");
    const before = await stat(join(f.root, "folder"));
    await observeImportMutations(f);
    await clipboardFiles(f, [join(alias, "folder")]);
    await paste(f, "folder");
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
      "outside the source folder",
    );
    expect(await readdir(join(f.root, "folder"))).toEqual(["child.ts"]);
    expect(await readFile(join(f.root, "folder/child.ts"), "utf8")).toBe("child disk");
    const after = await stat(join(f.root, "folder"));
    expect([after.dev, after.ino, after.mtimeMs]).toEqual([before.dev, before.ino, before.mtimeMs]);
    expect(await f.app.evaluate(() => (globalThis as any).mutations)).toEqual([]);
    expect(await f.app.evaluate(() => (globalThis as any).prompts)).toEqual([]);
  } finally {
    await closeObserved(f);
  }
});
test("R1 native clipboard unsupported basename rejects before collision offer or destination Trash", async () => {
  const f = await fixture();
  try {
    const { stat } = await import("node:fs/promises");
    const name = "bad\\name.txt",
      source = join(f.other, name),
      destination = join(f.root, "target", name);
    await writeFile(source, "source bytes");
    await writeFile(destination, "destination bytes");
    const a = await stat(source),
      b = await stat(destination);
    await observeImportMutations(f);
    await clipboardFiles(f, [source]);
    await paste(f);
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText(
      "without separators or traversal",
    );
    expect(await readFile(source, "utf8")).toBe("source bytes");
    expect(await readFile(destination, "utf8")).toBe("destination bytes");
    const aa = await stat(source),
      bb = await stat(destination);
    expect([aa.dev, aa.ino, bb.dev, bb.ino]).toEqual([a.dev, a.ino, b.dev, b.ino]);
    expect(await f.app.evaluate(() => (globalThis as any).mutations)).toEqual([]);
    expect(await f.app.evaluate(() => (globalThis as any).prompts)).toEqual([]);
  } finally {
    await closeObserved(f);
  }
});

test("R1 native clipboard Unicode alias preserves same-file original and chooses a safe sibling", async () => {
  const f = await fixture();
  try {
    const { stat } = await import("node:fs/promises");
    await mkdir(join(f.root, "café"));
    const source = join(f.root, "café/a.ts"),
      alias = join(f.root, "cafe\u0301/a.ts");
    await writeFile(source, "unicode original");
    const before = await stat(source),
      alternate = await stat(alias).catch(() => undefined);
    test.skip(
      !alternate || alternate.dev !== before.dev || alternate.ino !== before.ino,
      "Fixture filesystem does not resolve Unicode-normalization aliases to the same file",
    );
    await observeImportMutations(f);
    await clipboardFiles(f, [alias]);
    await f.page.getByRole("button", { name: "Refresh", exact: true }).click();
    await paste(f, "café");
    await expect(f.page.locator(".content:visible > [role=status]")).toContainText("Copied;");
    expect(await readFile(source, "utf8")).toBe("unicode original");
    expect((await stat(source)).ino).toBe(before.ino);
    expect(await readFile(join(f.root, "café/a copy.ts"), "utf8")).toBe("unicode original");
    expect(await f.app.evaluate(() => (globalThis as any).prompts)).toEqual([]);
    expect(await f.app.evaluate(() => (globalThis as any).mutations)).not.toContain("trash");
  } finally {
    await closeObserved(f);
  }
});
