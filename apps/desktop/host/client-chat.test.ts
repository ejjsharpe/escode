import { test, expect, vi } from "vite-plus/test";
import { createChatClient } from "@escode/client-runtime";
import type { SendCommand, SendReceipt, ChatDetail } from "@escode/contracts";

const key = 'escode-send:[null,"chat"]';
const composerKey = "escode-composer:chat";
const command: SendCommand = { commandId: "retained", admissionEpoch: "epoch", expected: "context", project: null, id: "chat", text: "original" };
const accepted = (command: SendCommand): SendReceipt => ({ hostId: "host", clientId: "client", command, status: "accepted", message: "" });
const detail: ChatDetail = { project: null, chatId: "chat", threadId: "provider", connected: true, busy: false,
  turnId: null, settings: null, items: [], requests: [], error: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  const host = {
    sendState: vi.fn(async () => ({ admissionEpoch: "epoch", expected: "context" })),
    sendMessage: vi.fn(async (command: SendCommand) => accepted(command)),
    sendStatus: vi.fn(async (_id: string): Promise<SendReceipt | null> => accepted(command)),
    chatHistory: vi.fn(async () => ({ revision: "saved", nextCursor: null, items: [] })),
    openChat: vi.fn(async () => detail),
    chatLive: vi.fn(() => () => {}),
  };
  const adapter = { storage, flush: vi.fn(async () => {}), confirmResolve: vi.fn(async () => false) };
  return { values, host, adapter, client: createChatClient(host, adapter) };
}

test("Send persists its identity before dispatch and clears only its accepted composer", async () => {
  const { client, host, values } = fixture();
  host.sendMessage.mockImplementation(async command => {
    expect(JSON.parse(values.get(key)!)).toEqual(command);
    expect(values.get(composerKey)).toBe("original");
    return accepted(command);
  });
  expect(await client.send(null, "chat", "original")).toBe("");
  expect(values.has(key)).toBe(false);
  expect(client.composer(null, "chat")).toBe("");
  expect(host.sendMessage).toHaveBeenCalledTimes(1);
});

test("a lost result survives a new client, Open checks history, and explicit Send only looks up the retained identity", async () => {
  const { client, host, adapter, values } = fixture();
  host.sendMessage.mockImplementation(async command => {
    host.sendStatus.mockResolvedValue(accepted(command));
    throw Error("lost reply");
  });
  await expect(client.send(null, "chat", "original")).rejects.toThrow("lost reply");
  const saved = values.get(key);
  const restored = createChatClient(host, adapter);
  expect(restored.composer(null, "chat")).toBe("original");
  await restored.open(null, "chat");
  expect(host.chatHistory).toHaveBeenCalledExactlyOnceWith(null, "chat", null);
  expect(values.get(key)).toBe(saved);
  expect(await restored.send(null, "chat", "original")).toBe("");
  expect(host.sendState).toHaveBeenCalledTimes(1);
  expect(host.sendMessage).toHaveBeenCalledTimes(1);
});

test.each([null, "admitted", "dispatching", "uncertain", "rejected"] as const)("a retained %s receipt cannot dispatch again or lose text", async status => {
  const { client, values, host } = fixture();
  values.set(key, JSON.stringify(command));
  host.sendStatus.mockResolvedValue(status === null ? null : { ...accepted(command), status });
  await client.open(null, "chat");
  await expect(client.send(null, "chat", "newer")).rejects.toThrow("Send");
  expect(values.get(key)).toBe(JSON.stringify(command));
  expect(client.composer(null, "chat")).toBe("newer");
  expect(host.sendMessage).not.toHaveBeenCalled();
  expect(host.sendState).not.toHaveBeenCalled();
});

test("newer composer text during dispatch is returned to the caller and survives client recreation", async () => {
  const { client, host, adapter } = fixture();
  const reply = deferred<SendReceipt>();
  host.sendMessage.mockImplementation(() => reply.promise);
  const sending = client.send(null, "chat", "original");
  await expect.poll(() => host.sendMessage.mock.calls.length).toBe(1);
  await client.draft("chat", "newer text");
  reply.resolve(accepted(host.sendMessage.mock.calls[0][0]));
  expect(await sending).toBe("newer text");
  expect(createChatClient(host, adapter).composer(null, "chat")).toBe("newer text");
});

test("reconciling an older accepted Send retains different current text for an explicit new Send", async () => {
  const { client, host, values } = fixture();
  values.set(key, JSON.stringify(command));
  await expect(client.send(null, "chat", "next message")).rejects.toThrow("Send again explicitly");
  expect(values.has(key)).toBe(false);
  expect(client.composer(null, "chat")).toBe("next message");
  expect(host.sendMessage).not.toHaveBeenCalled();
});

test("concurrent Send and resolution cannot race an unfinished dispatch", async () => {
  const { client, host, adapter } = fixture();
  const state = deferred<{ admissionEpoch: string; expected: string }>();
  host.sendState.mockImplementation(() => state.promise);
  const sending = client.send(null, "chat", "original");
  await expect(client.send(null, "chat", "original")).rejects.toThrow("pending");
  await expect(client.resolveSend(null, "chat")).rejects.toThrow("pending");
  state.resolve({ admissionEpoch: "epoch", expected: "context" });
  await sending;
  expect(host.sendMessage).toHaveBeenCalledTimes(1);
  expect(adapter.confirmResolve).not.toHaveBeenCalled();
});

test("failure to retain a command blocks dispatch and keeps the composer", async () => {
  const { client, adapter, host } = fixture();
  const write = adapter.storage.setItem.getMockImplementation()!;
  adapter.storage.setItem.mockImplementation((key, value) => {
    if (key.startsWith("escode-send:")) throw Error("storage full");
    write(key, value);
  });
  await expect(client.send(null, "chat", "original")).rejects.toThrow("storage full");
  expect(client.composer(null, "chat")).toBe("original");
  expect(host.sendMessage).not.toHaveBeenCalled();
});

test("failed accepted-composer flushing retains the original identity for status-only retry", async () => {
  const { client, adapter, host, values } = fixture();
  adapter.flush.mockResolvedValueOnce().mockRejectedValueOnce(Error("flush failed"));
  host.sendMessage.mockImplementation(async command => {
    host.sendStatus.mockResolvedValue(accepted(command));
    return accepted(command);
  });
  await expect(client.send(null, "chat", "original")).rejects.toThrow("flush failed");
  expect(values.has(key)).toBe(true);
  expect(await client.send(null, "chat", "original")).toBe("");
  expect(host.sendMessage).toHaveBeenCalledTimes(1);
});

test("explicit resolution cancels safely, then releases only the pending identity and retains independent text", async () => {
  const { client, adapter, values, host } = fixture();
  values.set(key, JSON.stringify(command));
  await client.draft("chat", "independent text");
  await client.resolveSend(null, "chat");
  expect(values.has(key)).toBe(true);
  adapter.confirmResolve.mockResolvedValue(true);
  await client.resolveSend(null, "chat");
  expect(values.has(key)).toBe(false);
  expect(client.composer(null, "chat")).toBe("independent text");
  expect(host.sendMessage).not.toHaveBeenCalled();
});

test("delayed resolution cannot release an identity replaced while confirmation was open", async () => {
  const { client, adapter, values } = fixture();
  values.set(key, JSON.stringify(command));
  const confirmation = deferred<boolean>();
  adapter.confirmResolve.mockImplementation(() => confirmation.promise);
  const resolving = client.resolveSend(null, "chat");
  const replacement = JSON.stringify({ ...command, commandId: "replacement" });
  values.set(key, replacement);
  confirmation.resolve(true);
  await resolving;
  expect(values.get(key)).toBe(replacement);
});

test("resolution preserves text recovered solely from an existing stored Send", async () => {
  const { client, adapter, values } = fixture();
  values.set(key, JSON.stringify(command));
  adapter.confirmResolve.mockResolvedValue(true);
  await client.resolveSend(null, "chat");
  expect(values.has(key)).toBe(false);
  expect(client.composer(null, "chat")).toBe("original");
});

test("resolution preserves an explicitly empty composer after client recreation", async () => {
  const { client, adapter, values, host } = fixture();
  values.set(key, JSON.stringify(command));
  await client.draft("chat", "");
  adapter.confirmResolve.mockResolvedValue(true);
  await client.resolveSend(null, "chat");
  expect(values.has(key)).toBe(false);
  expect(values.get(composerKey)).toBe("");
  expect(createChatClient(host, adapter).composer(null, "chat")).toBe("");
  expect(host.sendMessage).not.toHaveBeenCalled();
});

test.each(["invalid JSON", JSON.stringify({ ...command, id: "other-chat" })])("invalid retained commands fail closed without removing stored work", async saved => {
  const { client, values, host } = fixture();
  values.set(key, saved);
  await expect(client.send(null, "chat", "original")).rejects.toThrow();
  expect(values.get(key)).toBe(saved);
  expect(host.sendMessage).not.toHaveBeenCalled();
});
