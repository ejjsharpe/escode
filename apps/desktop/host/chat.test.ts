import { test, expect } from "vite-plus/test";
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
  const service = new ChatService(new Chats(join(dir, "chats.json")), async (_cwd, emit, drop) => {
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
      close() {
        drop(Error("disconnected"));
      },
    };
  });
  try {
    const a = await service.create(dir),
      b = await service.create(dir);
    await service.open(dir, a.id);
    await service.open(dir, b.id);
    await service.send(dir, a.id, "hello");
    await expect(service.send(dir, a.id, "duplicate")).rejects.toThrow("active turn");
    peers[0].emit({
      id: 77,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-0", turnId: "turn-1", itemId: "item-1", command: "touch proof" },
    });
    const request = service.snapshot(dir, a.id).requests[0];
    await expect(service.answer(dir, b.id, request.token, "accept")).rejects.toThrow("Stale");
    await service.answer(dir, a.id, request.token, "decline");
    expect(peers[0].replies).toEqual([{ id: 77, result: { decision: "decline" } }]);
    peers[0].emit({
      id: 78,
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-0", turnId: "turn-1", itemId: "item-2" },
    });
    const stale = service.snapshot(dir, a.id).requests[0];
    await service.stop(dir, a.id);
    expect(peers[0].calls.at(-1)).toBe("turn/interrupt");
    expect(peers[1].calls).not.toContain("turn/interrupt");
    peers[0].drop(Error("connection lost"));
    expect(service.snapshot(dir, a.id).requests).toEqual([]);
    await service.open(dir, a.id);
    await expect(service.answer(dir, a.id, stale.token, "accept")).rejects.toThrow("Stale");
    expect(peers[2].calls).not.toContain("turn/start");
  } finally {
    service.close();
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
        if (method === "thread/start")
          return {
            thread: { id: "thread" },
            cwd: dir,
            model: "actual",
            reasoningEffort: null,
            approvalPolicy: "never",
            sandbox: { type: "readOnly" },
          };
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
    expect(service.snapshot(dir, c.id).settings.model).toBe("fallback");
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
    service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
