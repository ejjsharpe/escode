import { test, expect } from "vite-plus/test";
import WebSocket from "ws";
import { startHost } from "@escode/host";
import { createHostClient } from "@escode/client-runtime";

test("lost live connection resnapshots terminal host state without dispatching another turn", async () => {
  const original = globalThis.WebSocket;
  const sockets: WebSocket[] = [];
  globalThis.WebSocket = class extends WebSocket {
    constructor(url: string) { super(url, { origin: "null" }); sockets.push(this); }
  } as unknown as typeof globalThis.WebSocket;
  let busy = true, bootstraps = 0;
  const host = await startHost({ hostId: "host", clientId: "stable-client", origin: "null",
    list: async () => ({ kind: "denied", message: "denied" }),
    chatSnapshot: async () => ({ project: null, chatId: "chat", threadId: "provider", connected: true,
      busy, turnId: "turn", settings: null, requests: [], error: null,
      items: [{ id: "body", turnId: "turn", type: "agentMessage", text: busy ? "partial" : "complete" }] }),
  });
  const client = createHostClient(async () => { bootstraps++; return host.bootstrap(); });
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
  const host = await startHost({ hostId: "host", clientId: "stable-client", origin: "null",
    list: async () => ({ kind: "denied", message: "denied" }),
    sendMessage: async () => { turns++; sockets[0].terminate(); return receipt; },
    sendStatus: async id => id === command.commandId ? receipt : null,
    history: async () => ({ revision: "saved", nextCursor: null, items: [{ id: "reply", turnId: "turn", type: "agentMessage", text: "completed" }] }),
  });
  const client = createHostClient(async () => host.bootstrap());
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

test("a moved chat subscription does not disconnect unrelated host queries", async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket {
    constructor(url: string) { super(url, { origin: "null" }); }
  } as unknown as typeof globalThis.WebSocket;
  let bootstraps = 0;
  const host = await startHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "denied", message: "denied" }),
    chatSnapshot: async () => { throw Error("Unknown chat in this project"); },
    sendState: async () => ({ admissionEpoch: "epoch", expected: "ready" }),
  });
  const client = createHostClient(async () => { bootstraps++; return host.bootstrap(); });
  let errors = 0;
  const off = client.chatLive("old-project", "moved-chat", () => {}, () => { errors++; });
  try {
    await expect.poll(() => errors, { timeout: 6000 }).toBe(1);
    expect(await client.sendState(null, "other-chat")).toEqual({ admissionEpoch: "epoch", expected: "ready" });
    expect(bootstraps).toBe(1);
  } finally { off(); await client.close(); await host.close(); globalThis.WebSocket = original; }
});

test("Trash confirmation can outlive the ordinary query timeout", async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket {
    constructor(url: string) { super(url, { origin: "null" }); }
  } as unknown as typeof globalThis.WebSocket;
  const host = await startHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "denied", message: "unused" }),
    trashEntries: async () => {
      await new Promise(resolve => setTimeout(resolve, 36000));
      return { results: [], saves: [], requiresAck: false, message: "Cancelled; edits retained." };
    },
  });
  const client = createHostClient(async () => host.bootstrap());
  try { expect((await client.trashEntries("/approved", ["a"])).message).toBe("Cancelled; edits retained."); }
  finally { await client.close(); await host.close(); globalThis.WebSocket = original; }
}, 40000);
