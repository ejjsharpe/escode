import { test, expect, type Locator } from "@playwright/test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("keyboard can navigate projects, edit, review an accessible diff and answer scoped chat input", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-keyboard-")));
  const root = join(dir, "repo"),
    other = join(dir, "other");
  for (const path of [root, other]) execFileSync("git", ["init", path]);
  await writeFile(join(root, "a.txt"), "before\n");
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
  await writeFile(join(root, "a.txt"), "after\n");
  await writeFile(
    join(dir, "codex"),
    `#!/usr/bin/env node
import {createInterface} from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-cli 0.165.0');process.exit(0);}
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const threadId='thread',turnId='turn';
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.id)return;
 if(!m.method){send({method:'item/completed',params:{threadId,turnId,item:{id:'reply',type:'agentMessage',text:'Input received: '+m.result.answers.choice.answers[0]}}});send({method:'turn/completed',params:{threadId,turn:{id:turnId}}});return;}
 let result={};
 if(m.method==='initialize')result={userAgent:'codex/0.165.0'};
 if(m.method==='account/read')result={account:{}};
 if(m.method==='thread/start')result={thread:{id:threadId},cwd:process.cwd(),model:'fixture',approvalPolicy:'on-request',sandbox:{type:'readOnly'}};
 if(m.method==='turn/interrupt')send({method:'turn/completed',params:{threadId,turn:{id:turnId}}});
 if(m.method==='turn/start'){result={turn:{id:turnId}};setTimeout(()=>send({id:99,method:'item/tool/requestUserInput',params:{threadId,turnId,questions:[{id:'choice',question:'Which name should I use?'}]}}),20);}
 send({id:m.id,result});
});
`,
    { mode: 0o700 },
  );
  const app = await launchDesktop(join(dir, "user"), dir);
  try {
    const page = await app.firstWindow();
    const reach = async (target: Locator) => {
      for (let i = 0; i < 60; i++) {
        if (await target.evaluate((el) => el === document.activeElement)) return;
        await page.keyboard.press("Tab");
      }
      throw Error("Keyboard could not reach " + (await target.getAttribute("aria-label")));
    };
    const activate = async (target: Locator) => {
      await reach(target);
      await page.keyboard.press("Enter");
    };
    const open = async (path: string) => {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      }, path);
      await activate(page.getByRole("button", { name: "Open project…" }));
      await expect(page.locator("header")).toContainText(path);
    };
    await open(root);
    await open(other);
    const project = page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("button", { name: "repo", exact: true });
    await activate(project);
    await expect(project).toHaveAttribute("aria-pressed", "true");
    await reach(page.getByRole("tree", { name: "Files", exact: true }));
    await page.keyboard.press("Space");
    const editor = page.getByRole("textbox", { name: "a.txt editor", exact: true });
    await reach(editor);
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("keyboard edit");
    await page.keyboard.press("Meta+s");
    await expect
      .poll(() => import("node:fs/promises").then((fs) => fs.readFile(join(root, "a.txt"), "utf8")))
      .toBe("keyboard edit");
    await page.keyboard.press("Control+Shift+m");
    await activate(page.getByRole("button", { name: "Source Control", exact: true }));
    await activate(page.getByRole("button", { name: "a.txt", exact: true }));
    const diff = page.getByRole("textbox", { name: "unstaged · a.txt modified", exact: true });
    await expect(diff).toBeEditable();
    await reach(diff);
    await page.keyboard.press("F7");
    await expect(
      page.getByRole("list", {
        name: "Accessible Diff Viewer. Use arrow up and down to navigate.",
      }),
    ).toContainText("keyboard edit");
    await page.keyboard.press("Escape");
    await expect(diff).toBeFocused();
    await page.waitForTimeout(2200);
    await expect(diff).toBeFocused();
    await activate(page.getByRole("button", { name: "Chats", exact: true }));
    await activate(page.getByRole("button", { name: "New chat on current checkout" }));
    await expect(page.locator(".chat-actions [role=status]")).toHaveText("Draft");
    const compose = page.getByRole("textbox", { name: "Message Codex" });
    await reach(compose);
    await page.keyboard.type("ask me a question");
    await activate(page.getByRole("button", { name: "Send message", exact: true }));
    const question = page.getByRole("textbox", { name: "Which name should I use?", exact: true });
    await reach(question);
    await page.keyboard.type("keyboard answer");
    await activate(page.getByRole("button", { name: "Send answers", exact: true }));
    await expect(page.getByLabel("Conversation history")).toContainText(
      "Input received: keyboard answer",
    );
    await activate(page.getByRole("button", { name: "Agents", exact: true }));
    await activate(page.getByRole("button", { name: "No project", exact: true }));
    const context = page.getByRole("combobox", { name: "Project context", exact: true });
    await reach(context);
    await expect(context).toHaveValue("");
    await reach(compose);
    await page.keyboard.type("keyboard scratch question");
    await activate(page.getByRole("button", { name: "Send message", exact: true }));
    await reach(question);
    await page.keyboard.type("scratch keyboard answer");
    await activate(page.getByRole("button", { name: "Send answers", exact: true }));
    await expect(page.getByLabel("Conversation history")).toContainText("Input received: scratch keyboard answer");
    await reach(compose);
    await page.keyboard.type("stop this scratch turn");
    await activate(page.getByRole("button", { name: "Send message", exact: true }));
    await expect(question).toBeVisible();
    await activate(page.getByRole("button", { name: "Stop", exact: true }));
    await expect(page.locator(".chat-actions [role=status]")).toHaveText("Ready");
    await page.screenshot({ path: "test-results/keyboard.png" });
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
