import { test, expect } from "vite-plus/test";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  copyFile,
  chmod,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
import { codexCommand, connectCodex, findExecutable } from "./tools";

test.skipIf(process.env.ESCODE_LIVE_CHAT !== "1")(
  "installed Codex inherits distinct home/project settings on new and resumed conversations",
  async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-live-settings-")));
    const installedHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
    const userConfig = join(installedHome, "config.toml");
    const originalConfigHash = createHash("sha256")
      .update(await readFile(userConfig))
      .digest("hex");
    const privateHome = join(dir, "codex-home"),
      wrapper = join(dir, "codex");
    const alpha = join(dir, "alpha"),
      beta = join(dir, "beta");
    const cases = [
      {
        root: alpha,
        model: "gpt-6.1-sol",
        reasoning: "low",
        approval: "on-request",
        sandboxMode: "read-only",
        sandboxType: "readOnly",
      },
      {
        root: beta,
        model: "gpt-6.1-terra",
        reasoning: "high",
        approval: "never",
        sandboxMode: "workspace-write",
        sandboxType: "workspaceWrite",
      },
    ];
    let service: ChatService | undefined;
    try {
      await mkdir(privateHome, { mode: 0o700 });
      // Keep credentials private and remove the isolated home after all connections stop.
      await copyFile(join(installedHome, "auth.json"), join(privateHome, "auth.json"));
      await chmod(join(privateHome, "auth.json"), 0o600);
      for (const { root } of cases) execFileSync("git", ["init", root]);
      const homeConfig = `model = "gpt-6.1-sol"\nmodel_reasoning_effort = "low"\napproval_policy = "on-request"\nsandbox_mode = "read-only"\n[projects.${JSON.stringify(alpha)}]\ntrust_level = "trusted"\n[projects.${JSON.stringify(beta)}]\ntrust_level = "trusted"\n`;
      await writeFile(join(privateHome, "config.toml"), homeConfig, { mode: 0o600 });
      await mkdir(join(beta, ".codex"));
      const projectConfig =
        'model = "gpt-6.1-terra"\nmodel_reasoning_effort = "high"\napproval_policy = "never"\nsandbox_mode = "workspace-write"\n';
      await writeFile(join(beta, ".codex/config.toml"), projectConfig);
      const command = await codexCommand(await findExecutable("codex"), []);
      await writeFile(
        wrapper,
        `#!/usr/bin/env node
import {spawn} from 'node:child_process';
const child=spawn(${JSON.stringify(command.executable)},[...${JSON.stringify(command.args)},...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,CODEX_HOME:${JSON.stringify(privateHome)},ELECTRON_RUN_AS_NODE:'1'}});
child.on('error',()=>process.exit(1));
child.on('exit',code=>process.exit(code??1));
`,
        { mode: 0o700 },
      );
      const connector: typeof connectCodex = (cwd, receive, drop) =>
        connectCodex(cwd, receive, drop, wrapper);
      const store = new Chats(join(dir, "chats.json"));
      for (const profile of cases) {
        service = new ChatService(store, connector);
        const reference = await connector(
          profile.root,
          () => {},
          () => {},
        );
        try {
          const { config } = await reference.request("config/read", {
            cwd: profile.root,
            includeLayers: false,
          });
          expect(config.model).toBe(profile.model);
          expect(config.model_reasoning_effort).toBe(profile.reasoning);
          expect(config.approval_policy).toBe(profile.approval);
          expect(config.sandbox_mode).toBe(profile.sandboxMode);
          const expected = {
            model: profile.model,
            reasoning: profile.reasoning,
            approval: profile.approval,
            sandbox: { type: profile.sandboxType },
          };
          const chat = await service.create(profile.root);
          expect((await service.open(profile.root, chat.id)).settings).toMatchObject(expected);
          await service.send(
            profile.root,
            chat.id,
            "Reply with exactly ESCODE_SETTINGS_OK. Do not use tools or change files.",
          );
          await expect
            .poll(() => service!.snapshot(profile.root, chat.id).busy, { timeout: 90000 })
            .toBe(false);
          expect(service.snapshot(profile.root, chat.id).error).toBeNull();
          const threadId = service.snapshot(profile.root, chat.id).threadId;
          await service.draft(profile.root, chat.id, "unsent settings draft");
          await service.shutdown();
          service = new ChatService(new Chats(join(dir, "chats.json")), connector);
          const resumed = await service.open(profile.root, chat.id);
          expect(resumed.settings).toMatchObject(expected);
          expect(resumed.threadId).toBe(threadId);
          expect(resumed.busy).toBe(false);
          expect(resumed.items.filter((i) => i.type === "userMessage")).toHaveLength(1);
          expect(
            resumed.items
              .filter((i) => i.type === "agentMessage")
              .map((i) => i.text)
              .join(""),
          ).toContain("ESCODE_SETTINGS_OK");
          expect((await service.list(profile.root))[0].draft).toBe("unsent settings draft");
        } finally {
          reference.close();
          await reference.finished;
          await service.shutdown();
        }
      }
      expect(
        createHash("sha256")
          .update(await readFile(userConfig))
          .digest("hex"),
      ).toBe(originalConfigHash);
      expect(await readFile(join(privateHome, "config.toml"), "utf8")).toBe(homeConfig);
      expect(await readFile(join(beta, ".codex/config.toml"), "utf8")).toBe(projectConfig);
    } finally {
      try {
        await service?.shutdown();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  },
  240000,
);
