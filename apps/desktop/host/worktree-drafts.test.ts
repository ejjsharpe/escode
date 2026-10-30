import { test, expect, vi } from "vite-plus/test";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Project } from "./project";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";

for (const failure of [
  "moved-base",
  "occupied",
  "replaced-directory",
  "lost-persistence",
  "provider",
  "cancelled",
] as const) {
  test(`deferred worktree first Send and durable failures: ${failure}`, async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "escode-worktree-draft-")));
    const root = join(dir, "repo"),
      managed = join(dir, "managed"),
      file = join(dir, "chats.json");
    mkdirSync(root);
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args])
        .toString()
        .trim();
    git("init", "-b", "main");
    writeFileSync(join(root, "tracked"), "committed");
    writeFileSync(join(root, ".gitignore"), "ignored\n");
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial");
    const project = await Project.open(root),
      store = new Chats(file);
    const chat = await store.createDraft(root, root);
    const base = project.worktreeOptions().bases.find((b) => b.ref === "refs/heads/main")!;
    const choice = { source: root, ...base };
    await store.context(root, chat.id, root, root, choice);
    expect((await store.createDraft(root, root)).id).not.toBe(chat.id);
    writeFileSync(join(root, "tracked"), "staged");
    git("add", "tracked");
    writeFileSync(join(root, "tracked"), "unstaged");
    writeFileSync(join(root, "untracked"), "untracked");
    writeFileSync(join(root, "ignored"), "ignored");
    const index = readFileSync(join(root, ".git/index"));
    let connections = 0;
    const service = new ChatService(store, async (cwd) => {
      connections++;
      expect(readFileSync(join(cwd, "tracked"), "utf8")).toBe("committed");
      expect(existsSync(join(cwd, "ignored"))).toBe(false);
      throw Error("provider fixture unavailable");
    });
    try {
      await service.open(root, chat.id);
      expect(existsSync(managed)).toBe(false);
      if (failure === "provider") {
        await expect(service.send(root, chat.id, "keep prompt")).rejects.toThrow(
          "has not been prepared",
        );
        expect(connections).toBe(0);
        expect(existsSync(managed)).toBe(false);
      }
      if (failure === "moved-base") git("update-ref", "-d", base.ref);
      if (failure === "occupied") {
        const reserve = project.reserveWorktree.bind(project);
        vi.spyOn(project, "reserveWorktree").mockImplementation((...args) => {
          const result = reserve(...args);
          mkdirSync(result.root);
          writeFileSync(join(result.root, "valuable"), "retain");
          return result;
        });
      }
      if (failure === "replaced-directory") {
        const create = project.createWorktree.bind(project);
        vi.spyOn(project, "createWorktree").mockImplementation((...args) => {
          const result = create(...args);
          renameSync(result.root, result.root + "-original");
          mkdirSync(result.root);
          return result;
        });
      }
      if (failure === "lost-persistence") {
        const update = store.update.bind(store);
        vi.spyOn(store, "update").mockImplementation(async (...args) => {
          if (args[2].worktree?.reservation?.dev !== undefined) throw Error("disk failure");
          return update(...args);
        });
      }
      await expect(
        service.send(
          root,
          chat.id,
          "keep prompt",
          async () => {},
          async (snapshot) => {
            const prepared = await store.prepareWorktree(snapshot, project, managed);
            if (failure === "cancelled") {
              expect(service.snapshot(root, chat.id).preparing).toBe(true);
              await service.stop(root, chat.id);
            }
            return prepared;
          },
        ),
      ).rejects.toThrow();
      const saved = await new Chats(file).get(root, chat.id);
      expect(saved).toMatchObject({
        id: chat.id,
        createdAt: chat.createdAt,
        draft: "keep prompt",
        threadId: null,
      });
      expect(readFileSync(join(root, ".git/index"))).toEqual(index);
      for (const [name, bytes] of [
        ["tracked", "unstaged"],
        ["untracked", "untracked"],
        ["ignored", "ignored"],
      ])
        expect(readFileSync(join(root, name), "utf8")).toBe(bytes);
      if (failure === "moved-base") expect(saved.worktree?.reservation).toBeUndefined();
      else {
        expect(saved.worktree?.reservation?.root).toBe(saved.checkout);
        await expect(service.context(root, chat.id, null, "")).rejects.toThrow(
          "prepared resources",
        );
        if (failure === "occupied")
          expect(readFileSync(join(saved.checkout, "valuable"), "utf8")).toBe("retain");
        if (
          failure === "lost-persistence" ||
          failure === "occupied" ||
          failure === "replaced-directory"
        ) {
          expect(connections).toBe(0);
          await expect(new Chats(file).prepareWorktree(saved, project, managed)).rejects.toThrow(
            "Worktree preparation unavailable",
          );
        }
        expect((await new Chats(file).get(root, chat.id)).checkout).toBe(saved.checkout);
      }
      if (failure === "cancelled") {
        expect(connections).toBe(0);
        const restarted = new Chats(file);
        expect(await restarted.prepareWorktree(saved, project, managed)).toEqual(saved);
        expect((await restarted.get(root, chat.id)).draft).toBe("keep prompt");
      }
      if (failure === "provider") expect(connections).toBe(1);
    } finally {
      service.close();
      project.close();
      vi.restoreAllMocks();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const outcome of [
  "creation-rejected",
  "creation-uncertain",
  "accepted-lost-ack",
  "cancelled-creation",
  "cancelled-acceptance",
  "live",
] as const) {
  test.skipIf(outcome === "live" && process.env.ESCODE_LIVE_CHAT !== "1")(
    `prepared worktree retains provider identity across restart: ${outcome}`,
    async () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "escode-worktree-provider-")));
      const root = join(dir, "repo"),
        file = join(dir, "chats.json"),
        managed = join(dir, "managed");
      mkdirSync(root);
      const git = (...args: string[]) =>
        execFileSync("git", ["-C", root, ...args])
          .toString()
          .trim();
      git("init", "-b", "main");
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "initial",
      );
      const project = await Project.open(root),
        store = new Chats(file);
      const chat = await store.createDraft(root, root);
      const base = project.worktreeOptions().bases.find((b) => b.ref === "HEAD")!;
      await store.context(root, chat.id, root, root, { ...base, source: root });
      let starts = 0,
        accepted = 0;
      const connector: ConstructorParameters<typeof ChatService>[1] =
        outcome === "live"
          ? undefined
          : async (cwd, _emit, drop) => ({
              async request(method: string, _params: any) {
                if (method === "account/read") return { account: {} };
                if (method === "thread/start") {
                  starts++;
                  if (outcome === "cancelled-creation") await service.stop(root, chat.id);
                  if (outcome.startsWith("creation"))
                    throw Object.assign(Error("creation failed"), {
                      rejected: outcome === "creation-rejected",
                    });
                }
                if (method === "thread/start" || method === "thread/resume")
                  return {
                    thread: { id: "known" },
                    cwd,
                    model: "fixture",
                    sandbox: {},
                    approvalPolicy: "on-request",
                  };
                if (method === "turn/start") {
                  accepted++;
                  if (outcome === "cancelled-acceptance") {
                    _emit({ method: "turn/started", params: { threadId: "known", turn: { id: "turn" } } });
                    await service.stop(root, chat.id);
                  }
                  throw Error("accepted; acknowledgement lost");
                }
                if (method === "thread/turns/list")
                  return {
                    data: [
                      {
                        id: "turn",
                        items: [
                          {
                            id: "message",
                            type: "userMessage",
                            content: [{ text: "retained initial message" }],
                          },
                        ],
                      },
                    ],
                    nextCursor: null,
                  };
                return {};
              },
              respond() {},
              close() {
                drop(Error("closed"));
              },
            });
      const service = new ChatService(store, connector);
      let restart: ChatService | undefined;
      try {
        const sending = service.send(
          root,
          chat.id,
          outcome === "live"
            ? "Reply exactly WORKTREE_OK. Do not use tools or change files."
            : "retained initial message",
          async () => {},
          (snapshot) => store.prepareWorktree(snapshot, project, managed),
        );
        if (outcome === "live") {
          await sending;
          const deadline = Date.now() + 60000;
          while (service.snapshot(root, chat.id).busy && Date.now() < deadline)
            await new Promise((r) => setTimeout(r, 100));
          expect(service.snapshot(root, chat.id).busy).toBe(false);
          expect(
            service
              .snapshot(root, chat.id)
              .items.some((i) => i.type === "agentMessage" && i.text.includes("WORKTREE_OK")),
          ).toBe(true);
        } else await expect(sending).rejects.toThrow();
        const saved = await store.get(root, chat.id);
        expect(saved.worktree?.reservation?.root).toBe(saved.checkout);
        expect(project.checkouts()).toContain(saved.checkout);
        await service.shutdown();
        restart = new ChatService(new Chats(file), connector);
        if (outcome === "creation-uncertain")
          await expect(restart.open(root, chat.id)).rejects.toThrow("uncertain");
        else await restart.open(root, chat.id);
        expect((await new Chats(file).get(root, chat.id)).checkout).toBe(saved.checkout);
        if (outcome.startsWith("cancelled-")) {
          expect(saved.threadId).toBe("known");
          expect(saved.draft).toBe("retained initial message");
          expect(starts).toBe(1);
          expect(accepted).toBe(outcome === "cancelled-creation" ? 0 : 1);
          expect((await new Chats(file).get(root, chat.id)).worktree).toEqual(saved.worktree);
        }
        if (outcome === "accepted-lost-ack") {
          expect(accepted).toBe(1);
          expect(starts).toBe(1);
          expect(restart.snapshot(root, chat.id).items[0].text).toBe("retained initial message");
        }
        if (outcome === "live") {
          expect(
            restart.snapshot(root, chat.id).items.filter((i) => i.type === "userMessage"),
          ).toHaveLength(1);
          expect(restart.snapshot(root, chat.id).settings.model).toBeTruthy();
        }
      } finally {
        await service.shutdown();
        await restart?.shutdown();
        project.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    90000,
  );
}
