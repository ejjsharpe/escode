import { test, expect, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chats } from "./chat";
test("saved chats and drafts stay attached to the project checkout after reopening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-chat-"));
  try {
    const chats = new Chats(join(dir, "chats.json"));
    const chat = await chats.create(dir);
    await chats.draft(dir, chat.id, "unfinished");
    const reopened = new Chats(join(dir, "chats.json"));
    expect(await reopened.list(dir)).toEqual([{ ...chat, draft: "unfinished" }]);
    expect(await reopened.list("/another/project")).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { ChatService } from "./chat-service";
import type { WireMessage } from "./tools";
test("turns, approvals and Stop stay scoped; reconnect invalidates old callbacks without resending", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-routing-"));
  const peers: {
    emit: (event: WireMessage) => void;
    drop: (error: Error) => void;
    calls: string[];
    replies: unknown[];
  }[] = [];
  const store = new Chats(join(dir, "chats.json"));
  const service = new ChatService(store, async (_cwd, emit, drop) => {
    const peer = { emit, drop, calls: [] as string[], replies: [] as unknown[] };
    peers.push(peer);
    return {
      async request(method: string, params: any) {
        peer.calls.push(method);
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "thread/start" || method === "thread/resume")
          return {
            thread: { id: params.threadId ?? "thread-" + peers.indexOf(peer) },
            cwd: dir,
            model: "effective-model",
            reasoningEffort: "high",
            approvalPolicy: "on-request",
            sandbox: { type: "workspaceWrite" },
          };
        if (method === "turn/start") return { turn: { id: "turn-1" } };
        if (method === "thread/turns/list") return { data: [], nextCursor: null };
        return {};
      },
      respond(id, result) {
        peer.replies.push({ id, result });
      },
      close() {},

    };
  });
  try {
    const a = await service.create(dir),
      b = await service.create(dir);
    await service.open(dir, a.id);
    await service.open(dir, b.id);
    await service.send(dir, a.id, "hello");
    expect(service.checkoutActive(dir, a.id)).toBe(true);
    expect(service.checkoutActive(dir, b.id)).toBe(false);
    await expect(service.send(dir, a.id, "duplicate")).rejects.toThrow("active turn");
    peers[0].emit({
      id: 77,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-0", turnId: "turn-1", itemId: "item-1", command: "touch proof" },
    });
    const request = service.snapshot(dir, a.id).requests[0];
    await expect(service.answer(dir, b.id, request.token, "accept")).rejects.toThrow("Stale");
    await service.answer(dir, a.id, request.token, "decline");
    await expect(service.answer(dir, a.id, request.token, "accept")).rejects.toThrow("Stale");
    await expect(service.stop(dir, a.id, "old-session")).rejects.toThrow("Stale Stop");
    expect(peers[0].calls).not.toContain("turn/interrupt");
    expect(peers[0].replies).toEqual([{ id: 77, result: { decision: "decline" } }]);
    peers[0].emit({
      id: 78,
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-0", turnId: "turn-1", itemId: "item-2" },
    });
    for (let n = 0; n < 31; n++) peers[0].emit({ id: 100 + n, method: "item/fileChange/requestApproval", params: { threadId: "thread-0", turnId: "turn-1", itemId: String(n) } });
    const reused = service.snapshot(dir, a.id).requests[0];
    peers[0].emit({ id: 78, method: "item/fileChange/requestApproval", params: { threadId: "thread-0", turnId: "turn-1", itemId: "replacement" } });
    await expect(service.answer(dir, a.id, reused.token, "accept")).rejects.toThrow("Stale");
    const stale = service.snapshot(dir, a.id).requests[0];
    await service.stop(dir, a.id);
    expect(peers[0].calls.at(-1)).toBe("turn/interrupt");
    expect(peers[1].calls).not.toContain("turn/interrupt");
    const stoppedTarget = service.snapshot(dir, a.id).controlTarget;
    peers[0].emit({ method: "turn/started", params: { threadId: "thread-0", turn: { id: "turn-1" } } });
    peers[0].emit({
      id: 200,
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-0", turnId: "turn-1", itemId: "late-approval" },
    });
    expect(service.snapshot(dir, a.id)).toMatchObject({ busy: true, turnId: "turn-1", requests: [], controlTarget: stoppedTarget });
    await expect(service.answer(dir, a.id, stale.token, "accept")).rejects.toThrow("Stale");
    peers[0].drop(Error("connection lost"));
    expect(service.snapshot(dir, a.id).requests).toEqual([]);
    await service.open(dir, a.id);
    await expect(service.answer(dir, a.id, stale.token, "accept")).rejects.toThrow("Stale");
    expect(peers[2].calls).not.toContain("turn/start");
    await service.draft(dir, a.id, "retained draft");
    await service.markUnavailable(dir, a.id);
    await expect(service.open(dir, a.id)).rejects.toThrow("Checkout was removed");
    await expect(service.send(dir, a.id, "no")).rejects.toThrow("Checkout was removed");
    const beforeDisconnect = service.snapshot(dir, b.id);
    service.disconnect(dir, b.id);
    expect(service.snapshot(dir, b.id)).toMatchObject({ connected: false, busy: false, turnId: null, requests: [] });
    expect(service.snapshot(dir, b.id).controlTarget).not.toBe(beforeDisconnect.controlTarget);
    peers[1].emit({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "late-turn" } } });
    peers[1].drop(Error("late disconnect"));
    expect(service.snapshot(dir, b.id).busy).toBe(false);
    await service.open(dir, b.id);
    expect(peers[3].calls).not.toContain("turn/start");
    const failIntent = vi.spyOn(store, "update").mockRejectedValueOnce(Error("disk full"));
    await expect(service.markUnavailable(dir, b.id)).rejects.toThrow("disk full");
    expect(service.snapshot(dir, b.id).connected).toBe(false);
    failIntent.mockRestore();
    expect((await service.list(dir)).find((c) => c.id === a.id)).toMatchObject({
      removed: true,
      draft: "retained draft",
      checkout: dir,
    });
  } finally {
    await service.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("setup failures retain drafts; exact input requests cannot answer another turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-failure-"));
  const store = new Chats(join(dir, "chats.json"));
  let authenticated = false;
  let emit: (event: WireMessage) => void = () => {};
  let reply: unknown;
  const service = new ChatService(store, async (_cwd, receive, drop) => {
    emit = receive;
    return {
      async request(method: string) {
        if (method === "account/read") return { account: authenticated ? {} : null };
        if (method === "thread/start" || method === "thread/resume")
          return {
            thread: { id: "thread" },
            cwd: dir,
            model: "actual",
            reasoningEffort: null,
            approvalPolicy: "never",
            sandbox: { type: "readOnly" },
          };
        if (method === "thread/turns/list") return { data: [], nextCursor: null };
        if (method === "turn/start") return { turn: { id: "turn" } };
      },
      respond(_id, value) {
        reply = value;
      },
      close() {
        drop(Error("lost"));
      },
    };
  });
  try {
    const c = await service.create(dir);
    await service.draft(dir, c.id, "keep me");
    await expect(service.open(dir, c.id)).rejects.toThrow("codex login");
    expect((await service.list(dir))[0].draft).toBe("keep me");
    authenticated = true;
    await service.open(dir, c.id);
    service.disconnect(dir, c.id);
    await service.open(dir, c.id);
    await service.send(dir, c.id, "explicit");
    emit({
      id: 12,
      method: "item/tool/requestUserInput",
      params: { threadId: "other", turnId: "turn", questions: [] },
    });
    expect(service.snapshot(dir, c.id).requests).toHaveLength(0);
    emit({
      id: 13,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread",
        turnId: "turn",
        questions: [{ id: "choice", question: "Which?" }],
      },
    });
    emit({
      id: 14,
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread", turnId: "turn", itemId: "file" },
    });
    const resolved = service
      .snapshot(dir, c.id)
      .requests.find((r) => r.method === "item/fileChange/requestApproval")!;
    emit({ method: "serverRequest/resolved", params: { threadId: "thread", requestId: 14 } });
    await expect(service.answer(dir, c.id, resolved.token, "accept")).rejects.toThrow("Stale");
    emit({
      method: "model/rerouted",
      params: { threadId: "thread", turnId: "turn", toModel: "fallback" },
    });
    expect(service.snapshot(dir, c.id).settings?.model).toBe("fallback");
    const request = service.snapshot(dir, c.id).requests[0];
    await expect(service.answer(dir, c.id, request.token, {})).rejects.toThrow("Answer each");
    await service.answer(dir, c.id, request.token, { choice: "first" });
    expect(reply).toEqual({ answers: { choice: { answers: ["first"] } } });
    await expect(service.answer(dir, c.id, request.token, { choice: "second" })).rejects.toThrow(
      "Stale",
    );
    emit({
      method: "turn/completed",
      params: { threadId: "thread", turn: { id: "turn", status: "interrupted" } },
    });
    expect(service.snapshot(dir, c.id).busy).toBe(false);
    emit({
      id: 15,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "thread",
        turnId: null,
        serverName: "calendar",
        mode: "form",
        message: "Choose a name",
        requestedSchema: { type: "object", properties: { name: { type: "string" } } },
      },
    });
    const elicitation = service.snapshot(dir, c.id).requests[0];
    expect(elicitation?.method).toBe("mcpServer/elicitation/request");
    await service.answer(dir, c.id, elicitation.token, {
      action: "accept",
      content: { name: "Elliot" },
    });
    expect(reply).toEqual({ action: "accept", content: { name: "Elliot" }, _meta: null });
    expect((await service.list(dir))[0].draft).toBe("");
  } finally {
    await service.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loss of the protocol output stops the chat even if its process stays alive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-pipe-"));
  const { writeFile } = await import("node:fs/promises");
  const { connectCodex } = await import("./tools");
  const executable = join(dir, "codex.mjs");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { createInterface } from "node:readline";
if (process.argv.includes("--version")) { console.log("codex-cli 0.165.0"); process.exit(0); }
setInterval(() => {}, 1000);
createInterface({input: process.stdin}).on("line", line => {
 const m=JSON.parse(line); if (!m.id) return;
 let result={};
 if(m.method==="initialize") result={userAgent:"codex/0.165.0"};
 if(m.method==="account/read") result={account:{type:"chatgpt"}};
 if(m.method==="thread/start") result={thread:{id:"pipe-thread"},cwd:m.params.cwd,model:"actual",approvalPolicy:"on-request",sandbox:{type:"readOnly"}};
 if(m.method==="turn/start") {result={turn:{id:"pipe-turn"}}; setTimeout(()=>process.stdout.end(),20);}
 process.stdout.write(JSON.stringify({id:m.id,result})+"\\n");
});


`,
  );
  const service = new ChatService(new Chats(join(dir, "chats.json")), (cwd, receive, drop) =>
    connectCodex(cwd, receive, drop, executable),
  );
  try {
    const c = await service.create(dir);
    await service.open(dir, c.id);
    await service.send(dir, c.id, "hello");
    await expect.poll(() => service.snapshot(dir, c.id).connected, { timeout: 1000 }).toBe(false);
    expect(service.snapshot(dir, c.id).busy).toBe(false);
  } finally {
    await service.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test.each(["missing", "replaced"])(
  "a %s checkout blocks new turns without losing history or drafts",
  async (kind) => {
    const { mkdir, rename } = await import("node:fs/promises");
    const dir = await mkdtemp(join(tmpdir(), "escode-checkout-loss-"));
    const root = join(dir, "checkout");
    await mkdir(root);
    let sends = 0;
    const service = new ChatService(
      new Chats(join(dir, "chats.json")),
      async (cwd, receive, drop) => ({
        async request(method: string) {
          if (method === "account/read") return { account: {} };
          if (method === "thread/start" || method === "thread/resume")
            return {
              thread: { id: cwd },
              cwd,
              model: "fixture",
              approvalPolicy: "on-request",
              sandbox: { type: "readOnly" },
            };
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
          if (method === "turn/start") {
            sends++;
            receive({ method: "turn/started", params: { threadId: cwd, turn: { id: "turn" } } });
            receive({
              method: "item/completed",
              params: {
                threadId: cwd,
                turnId: "turn",
                item: { id: "reply", type: "agentMessage", text: "retained history" },
              },
            });
            receive({ method: "turn/completed", params: { threadId: cwd, turn: { id: "turn" } } });
            return { turn: { id: "turn" } };
          }
        },
        respond() {},
        close() {
          drop(Error("connection closed"));
        },
      }),
    );
    try {
      const chat = await service.create(dir, root);
      await service.open(dir, chat.id);
      await service.send(dir, chat.id, "first message");
      await service.draft(dir, chat.id, "keep this draft");
      await rename(root, root + "-original");
      if (kind === "replaced") await mkdir(root);
      await expect(service.send(dir, chat.id, "keep this draft")).rejects.toThrow(
        /checkout.*unavailable|checkout.*changed/i,
      );
      expect(sends).toBe(1);
      await expect.poll(() => service.snapshot(dir, chat.id).items[0]?.text).toBe("retained history");
      expect((await service.list(dir))[0].draft).toBe("keep this draft");
      const other = await service.create(dir);
      await service.open(dir, other.id);
      await service.send(dir, other.id, "other checkout still works");
      expect(sends).toBe(2);
      if (kind === "replaced") await rm(root, { recursive: true });
      await rename(root + "-original", root);
      await service.open(dir, chat.id);
      expect(sends).toBe(2);
      await expect.poll(() => service.snapshot(dir, chat.id).items[0]?.text).toBe("retained history");
      expect((await service.list(dir))[0].draft).toBe("keep this draft");
    } finally {
      await service.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.env.ESCODE_LIVE_CHAT !== "1")(
  "live Codex chats progress across shared/separate checkouts, projects and scratch; stop stays local",
  async () => {
    const { execFileSync } = await import("node:child_process");
    const { realpath } = await import("node:fs/promises");
    const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-live-concurrency-")));
    const a = join(dir, "alpha"),
      b = join(dir, "beta");
    let project: import("./project").Project | undefined;
    const store = new Chats(join(dir, "chats.json"));
    const service = new ChatService(store);
    try {
      for (const root of [a, b]) {
        execFileSync("git", ["init", root]);
        execFileSync("git", [
          "-C",
          root,
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "--allow-empty",
          "-m",
          "initial",
        ]);
      }
      const { Project } = await import("./project");
      project = await Project.open(a);
      const base = project.worktreeOptions().bases.find((b) => b.ref === "HEAD")!;
      const created = project.createWorktree(join(dir, "managed"), base.ref, base.commit);
      expect(created.error).toBeNull();
      const worktree = created.root;
      const chats = await Promise.all([
        service.create(a),
        service.create(a),
        service.create(a, worktree),
        service.create(b),
        store.createDraft(null, ""),
      ]);
      await Promise.all(chats.map((c) => service.open(c.project, c.id)));
      await Promise.all(
        chats.map((c, i) =>
          service.send(
            c.project,
            c.id,
            i === 0
              ? "Run sleep 30, then reply WAITED. Do not change any files."
              : `Reply with exactly ESCODE_CONCURRENT_${i}. Do not use tools or change files.`,
          ),
        ),
      );
      expect(chats.some((c) => service.snapshot(c.project, c.id).busy)).toBe(true);
      await expect
        .poll(
          () =>
            service.snapshot(a, chats[0].id).items.some((item) => item.type === "commandExecution"),
          { timeout: 45000 },
        )
        .toBe(true);
      await service.stop(a, chats[0].id);
      await expect
        .poll(() => service.snapshot(a, chats[0].id).busy, { timeout: 30000 })
        .toBe(false);
      for (const [i, c] of chats.entries()) {
        if (!i) continue;
        await expect
          .poll(() => service.snapshot(c.project, c.id).busy, { timeout: 90000 })
          .toBe(false);
        const snapshot = service.snapshot(c.project, c.id);
        expect(snapshot.error).toBeNull();
        expect(
          snapshot.items
            .filter((item) => item.type === "agentMessage")
            .map((item) => item.text)
            .join(""),
        ).toContain(`ESCODE_CONCURRENT_${i}`);
      }
    } finally {
      await service.shutdown();
      project?.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  150000,
);

test("legacy worktree chats migrate without changing checkout, thread, draft or identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-migration-"));
  try {
    const store = new Chats(join(dir, "chats.json"));
    const worktree = join(dir, "worktree"),
      primary = join(dir, "primary");
    const legacy = await store.create(worktree);
    await store.update(worktree, legacy.id, {
      threadId: "saved-thread",
      hasSent: true,
      draft: "keep draft",
    });
    await store.migrate(primary, [primary, worktree]);
    expect(await store.list(primary)).toEqual([
      { ...legacy, project: primary, threadId: "saved-thread", hasSent: true, draft: "keep draft" },
    ]);
    expect(await store.list(worktree)).toEqual([]);
    await store.migrate(primary, [primary, worktree]);
    expect(await store.list(primary)).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unsupported chat association versions retain their exact bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "escode-chat-version-"));
  try {
    const file = join(directory, "host-chats-v1.json");
    const bytes = JSON.stringify({ version: 2, chats: [] });
    const { writeFile, readFile } = await import("node:fs/promises");
    await writeFile(file, bytes);
    const store = new Chats(file);
    await expect(store.all()).rejects.toThrow("Unsupported chat association store");
    await expect(store.createDraft(null, "")).rejects.toThrow("Unsupported chat association store");
    expect(await readFile(file, "utf8")).toBe(bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Stop cancels captured preparation without deleting its saved draft or dispatching a turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-cancel-preparation-"));
  const store = new Chats(join(dir, "chats.json"));
  const service = new ChatService(store, async () => { throw Error("provider must not start"); });
  try {
    const chat = await service.create(dir);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const sending = service.send(dir, chat.id, "retained", async () => { entered(); await gate; });
    const failed = expect(sending).rejects.toThrow("not submitted");
    await ready;
    const snapshot = service.snapshot(dir, chat.id);
    expect(snapshot.preparing).toBe(true);
    await service.stop(dir, chat.id, snapshot.controlTarget);
    release();
    await failed;
    expect((await store.get(dir, chat.id)).draft).toBe("retained");
    expect(service.snapshot(dir, chat.id).busy).toBe(false);
  } finally { await service.shutdown(); await rm(dir, { recursive: true, force: true }); }
});
