import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm, realpath, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop, readChats } from "./desktop";

test("background requests keep focus; replies, stop and connection loss stay with their chat", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-concurrent-")));
  const a = join(dir, "alpha"),
    b = join(dir, "beta");
  for (const root of [a, b]) execFileSync("git", ["init", root]);
  const lookupFiles=Number(process.env.ESCODE_LOOKUP_FILES ?? 0);
  for(let folder=0;folder<Math.ceil(lookupFiles/100);folder++) {
    const path=join(a,'dataset',String(folder));await mkdir(path,{recursive:true});
    await Promise.all(Array.from({length:Math.min(100,lookupFiles-folder*100)},(_,i)=>writeFile(join(path,`candidate-${i}.txt`),'fixture')));
  }
  await writeFile(
    join(dir, "codex"),
    `#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {appendFileSync,existsSync} from 'node:fs';
if(process.argv.includes('--version')) { console.log('codex-cli 0.165.0'); process.exit(0); }
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
let threadId='thread-'+process.pid; const turnId='turn'; let nextRequestId=99;
createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line); if(!m.id) return;
 if(!m.method) { appendFileSync(${JSON.stringify(join(dir, "events"))},JSON.stringify({responseId:m.id,result:m.result,threadId})+'\\n'); send({method:'item/agentMessage/delta',params:{threadId,turnId,itemId:'reply',delta:'Answered by '+process.pid}}); return; }
 appendFileSync(${JSON.stringify(join(dir, "events"))},JSON.stringify({method:m.method,threadId})+'\\n');
 if(m.method==='thread/resume') threadId=m.params.threadId;
 let result={};
 if(m.method==='initialize') result={userAgent:'codex/0.165.0'};
 if(m.method==='account/read') result={account:{}};
 if(m.method==='thread/start'||m.method==='thread/resume') result={thread:{id:threadId},cwd:process.cwd(),model:'fixture',approvalPolicy:'on-request',sandbox:{type:'readOnly'}};
 if(m.method==='thread/turns/list') result={data:[],nextCursor:null};
 if(m.method==='turn/start') {
  result={turn:{id:turnId}};
  send({method:'turn/started',params:{threadId,turn:{id:turnId}}});
  if(m.params.input[0].text==='fail') { setTimeout(()=>process.exit(1),20); }
  else setTimeout(()=>send({id:nextRequestId++,method:'item/commandExecution/requestApproval',params:{threadId,turnId,itemId:'command',command:'fixture approval'}}),100);
 }
 if(m.method==='turn/interrupt') send({method:'turn/completed',params:{threadId,turn:{id:turnId}}});
 if(m.method==='turn/start' && m.params.input[0].text==='delayed') {
  setTimeout(()=>send({id:nextRequestId++,method:'item/tool/requestUserInput',params:{threadId,turnId,itemId:'question',questions:[{id:'choice',question:'Which choice?',options:[]}]}}),100);
  const timer=setInterval(()=>{if(existsSync(${JSON.stringify(join(dir, "release-send"))})) {clearInterval(timer);send({id:m.id,result});}},20);
 }
 else if(m.method==='thread/start') setTimeout(()=>send({id:m.id,result}),500);
 else send({id:m.id,result});
});
`,
    { mode: 0o700 },
  );
  const app = await launchDesktop(join(dir, "user"), dir);
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
    await page.getByText("Chat actions", { exact: true }).click();
    await page.getByRole("button", { name: "Reload history", exact: true }).click();
    await page.getByText("Chat actions", { exact: true }).click();
    await page.getByRole("button", { name: "Chat 2", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          ({ a, ids }) => ((project: string | null, id: string) => new Promise<import("../host/chat-service").ChatSnapshot>((resolve, reject) => { const off = window.escode.chatLive(project, id, value => { off(); resolve({ ...value, items: [...value.items], requests: [...value.requests] }); }, message => { off(); reject(Error(message)); }); }))( a, ids[0]).then((s) => s.connected),
          { a, ids },
        ),
      )
      .toBe(true);
    await expect(page.getByRole("button", { name: "Chat 2", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("textbox", { name: "Message Codex" }).fill("second draft");
    await page.evaluate(readChats, a);
    const before = await page.evaluate(({ a, ids }) => ((project: string | null, id: string) => new Promise<import("../host/chat-service").ChatSnapshot>((resolve, reject) => { const off = window.escode.chatLive(project, id, value => { off(); resolve({ ...value, items: [...value.items], requests: [...value.requests] }); }, message => { off(); reject(Error(message)); }); }))( a, ids[1]), {
      a,
      ids,
    });
    const events = async () =>
      (await readFile(join(dir, "events"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    const connections = (await events()).filter((e) => e.method === "initialize").length;
    await page.getByRole("textbox", { name: "Message Codex" }).fill("delayed");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await events()).filter(
            (e) => e.method === "turn/start" && e.threadId === before.threadId,
          ).length,
      )
      .toBe(1);
    // Files unmounts the conversation entry view while Send is awaiting acknowledgement.
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("button", { name: /Chats/, exact: false }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("delayed");
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeDisabled();
    const approval = page.getByRole("button", { name: "Allow once", exact: true });
    await expect(approval).toBeEnabled();
    await expect(page.locator(".chat-actions:visible [role=status]")).toHaveText("Needs input");
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await page.locator(".agent-row").filter({ hasText: "Chat 2" }).click();
    await expect(approval).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("delayed");
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: /^alpha/ })
      .click();
    await expect(approval).toBeEnabled();
    // Close the editor while first Send still awaits acknowledgement. Requests and
    // shared pending state must remain usable through Agents without another connection.
    await page.locator('.project-tab[data-active="true"] .project-tab-close').click();
    await expect(page.locator('header')).toContainText(b);
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(approval).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("delayed");
    await open(a);
    // Delay host reads so responses remain pending across a conversation remount.
    await app.evaluate(() => {
      const fs = (process.getBuiltinModule("worker_threads") as any).Worker.prototype;
      const readFile = fs.postMessage;
      const gate = new Promise<void>((resolve) => {
        (globalThis as any).releaseChatResponses = () => {
          fs.postMessage = readFile;
          resolve();
        };
      });
      fs.postMessage = async function(this: any, ...args: unknown[]) {
        if ((args[0] as any)?.operation === "read") await gate;
        return readFile.apply(this, args);
      };
    });
    if(process.env.ESCODE_LOOKUP_MEASURE) await page.evaluate(root=>{
      let cancel=()=>{};
      const scan=()=>{cancel();cancel=window.escode.searchFiles(root,'candidate',()=>{},()=>{},[]);};
      scan();const timer=setInterval(scan,150);
      (window as any).stopLookupLoad=()=>{clearInterval(timer);cancel();};
    },a);
    const approvalStart=performance.now();
    await approval.click();
    await expect(approval).toBeDisabled();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("button", { name: /Chats/ }).click();
    await expect(approval).toBeDisabled();
    const sendAnswers = page.getByRole("button", { name: "Send answers", exact: true });
    await expect(sendAnswers).toBeEnabled();
    await page.getByRole("textbox", { name: "Which choice?" }).fill("first");
    // Form submission can bypass a disabled submit button: the shared guard must reject duplicates.
    await sendAnswers.evaluate((button) => {
      const form = button.closest("form")!;
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(sendAnswers).toBeDisabled();
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
    await app.evaluate(() => {
      (globalThis as any).releaseChatResponses();
      delete (globalThis as any).releaseChatResponses;
    });
    await expect
      .poll(async () =>
        (await events())
          .filter((e) => e.responseId && e.threadId === before.threadId)
          .sort((a, b) => a.responseId - b.responseId),
      )
      .toEqual([
        { responseId: 99, result: { decision: "accept" }, threadId: before.threadId },
        {
          responseId: 100,
          result: { answers: { choice: { answers: ["first"] } } },
          threadId: before.threadId,
        },
      ]);
    await expect(approval).toHaveCount(0);
    await expect(sendAnswers).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("delayed");
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toBeDisabled();
    await expect(page.locator(".transcript:visible")).toContainText("Answered by");
    if(process.env.ESCODE_LOOKUP_MEASURE) console.log('LOOKUP_CHAT_MEASUREMENT '+JSON.stringify({mode:process.env.ESCODE_PACKAGED?'packaged':'built',lookupFiles,approvalAndReplyJourneyMs:performance.now()-approvalStart}));
    await writeFile(join(dir, "release-send"), "release");
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("");
    const after = await page.evaluate(({ a, ids }) => ((project: string | null, id: string) => new Promise<import("../host/chat-service").ChatSnapshot>((resolve, reject) => { const off = window.escode.chatLive(project, id, value => { off(); resolve({ ...value, items: [...value.items], requests: [...value.requests] }); }, message => { off(); reject(Error(message)); }); }))( a, ids[1]), {
      a,
      ids,
    });
    expect(after.threadId).toBe(before.threadId);
    expect(after.busy).toBe(true);
    expect((await events()).filter((e) => e.method === "initialize")).toHaveLength(connections);
    expect(
      (await events()).filter((e) => e.method === "turn/start" && e.threadId === before.threadId),
    ).toHaveLength(1);
    const stopStart=performance.now();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Ready");
    if(process.env.ESCODE_LOOKUP_MEASURE) {
      console.log('LOOKUP_CHAT_MEASUREMENT '+JSON.stringify({mode:process.env.ESCODE_PACKAGED?'packaged':'built',lookupFiles,stopToReadyMs:performance.now()-stopStart}));
      await page.evaluate(()=>(window as any).stopLookupLoad());
    }
    await page.getByRole("textbox", { name: "Message Codex" }).fill("second draft");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await page.getByRole("button", { name: /Chats/ }).click();
    await expect(page.getByRole("textbox", { name: "Message Codex" })).toHaveValue("second draft");

    await page.getByRole("button", { name: "Chat 1", exact: true }).click();
    await expect(page.getByRole("button", { name: "New chat on current checkout" })).toBeEnabled();
    // Gate the store's atomic replacement after opening the selected chat has settled.
    await app.evaluate(() => {
      const fs = (process.getBuiltinModule("worker_threads") as any).Worker.prototype;
      const rename = fs.postMessage;
      fs.postMessage = async function(this: any, ...args: unknown[]) {
        if ((args[0] as any)?.operation !== "write") return rename.apply(this, args);
        fs.postMessage = rename;
        await new Promise<void>((resolve) => {
          (globalThis as any).releaseChatCreate = resolve;
        });
        return rename.apply(this, args);
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
    await expect.poll(() => page.evaluate(({ b, id }) => new Promise<boolean>((resolve, reject) => { const off = window.escode.chatLive(b, id, value => { off(); resolve(value.busy); }, reject); }), { b, id: ids[2] })).toBe(false);
    const states = await page.evaluate(
      async ({ a, b, ids }) =>
        Promise.all([
          ((project: string | null, id: string) => new Promise<import("../host/chat-service").ChatSnapshot>((resolve, reject) => { const off = window.escode.chatLive(project, id, value => { off(); resolve({ ...value, items: [...value.items], requests: [...value.requests] }); }, message => { off(); reject(Error(message)); }); }))( a, ids[0]),
          ((project: string | null, id: string) => new Promise<import("../host/chat-service").ChatSnapshot>((resolve, reject) => { const off = window.escode.chatLive(project, id, value => { off(); resolve({ ...value, items: [...value.items], requests: [...value.requests] }); }, message => { off(); reject(Error(message)); }); }))( a, ids[1]),
          ((project: string | null, id: string) => new Promise<import("../host/chat-service").ChatSnapshot>((resolve, reject) => { const off = window.escode.chatLive(project, id, value => { off(); resolve({ ...value, items: [...value.items], requests: [...value.requests] }); }, message => { off(); reject(Error(message)); }); }))( b, ids[2]),
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
    await expect(page.getByRole("alert")).toContainText(/disconnected|connection closed|input stream ended/);
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
      ({ a, ids }) => ((project: string | null, id: string) => new Promise<import("../host/chat-service").ChatSnapshot>((resolve, reject) => { const off = window.escode.chatLive(project, id, value => { off(); resolve({ ...value, items: [...value.items], requests: [...value.requests] }); }, message => { off(); reject(Error(message)); }); }))( a, ids[1]),
      { a, ids },
    );
    expect(survivor.busy).toBe(true);
    expect(survivor.requests).toHaveLength(1);
    await page.screenshot({ path: "test-results/concurrency.png" });
  } finally {
    await app.evaluate(() => {
      (globalThis as any).releaseChatResponses?.();
      (globalThis as any).releaseChatCreate?.();
    });
    await writeFile(join(dir, "release-send"), "release");
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
