import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { symlink, mkdtemp, mkdir, realpath, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktop } from "./desktop";

test("saved project drafts move with text, survive restart and bind exactly once from closed-project Agents", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-draft-ui-")));
  const alpha = join(dir, "Alpha"),
    beta = join(dir, "Beta"),
    user = join(dir, "user");
  for (const root of [alpha, beta]) execFileSync("git", ["init", root]);
  const worktree = join(dir, "Beta-linked");
  execFileSync("git", [
    "-C",
    beta,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  ]);
  execFileSync("git", ["-C", beta, "worktree", "add", "-b", "linked", worktree]);
  await mkdir(user);
  await symlink(process.execPath, join(dir, "node"));
  const saved = [alpha, beta].map((root) => ({ project: root, root }));
  await writeFile(join(user, "approved-projects.json"), JSON.stringify(saved));
  await writeFile(
    join(user, "workspace.json"),
    JSON.stringify({
      projects: [],
      savedProjects: saved,
      selected: "agents",
      views: { [beta]: { checkout: worktree } },
      drafts: [],
    }),
  );
  await writeFile(
    join(dir, "codex"),
    `#!/usr/bin/env node
const {createInterface}=require('node:readline'), fs=require('node:fs');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0)}
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id||!m.method)return;
fs.appendFileSync(${JSON.stringify(join(dir, "calls"))},m.method+'\\n');
let result={}; if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:'draft-thread'},cwd:process.cwd(),model:'fixture',approvalPolicy:'on-request',sandbox:{type:'readOnly'}};
if(m.method==='thread/turns/list')result={data:[],nextCursor:null};
if(m.method==='turn/start') { result={turn:{id:'turn'}}; send({method:'turn/started',params:{threadId:'draft-thread',turn:{id:'turn'}}}); }
if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId:'draft-thread',turn:{id:'turn'}}});
send({id:m.id,result});});`,
    { mode: 0o700 },
  );
  let app = await launchDesktop(user, dir);
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.getByRole("combobox", { name: "New chat project", exact: true }).selectOption(alpha);
    const message = () => page.getByRole("textbox", { name: "Message Codex" });
    await message().fill("Retain this draft");
    const records = async () => JSON.parse(await readFile(join(user, "host-chats-v1.json"), "utf8")).chats;
    await expect.poll(async () => (await records())[0]?.draft).toBe("Retain this draft");
    const original = (await records())[0];
    await page.getByRole("combobox", { name: "Project context", exact: true }).selectOption(beta);
    await expect(message()).toHaveValue("Retain this draft");
    await expect(page.locator(".agents .directory")).toContainText(worktree);
    await expect.poll(async () => (await records())[0]?.project).toBe(beta);
    expect(await readFile(join(dir, "calls"), "utf8").catch(() => "")).toBe("");
    await page.setViewportSize({ width: 728, height: 600 });
    await message().scrollIntoViewIfNeeded();
    await expect(message()).toBeInViewport();
    await page.screenshot({ path: "test-results/escode-33-draft.png" });
    await page.setViewportSize({ width: 1100, height: 768 });
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.getByRole("combobox", { name: "New chat project", exact: true }).selectOption(beta);
    await expect(page.locator(".agent-row").filter({ hasText: "Chat 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await message().fill("Another nonempty draft");
    await expect.poll(async () => (await records())[1]?.draft).toBe("Another nonempty draft");
    await app.close();
    app = await launchDesktop(user, dir);
    page = await app.firstWindow();
    await expect(message()).toHaveValue("Another nonempty draft");
    await page.locator(".agent-row").filter({ hasText: "Chat 1" }).click();
    await expect(message()).toHaveValue("Retain this draft");
    await page.evaluate(async (beta) => {
      const { state } = await window.escode.lifecycle("load");
      state.views[beta].checkout = beta;
      await window.escode.lifecycle("persist", state);
    }, beta);
    await expect(page.locator(".agents .directory")).toContainText(worktree);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
    await expect(page.getByRole("combobox", { name: "Project context", exact: true })).toHaveCount(
      0,
    );
    expect((await records())[0]).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      project: beta,
      checkout: worktree,
      threadId: "draft-thread",
      phase: "bound",
      initialSend: "accepted",
      draft: "",
    });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Retry connection / reload history" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Retry connection / reload history" }).click();
    await expect
      .poll(
        async () =>
          (await readFile(join(dir, "calls"), "utf8"))
            .split("\n")
            .filter((x) => x === "thread/resume").length,
      )
      .toBe(1);
    expect(
      (await readFile(join(dir, "calls"), "utf8")).split("\n").filter((x) => x === "turn/start"),
    ).toHaveLength(1);
    expect((await records())[1].draft).toBe("Another nonempty draft");
    await page.screenshot({ path: "test-results/escode-33-bound.png" });
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, beta);
    await page.getByRole("button", { name: "Open project…" }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: "New chat on current checkout" }).click();
    await expect(
      page.getByRole("combobox", { name: "Project context", exact: true }),
    ).toBeVisible();
    await message().fill("Move from local Chats");
    await page.getByRole("combobox", { name: "Project context", exact: true }).selectOption(alpha);
    await expect(page.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(message()).toHaveValue("Move from local Chats");
    await expect(page.locator(".agents .directory")).toContainText(alpha);
    expect((await records())[1].draft).toBe("Another nonempty draft");
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

for (const first of ["send", "context"] as const) {
  test(`overlapping IPC keeps authorization and provider cwd together when ${first} wins`, async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-draft-authority-")));
    const alpha = join(dir, "Alpha"),
      unrelated = join(dir, "unapproved"),
      user = join(dir, "user");
    execFileSync("git", ["init", alpha]);
    await mkdir(unrelated);
    await mkdir(user);
    await symlink(process.execPath, join(dir, "node"));
    const saved = [{ project: alpha, root: alpha }];
    await writeFile(join(user, "approved-projects.json"), JSON.stringify(saved));
    await writeFile(
      join(user, "workspace.json"),
      JSON.stringify({
        projects: [],
        savedProjects: saved,
        selected: "agents",
        views: {},
        drafts: [],
      }),
    );
    const wire = join(dir, "wire.jsonl");
    await writeFile(
      join(dir, "codex"),
      `#!/usr/bin/env node
const fs=require('node:fs'),{createInterface}=require('node:readline');
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0)}
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id||!m.method)return;
fs.appendFileSync(${JSON.stringify(wire)},JSON.stringify({method:m.method,cwd:process.cwd()})+'\\n');
let result={};if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
if(m.method==='account/read')result={account:{}};
if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:'authorized-thread'},cwd:process.cwd(),model:'fixture',approvalPolicy:'on-request',sandbox:{type:'readOnly'}};
if(m.method==='thread/turns/list')result={data:[],nextCursor:null};
if(m.method==='turn/start'){result={turn:{id:'turn'}};send({method:'turn/started',params:{threadId:'authorized-thread',turn:{id:'turn'}}});send({method:'turn/completed',params:{threadId:'authorized-thread',turn:{id:'turn'}}});}
send({id:m.id,result});});`,
      { mode: 0o700 },
    );
    const app = await launchDesktop(user, dir);
    try {
      const page = await app.firstWindow();
      await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeEnabled();
      const draft = await page.evaluate(
        async ({ alpha, unrelated }) => {
          const chat = await window.escode.chat("createDraft", alpha);
          await window.escode.chat("draft", alpha, chat.id, "preserve prompt");
          const { state } = await window.escode.lifecycle("load");
          state.views[alpha] = { checkout: unrelated };
          await window.escode.lifecycle("persist", state);
          return chat;
        },
        { alpha, unrelated },
      );
      // Gate real host IO after Send captures its checkout, or before context commits.
      await app.evaluate(
        (_electron, { first }) => {
          const fs = process.getBuiltinModule("fs/promises") as any;
          const read = fs.readFile,
            rename = fs.rename;
          let reads = 0;
          const gate = new Promise<void>((resolve) => {
            (globalThis as any).releaseAuthorityGate = resolve;
          });
          (globalThis as any).authorityGateReached = false;
          fs.readFile = async (...args: any[]) => {
            const result = await read(...args);
            if (first === "send" && String(args[0]).endsWith("/chats.json") && ++reads === 3) {
              (globalThis as any).authorityGateReached = true;
              await gate;
            }
            return result;
          };
          fs.rename = async (...args: any[]) => {
            if (first === "context" && String(args[1]).endsWith("/chats.json")) {
              fs.rename = rename;
              (globalThis as any).authorityGateReached = true;
              await gate;
            }
            return rename(...args);
          };
          (globalThis as any).restoreAuthorityIO = () => {
            fs.readFile = read;
            fs.rename = rename;
            (globalThis as any).releaseAuthorityGate();
          };
        },
        { first },
      );
      const start = async (operation: "send" | "context") =>
        page.evaluate(
          ({ operation, alpha, id }) => {
            const call =
              operation === "send"
                ? window.escode.chat("send", alpha, id, "preserve prompt")
                : window.escode.chat("context", alpha, id, alpha);
            (globalThis as any)[operation + "Outcome"] = call.then(
              () => ({ ok: true }),
              (e: Error) => ({ ok: false, error: e.message }),
            );
          },
          { operation, alpha, id: draft.id },
        );
      await start(first);
      await expect
        .poll(() => app.evaluate(() => (globalThis as any).authorityGateReached))
        .toBe(true);
      await start(first === "send" ? "context" : "send");
      if (first === "send") {
        // A competing context mutation must fail while host authorization is pending.
        await page.evaluate(() => (globalThis as any).contextOutcome);
      }
      await app.evaluate(() => (globalThis as any).restoreAuthorityIO());
      const outcomes = await page.evaluate(async () => ({
        send: await (globalThis as any).sendOutcome,
        context: await (globalThis as any).contextOutcome,
      }));
      const calls = () =>
        readFile(wire, "utf8")
          .then((s) =>
            s
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line)),
          )
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          });
      expect((await calls()).filter((c) => c.cwd === unrelated)).toEqual([]);
      const stored = JSON.parse(await readFile(join(user, "host-chats-v1.json"), "utf8")).chats[0];
      if (first === "send") {
        expect(outcomes.context.ok).toBe(false);
        expect(outcomes.send.ok).toBe(true);
        expect((await calls()).every((c) => c.cwd === alpha)).toBe(true);
        expect(stored).toMatchObject({
          id: draft.id,
          checkout: alpha,
          phase: "bound",
          threadId: "authorized-thread",
        });
        expect((await calls()).filter((c) => c.method === "turn/start")).toHaveLength(1);
      } else {
        expect(outcomes.context.ok).toBe(true);
        expect(outcomes.send.ok).toBe(false);
        expect(stored).toMatchObject({
          id: draft.id,
          checkout: unrelated,
          phase: "draft",
          threadId: null,
          draft: "preserve prompt",
        });
        // The now-saved unauthorized checkout also fails without any competing mutation.
        expect(
          await page.evaluate(
            async ({ alpha, id }) =>
              window.escode.chat("send", alpha, id, "preserve prompt").then(
                () => false,
                () => true,
              ),
            { alpha, id: draft.id },
          ),
        ).toBe(true);
        expect(await calls()).toEqual([]);
      }
    } finally {
      await app.evaluate(({ dialog }) => {
        (globalThis as any).restoreAuthorityIO?.();
        dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      });
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
