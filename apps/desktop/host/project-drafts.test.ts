import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";

test("text-bearing drafts change context without allocating providers, overwriting drafts or changing creation order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-drafts-"));
  try {
    const file = join(dir, "chats.json"),
      store = new Chats(file);
    const a = await store.createDraft("alpha", dir);
    expect((await store.createDraft("alpha", dir)).id).toBe(a.id);
    await store.draft("alpha", a.id, "keep my prompt");
    const b = await store.createDraft("alpha", dir);
    let connections = 0;
    const service = new ChatService(store, async () => {
      connections++;
      throw Error("unexpected connection");
    });
    await service.open("alpha", a.id);
    await service.context("alpha", a.id, "beta", dir);
    const restored = new Chats(file);
    expect(await restored.get("beta", a.id)).toMatchObject({
      ...a,
      project: "beta",
      draft: "keep my prompt",
    });
    expect(await restored.get("alpha", b.id)).toMatchObject({ draft: "" });
    expect(connections).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const failure of [
  "preparation",
  "creation-rejected",
  "creation-uncertain",
  "accepted-lost-ack",
  "turn-rejected",
  "none",
] as const) {
  test(`first Send retains identity and never replays on Retry/restart: ${failure}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "escode-first-send-"));
    const cwd = join(dir, "checkout");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(cwd);
    const store = new Chats(join(dir, "chats.json"));
    const chat = await store.createDraft(dir, cwd);
    await store.draft(dir, chat.id, "initial prompt");
    let starts = 0,
      accepted = 0,
      connects = 0;
    const connector: ConstructorParameters<typeof ChatService>[1] = async (_cwd, _emit, drop) => {
      connects++;
      return {
        async request(method: string, params: any) {
          if (method === "account/read") return { account: {} };
          if (method === "thread/start") {
            starts++;
            if (failure.startsWith("creation"))
              throw Object.assign(Error("creation failed"), {
                rejected: failure === "creation-rejected",
              });
          }
          if (method === "thread/start" || method === "thread/resume")
            return {
              thread: { id: params.threadId ?? "known-thread" },
              cwd,
              model: "fixture",
              sandbox: {},
              approvalPolicy: "on-request",
            };
          if (method === "turn/start") {
            if (failure === "turn-rejected")
              throw Object.assign(Error("turn rejected"), { rejected: true });
            accepted++;
            if (failure === "accepted-lost-ack") throw Error("ack lost");
            return { turn: { id: "turn" } };
          }
          if (method === "thread/turns/list")
            return {
              data: accepted
                ? [
                    {
                      id: "turn",
                      items: [
                        { id: "user", type: "userMessage", content: [{ text: "initial prompt" }] },
                      ],
                    },
                  ]
                : [],
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
    try {
      await service.open(dir, chat.id);
      expect(connects).toBe(0);
      if (failure === "preparation") await rename(cwd, cwd + "-away");
      if (failure === "none") await service.send(dir, chat.id, "initial prompt");
      else await expect(service.send(dir, chat.id, "initial prompt")).rejects.toThrow();
      const saved = await store.get(dir, chat.id);
      expect(saved.id).toBe(chat.id);
      expect(saved.createdAt).toBe(chat.createdAt);
      expect(saved.checkout).toBe(cwd);
      expect(saved.draft).toBe(failure === "none" ? "" : "initial prompt");
      if (failure === "accepted-lost-ack") {
        await expect(service.send(dir, chat.id, "initial prompt")).rejects.toThrow(
          "Retry connection",
        );
        expect((await store.get(dir, chat.id)).initialSend).toBe("uncertain");
      }
      service.close();
      if (failure === "preparation") await rename(cwd + "-away", cwd);
      const restart = new ChatService(new Chats(join(dir, "chats.json")), connector);
      if (failure === "creation-uncertain")
        await expect(restart.open(dir, chat.id)).rejects.toThrow("uncertain");
      else await restart.open(dir, chat.id);
      expect(accepted).toBe(failure === "none" || failure === "accepted-lost-ack" ? 1 : 0);
      expect(starts).toBe(failure === "preparation" ? 0 : 1);
      if (failure === "accepted-lost-ack") {
        expect(restart.snapshot(dir, chat.id).items[0].text).toBe("initial prompt");
        expect(saved.initialSend).toBe("uncertain");
        await expect(restart.context(dir, chat.id, "other", cwd)).rejects.toThrow("unsent");
      }
      restart.close();
    } finally {
      service.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("legacy unsent provider identity is resumed rather than replaced", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-legacy-unsent-"));
  const store = new Chats(join(dir, "chats.json"));
  const chat = await store.create(dir);
  await store.update(dir, chat.id, { threadId: "old-unsent-thread", draft: "keep" });
  const calls: string[] = [];
  const service = new ChatService(store, async () => ({
    async request(method: string, params: any) {
      calls.push(method);
      if (method === "account/read") return { account: {} };
      if (method === "thread/resume")
        return {
          thread: { id: params.threadId },
          cwd: dir,
          model: "fixture",
          sandbox: {},
          approvalPolicy: "on-request",
        };
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      throw Error("Unexpected replacement or turn");
    },
    respond() {},
    close() {},
  }));
  try {
    await service.open(dir, chat.id);
    expect(calls).toContain("thread/resume");
    expect(calls).not.toContain("thread/start");
    expect(await store.get(dir, chat.id)).toMatchObject({
      threadId: "old-unsent-thread",
      draft: "keep",
      checkout: dir,
    });
  } finally {
    service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("context changes exclude setup and stale read/control calls cannot recreate the old session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-context-lock-"));
  const store = new Chats(join(dir, "chats.json"));
  const chat = await store.createDraft("alpha", dir);
  const service = new ChatService(store, async () => {
    throw Error("Drafts must not connect");
  });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const context = store.context.bind(store);
  store.context = async (...args) => {
    entered();
    await gate;
    return context(...args);
  };
  try {
    await service.open("alpha", chat.id);
    const moving = service.context("alpha", chat.id, "beta", dir);
    await reached;
    expect(service.checkoutActive("alpha", chat.id)).toBe(true);
    expect(service.snapshot("alpha", chat.id).connected).toBe(false);
    await expect(service.open("alpha", chat.id)).rejects.toThrow("context change");
    await expect(service.send("alpha", chat.id, "no")).rejects.toThrow("context change");
    expect(() => service.disconnect("alpha", chat.id)).toThrow("active work");
    await expect(service.markUnavailable("alpha", chat.id)).rejects.toThrow("context change");
    release();
    await moving;
    // These can arrive from a caller that passed an earlier catalogue/list check.
    service.snapshot("alpha", chat.id);
    service.disconnect("alpha", chat.id);
    await expect(service.stop("alpha", chat.id)).rejects.toThrow("Unknown chat");
    await expect(service.answer("alpha", chat.id, "stale", {})).rejects.toThrow("Unknown chat");
    await expect(service.open("alpha", chat.id)).rejects.toThrow("Unknown chat");
    await expect(service.send("alpha", chat.id, "stale")).rejects.toThrow("Unknown chat");
    await expect(service.markUnavailable("alpha", chat.id)).rejects.toThrow("Unknown chat");
    await service.open("beta", chat.id);
    expect(service.snapshot("beta", chat.id).connected).toBe(false);
  } finally {
    release();
    service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

for (const stage of ["authorization", "preparation"] as const) {
  test(`shutdown during ${stage} cannot launch a provider after the guarded Send resumes`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "escode-authorize-shutdown-"));
    const store = new Chats(join(dir, "chats.json"));
    const chat = await store.createDraft(dir, dir);
    let connections = 0,
      release!: () => void,
      entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const update = store.update.bind(store);
    store.update = async (...args) => {
      if (stage === "preparation" && args[2].initialSend === "preparing") {
        entered();
        await gate;
      }
      return update(...args);
    };
    const service = new ChatService(store, async () => {
      connections++;
      throw Error("Unexpected provider");
    });
    try {
      const sending = service
        .send(dir, chat.id, "keep prompt", async (authorized) => {
          expect(Object.isFrozen(authorized)).toBe(true);
          await expect(service.context(dir, chat.id, "other", dir)).rejects.toThrow(
            "context change",
          );
          await expect(service.open(dir, chat.id)).rejects.toThrow("context change");
          await expect(service.send(dir, chat.id, "duplicate")).rejects.toThrow("active turn");
          if (stage === "authorization") {
            entered();
            await gate;
          }
        })
        .then(
          () => "unexpected success",
          (e: Error) => e.message,
        );
      await reached;
      await service.shutdown();
      release();
      expect(await sending).toContain("disconnected during");
      expect(connections).toBe(0);
      expect((await store.get(dir, chat.id)).threadId).toBe(null);
    } finally {
      release();
      service.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
