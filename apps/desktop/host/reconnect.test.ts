import { test, expect } from "vite-plus/test";
import WebSocket from "ws";
import { startDirectoryHost } from "@escode/host";
import { createDirectoryClient } from "@escode/client-runtime";

test("lost live connection resnapshots terminal host state without dispatching another turn", async () => {
  const original = globalThis.WebSocket;
  const sockets: WebSocket[] = [];
  globalThis.WebSocket = class extends WebSocket {
    constructor(url: string) { super(url, { origin: "null" }); sockets.push(this); }
  } as unknown as typeof globalThis.WebSocket;
  let busy = true, bootstraps = 0;
  const host = await startDirectoryHost({ hostId: "host", clientId: "stable-client", origin: "null",
    list: async () => ({ kind: "denied", message: "denied" }),
    chatSnapshot: async () => ({ project: null, chatId: "chat", threadId: "provider", connected: true,
      busy, turnId: "turn", settings: null, requests: [], error: null,
      items: [{ id: "body", turnId: "turn", type: "agentMessage", text: busy ? "partial" : "complete" }] }),
  });
  const client = createDirectoryClient(async () => { bootstraps++; return host.bootstrap(); });
  const seen: string[] = [];
  const off = client.chatLive(null, "chat", value => seen.push(value.items[0]?.text ?? ""), () => {});
  try {
    await expect.poll(() => seen.at(-1)).toBe("partial");
    await new Promise(resolve => setTimeout(resolve, 50));
    sockets[0].terminate();
    busy = false;
    await expect.poll(() => seen.at(-1), { timeout: 6000 }).toBe("complete");
    expect(bootstraps).toBe(2);
    off();
    await client.close();
    await expect.poll(() => sockets.every(socket => socket.readyState === WebSocket.CLOSED)).toBe(true);
  } finally { off(); await client.close(); await host.close(); globalThis.WebSocket = original; }
});

test("lost Send result reconciles original receipt on a fresh authorized session", async () => {
  const original = globalThis.WebSocket;
  const sockets: WebSocket[] = [];
  globalThis.WebSocket = class extends WebSocket {
    constructor(url: string) { super(url, { origin: "null" }); sockets.push(this); }
  } as unknown as typeof globalThis.WebSocket;
  const command = { commandId: "original", admissionEpoch: "epoch", expected: "ready", project: null, id: "chat", text: "retained prompt" };
  let turns = 0;
  const receipt = { hostId: "host", clientId: "stable-client", command, status: "accepted" as const, message: "" };
  const host = await startDirectoryHost({ hostId: "host", clientId: "stable-client", origin: "null",
    list: async () => ({ kind: "denied", message: "denied" }),
    sendMessage: async () => { turns++; sockets[0].terminate(); return receipt; },
    sendStatus: async id => id === command.commandId ? receipt : null,
    history: async () => ({ revision: "saved", nextCursor: null, items: [{ id: "reply", turnId: "turn", type: "agentMessage", text: "completed" }] }),
  });
  const client = createDirectoryClient(async () => host.bootstrap());
  try {
    await expect(client.sendMessage(command)).rejects.toBeDefined();
    expect(await client.sendStatus(command.commandId)).toEqual(receipt);
    expect((await client.chatHistory(null, "chat", null)).items[0].text).toBe("completed");
    expect(await client.sendStatus("expired")).toBeNull();
    expect(command.text).toBe("retained prompt");
    expect(turns).toBe(1);
    expect(sockets).toHaveLength(2);
  } finally { await client.close(); await host.close(); globalThis.WebSocket = original; }
});
