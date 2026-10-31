import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";
import { startHost } from "@escode/host";
import { createHostClient } from "@escode/client-runtime";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
import { DurableSend } from "./durable-send";

test("emergency Stop cancels captured preparation with all receipt writes failing and retains reservation", async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket { constructor(url: string) { super(url, { origin: "null" }); } } as unknown as typeof globalThis.WebSocket;
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-emergency-prep-")));
  const store = new Chats(join(dir, "chats"));
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let connections = 0, starts = 0, turns = 0;
  const service = new ChatService(store, async cwd => {
    connections++; entered(); await gate;
    return { async request(method: string) {
      if (method === "account/read") return { account: {} };
      if (method === "thread/start") { starts++; return { thread: { id: "provider" }, cwd, model: "fixture", sandbox: { type: "workspaceWrite" }, approvalPolicy: "on-request" }; }
      if (method === "turn/start") { turns++; return { turn: { id: "turn" } }; }
      return {};
    }, respond() {}, close() {} };
  });
  const sends = new DurableSend(store.database);
  const host = await startHost({ ...await store.database.ready, origin: "null", list: async () => ({ kind: "denied", message: "unused" }),
    sendMessage: command => sends.execute(command, async () => {
      if (command.control) await service.stop(command.project, command.id, command.control.target);
      else await service.send(command.project, command.id, command.text);
    }), sendStatus: id => sends.receipt(id) });
  const client = createHostClient(async () => host.bootstrap());
  const fault = new DatabaseSync(join(dir, "chats.sqlite-state-v1/state.sqlite"));
  try {
    const chat = await store.createDraft(null, "");
    const send = { commandId: "send", admissionEpoch: sends.admissionEpoch, project: null, id: chat.id, expected: "", text: "keep prompt" };
    const pending = client.sendMessage(send);
    await ready;
    const reservation = (await store.get(null, chat.id)).scratch;
    expect(reservation?.path).toBeTruthy();
    const stop = { ...send, commandId: "stop", text: "", control: { operation: "stop" as const, target: service.snapshot(null, chat.id).controlTarget!, token: "", answer: null } };
    fault.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    fault.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    await expect(client.sendMessage(stop)).rejects.toThrow("Emergency Stop is available");
    await expect(client.sendMessage({ ...send, commandId: "unrecorded-send" })).rejects.toThrow();
    const result = await client.sendMessage({ ...stop, commandId: "emergency", control: { ...stop.control, emergency: true } });
    expect(result.status).toBe("uncertain");
    expect(result.message).toContain("External effects may remain");
    release();
    await expect(pending).rejects.toThrow();
    expect(connections).toBe(1);
    expect(turns).toBe(0);
    expect(starts).toBe(1);
    expect((await store.get(null, chat.id)).scratch).toEqual(reservation);
    expect((await store.get(null, chat.id)).draft).toBe("keep prompt");
    expect((await client.sendStatus("send"))?.status).toBe("dispatching");
    fault.exec("DROP TRIGGER fail_insert"); fault.exec("DROP TRIGGER fail_update");
  } finally {
    release(); fault.close(); await client.close(); await host.close(); service.close(); await store.database.close();
    globalThis.WebSocket = original; await rm(dir, { recursive: true, force: true });
  }
});
