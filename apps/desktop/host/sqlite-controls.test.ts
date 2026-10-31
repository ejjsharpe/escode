import { test, expect } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";
import { startHost } from "@escode/host";
import { createHostClient } from "@escode/client-runtime";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
import { DurableSend } from "./durable-send";
import type { WireMessage } from "./tools";

test("authenticated SQLite controls fail closed, retain outcomes and reject stale live targets", async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
  const dir = await mkdtemp(join(tmpdir(), "escode-controls-"));
  const store = new Chats(join(dir, "chats"));
  let emit!: (message: WireMessage) => void;
  const replies: unknown[] = [];
  let stops = 0;
  const service = new ChatService(store, async (_cwd, notify) => {
    emit = notify;
    return {
      async request(method: string, params: any) {
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "thread/start" || method === "thread/resume") return { thread: { id: params.threadId ?? "provider" }, cwd: dir, model: "fixture", approvalPolicy: "on-request", sandbox: { type: "workspaceWrite" } };
        if (method === "turn/start") return { turn: { id: "turn" } };
        if (method === "turn/interrupt") stops++;
        return {};
      }, respond(id, answer) { replies.push({ id, answer }); }, close() {},
    };
  });
  const db = store.database;
  const sends = new DurableSend(db);
  const host = await startHost({ ...await db.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
    sendMessage: command => sends.execute(command, async () => {
      const control = command.control!;
      if (control.operation === "stop") await service.stop(command.project, command.id, control.target);
      else await service.answer(command.project, command.id, control.token, control.answer);
    }), sendStatus: id => sends.receipt(id) });
  let client = createHostClient(async () => host.bootstrap());
  const fault = new DatabaseSync(join(dir, "chats.sqlite-state-v1/state.sqlite"));
  try {
    const chat = await service.create(dir);
    await service.open(dir, chat.id);
    await service.send(dir, chat.id, "start");
    const approval = (wireId = 77) => {
      emit({ id: wireId, method: "item/commandExecution/requestApproval", params: { threadId: "provider", turnId: "turn", itemId: "item" } });
      return service.snapshot(dir, chat.id).requests[0].token;
    };
    const command = { commandId: "approval", admissionEpoch: sends.admissionEpoch, project: dir, id: chat.id, expected: "", text: "",
      control: { operation: "answer" as const, target: "", token: approval(), answer: "accept" } };
    const denied = new WebSocket(host.bootstrap().url.replace(/ticket=[^&]+/, "ticket=invalid"), { origin: "null" });
    await new Promise<void>((resolve, reject) => { denied.once("error", () => resolve()); denied.once("open", () => { denied.close(); reject(Error("Invalid authentication accepted")); }); });
    await expect(client.sendMessage({ ...command, commandId: "wrong-project", project: "/unauthorized" })).rejects.toThrow();
    expect(replies).toEqual([]);
    fault.exec("CREATE TRIGGER fail_intent BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT, 'intent failure'); END");
    await expect(client.sendMessage(command)).rejects.toThrow();
    expect(replies).toEqual([]);
    fault.exec("DROP TRIGGER fail_intent");
    expect((await client.sendMessage(command)).status).toBe("accepted");
    await client.close(); client = createHostClient(async () => host.bootstrap());
    expect((await client.sendMessage(command)).status).toBe("accepted");
    await expect(client.sendMessage({ ...command, control: { ...command.control, answer: "decline" } })).rejects.toThrow();
    expect(replies).toEqual([{ id: 77, answer: { decision: "accept" } }]);
    const stale = { ...command, commandId: "stale" };
    expect((await client.sendMessage(stale)).status).toBe("rejected");
    emit({ id: 78, method: "item/tool/requestUserInput", params: { threadId: "provider", turnId: "turn", itemId: "input", questions: [{ id: "choice", header: "Choice", question: "Choose" }] } });
    const reply = { ...command, commandId: "input", control: { ...command.control, token: service.snapshot(dir, chat.id).requests[0].token, answer: { choice: "first" } } };
    fault.exec("CREATE TRIGGER fail_reply BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT, 'reply failure'); END");
    await expect(client.sendMessage(reply)).rejects.toThrow();
    expect(replies).toHaveLength(1);
    fault.exec("DROP TRIGGER fail_reply");
    expect((await client.sendMessage(reply)).status).toBe("accepted");
    await client.sendMessage(reply);
    expect(replies).toEqual([{ id: 77, answer: { decision: "accept" } }, { id: 78, answer: { answers: { choice: { answers: ["first"] } } } }]);
    const replacedToken = approval(79);
    emit({ id: 79, method: "item/commandExecution/requestApproval", params: { threadId: "provider", turnId: "turn", itemId: "replacement" } });
    expect((await client.sendMessage({ ...command, commandId: "superseded", control: { ...command.control, token: replacedToken } })).status).toBe("rejected");
    expect(replies).toHaveLength(2);
    const stop = { ...command, commandId: "stop", control: { operation: "stop" as const, target: service.snapshot(dir, chat.id).controlTarget!, token: "", answer: null } };
    expect((await client.sendMessage({ ...stop, commandId: "old-stop", control: { ...stop.control, target: "expired" } })).status).toBe("rejected");
    expect(stops).toBe(0);
    fault.exec("CREATE TRIGGER fail_stop BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT, 'stop failure'); END");
    await expect(client.sendMessage(stop)).rejects.toThrow();
    expect(stops).toBe(0);
    const emergency = { ...stop, commandId: "emergency", control: { ...stop.control, emergency: true } };
    await expect(client.sendMessage({ ...emergency, project: "/unauthorized" })).rejects.toThrow();
    await expect(client.sendMessage({ ...emergency, control: { ...emergency.control, operation: "answer" } })).rejects.toThrow();
    await expect(client.sendMessage({ ...emergency, admissionEpoch: "expired" })).rejects.toThrow();
    fault.exec("CREATE TRIGGER fail_all_outcomes BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT, 'all outcome writes fail'); END");
    const result = await client.sendMessage(emergency);
    expect(result.status).toBe("uncertain");
    expect(result.message).toContain("External effects may remain");
    expect(stops).toBe(1);
    await expect(client.sendMessage(emergency)).rejects.toThrow();
    expect(replies).toHaveLength(2);
    const staleStop = { ...stop, commandId: "stale-emergency", control: { ...stop.control, target: "superseded" } };
    await expect(client.sendMessage(staleStop)).rejects.toThrow();
    expect((await client.sendMessage({ ...staleStop, control: { ...staleStop.control, emergency: true } })).status).toBe("rejected");
    expect(stops).toBe(1);
    fault.exec("DROP TRIGGER fail_all_outcomes");
    stops = 0;
    fault.exec("DROP TRIGGER fail_stop");
    fault.exec("CREATE TRIGGER fail_result BEFORE UPDATE ON submissions WHEN json_extract(NEW.body, '$.status')='accepted' BEGIN SELECT RAISE(ABORT, 'result failure'); END");
    await expect(client.sendMessage(stop)).rejects.toThrow();
    expect((await client.sendStatus("stop"))?.status).toBe("uncertain");
    await client.sendMessage(stop);
    expect(stops).toBe(1);
    await expect(client.sendMessage({ ...stop, control: { ...stop.control, target: "different" } })).rejects.toThrow();
    fault.exec("CREATE TRIGGER fail_again BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    await expect(client.sendMessage({ ...stop, commandId: "captured-old-turn" })).rejects.toThrow();
    emit({ method: "turn/completed", params: { threadId: "provider", turn: { id: "turn" } } });
    emit({ method: "turn/started", params: { threadId: "provider", turn: { id: "new-turn" } } });
    expect((await client.sendMessage({ ...emergency, commandId: "superseded-live-turn" })).status).toBe("rejected");
    expect(stops).toBe(1);
    fault.exec("DROP TRIGGER fail_again");
    await client.close(); await host.close(); await db.close();
    const { DurableState } = await import("./durable-state");
    const recovered = new DurableState(join(dir, "chats.sqlite-state-v1"));
    const recoveredSends = new DurableSend(recovered);
    let replay = 0;
    const reopened = await startHost({ ...await recovered.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
      sendMessage: command => recoveredSends.execute(command, async () => { replay++; }), sendStatus: id => recoveredSends.receipt(id) });
    const recoveryClient = createHostClient(async () => reopened.bootstrap());
    try {
      expect((await recoveryClient.sendMessage(command)).status).toBe("accepted");
      expect((await recoveryClient.sendMessage(reply)).status).toBe("accepted");
      expect((await recoveryClient.sendMessage(stop)).status).toBe("uncertain");
      await expect(recoveryClient.sendMessage({ ...stop, commandId: "old-epoch" })).rejects.toThrow();
      expect(replay).toBe(0);
    } finally { await recoveryClient.close(); await reopened.close(); await recovered.close(); }
  } finally {
    fault.close(); await client.close(); await host.close(); service.close(); await db.close();
    globalThis.WebSocket = original; await rm(dir, { recursive: true, force: true });
  }
});
