import { test, expect } from "vite-plus/test";
import { mkdtemp, realpath, mkdir, rename, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";

for (const scratch of [false, true]) {
  test(`unavailable ${scratch ? "scratch" : "project"} retains active Stop, history and identity through restart`, async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-recovery-")));
    const root = join(dir, "checkout"),
      file = join(dir, "chats.json");
    await mkdir(root);
    const store = new Chats(file);
    const project = scratch ? null : root;
    const chat = await store.createDraft(project, scratch ? "" : root);
    let turns = 0,
      interrupts = 0,
      connections = 0;
    const connector: ConstructorParameters<typeof ChatService>[1] = async (cwd, emit, drop) => {
      connections++;
      return {
        async request(method: string, params: any) {
          if (method === "account/read") return { account: {} };
          if (method === "thread/start" || method === "thread/resume")
            return {
              thread: { id: params.threadId ?? chat.id },
              cwd,
              model: "fixture",
              sandbox: {},
              approvalPolicy: "on-request",
            };
          if (method === "turn/start") {
            turns++;
            emit({ method: "turn/started", params: { threadId: chat.id, turn: { id: "turn" } } });
            emit({
              id: 7,
              method: "item/commandExecution/requestApproval",
              params: { threadId: chat.id, turnId: "turn" },
            });
            return { turn: { id: "turn" } };
          }
          if (method === "turn/interrupt") {
            interrupts++;
            emit({ method: "turn/completed", params: { threadId: chat.id, turn: { id: "turn" } } });
          }
          if (method === "thread/turns/list")
            return {
              data: [
                {
                  id: "turn",
                  items: [{ id: "reply", type: "agentMessage", text: "retained history" }],
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
      };
    };
    const service = new ChatService(store, connector);
    let restart: ChatService | undefined;
    try {
      await service.send(project, chat.id, "first");
      await store.draft(project, chat.id, "keep unsent");
      const saved = await store.get(project, chat.id),
        path = saved.checkout;
      const token = service.snapshot(project, chat.id).requests[0].token;
      await rename(path, path + "-away");
      expect(await service.inspect(project, chat.id)).toMatchObject({
        busy: true,
        connected: true,
        turnId: "turn",
      });
      expect((await service.inspect(project, chat.id)).contextError).toContain(path);
      await service.stop(project, chat.id);
      expect(interrupts).toBe(1);
      await service.disconnect(project, chat.id);
      await expect(service.answer(project, chat.id, token, { decision: "accept" })).rejects.toThrow(
        "Stale",
      );
      restart = new ChatService(new Chats(file), connector);
      await expect(restart.open(project, chat.id)).rejects.toThrow(path);
      await mkdir(path);
      await expect(restart.open(project, chat.id)).rejects.toThrow(path);
      expect(connections).toBe(1);
      await rm(path, { recursive: true });
      await rename(path + "-away", path);
      await chmod(path, 0);
      await expect(restart.open(project, chat.id)).rejects.toThrow(path);
      await chmod(path, 0o700);
      await restart.open(project, chat.id);
      expect(restart.snapshot(project, chat.id).items[0].text).toBe("retained history");
      expect(restart.snapshot(project, chat.id).busy).toBe(false);
      expect(turns).toBe(1);
      expect(await store.get(project, chat.id)).toMatchObject({
        ...saved,
        draft: "keep unsent",
        availabilityError: null,
      });
    } finally {
      service.close();
      restart?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
