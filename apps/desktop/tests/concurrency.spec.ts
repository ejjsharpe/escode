import { test, expect, _electron } from "@playwright/test";
import { mkdtemp, writeFile, rm, realpath, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import electron from "electron";

test("background requests keep focus; replies, stop and connection loss stay with their chat", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-concurrent-")));
  const a = join(dir, "alpha"),
    b = join(dir, "beta");
  for (const root of [a, b]) execFileSync("git", ["init", root]);
  await writeFile(
    join(dir, "codex"),
    `#!/usr/bin/env node
import {createInterface} from 'node:readline';
if(process.argv.includes('--version')) { console.log('codex-cli 0.165.0'); process.exit(0); }
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
const threadId='thread-'+process.pid, turnId='turn';
createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line); if(!m.id) return;
 if(!m.method) { send({method:'item/agentMessage/delta',params:{threadId,turnId,itemId:'reply',delta:'Answered by '+process.pid}}); return; }
 let result={};
 if(m.method==='initialize') result={userAgent:'codex/0.165.0'};
 if(m.method==='account/read') result={account:{}};
 if(m.method==='thread/start') result={thread:{id:threadId},cwd:process.cwd(),model:'fixture',approvalPolicy:'on-request',sandbox:{type:'readOnly'}};
 if(m.method==='turn/start') {
  result={turn:{id:turnId}};
  if(m.params.input[0].text==='fail') { setTimeout(()=>process.exit(1),20); }
  else setTimeout(()=>send({id:99,method:'item/commandExecution/requestApproval',params:{threadId,turnId,itemId:'command',command:'fixture approval'}}),100);
 }
 if(m.method==='turn/interrupt') send({method:'turn/completed',params:{threadId,turn:{id:turnId}}});
 if(m.method==='thread/start') setTimeout(()=>send({id:m.id,result}),500);
 else send({id:m.id,result});
});
`,
    { mode: 0o700 },
  );
  const env = { ...process.env, PATH: dir + ":" + process.env.PATH };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ESCODE_DEV_URL;
  const app = await _electron.launch({
    executablePath: electron as unknown as string,
    args: [".", `--user-data-dir=${join(dir, "user")}`],
    env,
  });
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
    await open(b);
    const ids = await page.evaluate(
      async ({ a, b }) => {
        const chats = [
          await window.escode.chat("create", a, a),
          await window.escode.chat("create", a, a),
          await window.escode.chat("create", b, b),
        ];
        await Promise.all(chats.map((c) => window.escode.chat("open", c.project, c.id)));
        return chats.map((c) => c.id);
      },
      { a, b },
    );
    // Load seeded chats while keeping the real app-server processes alive.
    await open(a);
    await page.reload();
    await open(a);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "Chat 1", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Ready");
    await page.getByRole("button", { name: "Retry connection / reload history" }).click();
    await page.getByRole("button", { name: "Chat 2", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ a, ids }) => window.escode.chat("snapshot", a, ids[0]).then((s) => s.connected),
          { a, ids },
        ),
      )
      .toBe(true);
    await expect(page.getByRole("button", { name: "Chat 2", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("textbox", { name: "Message Codex" }).fill("second draft");
    await page.evaluate((a) => window.escode.chat("list", a), a);
    await page.getByRole("button", { name: "Chat 1", exact: true }).click();
    // Gate the store's atomic replacement to delay create without a production test hook.
    await app.evaluate(() => {
      const fs = process.getBuiltinModule("fs/promises") as any;
      const rename = fs.rename;
      fs.rename = async (...args: unknown[]) => {
        if (!String(args[1]).endsWith("/chats.json")) return rename(...args);
        fs.rename = rename;
        await new Promise<void>((resolve) => {
          (globalThis as any).releaseChatCreate = resolve;
        });
        return rename(...args);
      };
    });
    await page.getByRole("button", { name: "New chat on current checkout" }).click();
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).releaseChatCreate)).toBe(true);
    await page.getByRole("button", { name: "Chat 2", exact: true }).click();
    await app.evaluate(() => {
      (globalThis as any).releaseChatCreate();
      delete (globalThis as any).releaseChatCreate;
    });
    await expect(page.getByRole("button", { name: "Chat 3", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Chat 2", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("second draft");
    await expect(page.locator(".view-nav:visible")).toContainText(a);
    await open(b);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "Chat 1", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Message Codex" });
    await input.fill("keep focus");
    await input.focus();
    const requests = await page.evaluate(
      async ({ a, b, ids }) => {
        await Promise.all([
          window.escode.chat("send", a, ids[0], "one"),
          window.escode.chat("send", a, ids[1], "two"),
          window.escode.chat("send", b, ids[2], "three"),
        ]);
      },
      { a, b, ids },
    );
    void requests;
    await expect(
      page
        .getByRole("navigation", { name: "Projects" })
        .getByRole("button", { name: "alpha · Needs input" }),
    ).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("keep focus");
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await expect(page.locator(".transcript:visible")).toContainText("Answered by");
    await rename(a, a + "-unavailable");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await rename(a + "-unavailable", a);
    const states = await page.evaluate(
      async ({ a, b, ids }) =>
        Promise.all([
          window.escode.chat("snapshot", a, ids[0]),
          window.escode.chat("snapshot", a, ids[1]),
          window.escode.chat("snapshot", b, ids[2]),
        ]),
      { a, b, ids },
    );
    expect(states.map((s) => s.busy)).toEqual([true, true, false]);
    expect(states[0].requests).toHaveLength(1);
    expect(states[1].requests).toHaveLength(1);
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: "alpha · Needs input" })
      .click();
    await page.getByRole("button", { name: "Chats · Needs input", exact: true }).click();
    await page.getByRole("button", { name: "Chat 1 · Needs input", exact: true }).click();
    await expect(
      page.getByText("These chats share files in this checkout. Their edits can interact."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.getByRole("textbox", { name: "Message Codex" }).fill("fail");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/disconnected|connection closed/);
    const token = states[0].requests[0].token;
    const result = await page.evaluate(
      async ({ a, ids, token }) => {
        try {
          await window.escode.chat("answer", a, ids[0], token, "accept");
          return "wrong";
        } catch {
          return "stale";
        }
      },
      { a, ids, token },
    );
    expect(result).toBe("stale");
    const survivor = await page.evaluate(
      ({ a, ids }) => window.escode.chat("snapshot", a, ids[1]),
      { a, ids },
    );
    expect(survivor.busy).toBe(true);
    expect(survivor.requests).toHaveLength(1);
    await page.screenshot({ path: "test-results/concurrency.png" });
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options: any) => ({
        response: options.buttons[0] === "Save" ? 1 : 0,
        checkboxChecked: false,
      });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
