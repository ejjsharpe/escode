import { test, expect } from "vite-plus/test";
import WebSocket from "ws";
import { startHost } from "@escode/host";
import { createChatClient, createHostClient } from "@escode/client-runtime";
import type { SendCommand, SendReceipt } from "@escode/contracts";

function chatClient(client: ReturnType<typeof createHostClient>, values = new Map<string, string>()) {
  return createChatClient(client, {
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: key => { values.delete(key); },
    },
    flush: async () => {},
    confirmResolve: async () => false,
  });
}

test("lost live connection resnapshots terminal host state without dispatching another turn", async () => {
  const original = globalThis.WebSocket;
  const sockets: WebSocket[] = [];
  globalThis.WebSocket = class extends WebSocket {
    constructor(url: string) { super(url, { origin: "null" }); sockets.push(this); }
  } as unknown as typeof globalThis.WebSocket;
  let busy = true, bootstraps = 0, lookups = 0, histories = 0, turns = 0;
  const command: SendCommand = { commandId: "retained", admissionEpoch: "epoch", expected: "ready", project: null, id: "chat", text: "retained prompt" };
  const values = new Map([['escode-send:[null,"chat"]', JSON.stringify(command)]]);
  const host = await startHost({ hostId: "host", clientId: "stable-client", origin: "null",
    list: async () => ({ kind: "denied", message: "denied" }),
    sendStatus: async () => { lookups++; return null; },
    sendMessage: async () => { turns++; throw Error("Must not redispatch"); },
    history: async () => { histories++; return { revision: "saved", nextCursor: null, items: [] }; },
    chatSnapshot: async () => ({ project: null, chatId: "chat", threadId: "provider", connected: true,
      busy, turnId: "turn", settings: null, requests: [], error: null,
      items: [{ id: "body", turnId: "turn", type: "agentMessage", text: busy ? "partial" : "complete" }] }),
  });
  const client = createHostClient(async () => { bootstraps++; return host.bootstrap(); });
  const chat = chatClient(client, values);
  const seen: string[] = [];
  const warnings: string[] = [];
  const off = chat.live(null, "chat", value => seen.push(value.items[0]?.text ?? ""), warning => warnings.push(warning));
  try {
    await expect.poll(() => seen.at(-1)).toBe("partial");
    await new Promise(resolve => setTimeout(resolve, 50));
    sockets[0].terminate();
    busy = false;
    await expect.poll(() => seen.at(-1), { timeout: 6000 }).toBe("complete");
    expect(bootstraps).toBe(2);
    expect(lookups).toBe(2);
    expect(histories).toBe(2);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain("unavailable or expired");
    expect(chat.composer(null, "chat")).toBe("retained prompt");
    expect(turns).toBe(0);
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
  let turns = 0, histories = 0;
  let receipt: SendReceipt | null = null;
  const host = await startHost({ hostId: "host", clientId: "stable-client", origin: "null",
    list: async () => ({ kind: "denied", message: "denied" }),
    sendState: async () => ({ admissionEpoch: "epoch", expected: "ready" }),
    sendMessage: async command => {
      turns++;
      receipt = { hostId: "host", clientId: "stable-client", command, status: "accepted", message: "" };
      sockets[0].terminate();
      return receipt;
    },
    sendStatus: async id => id === receipt?.command.commandId ? receipt : null,
    openChat: async () => ({ project: null, chatId: "chat", threadId: "provider", connected: true,
      busy: false, turnId: null, settings: null, requests: [], error: null, items: [] }),
    history: async () => { histories++; return { revision: "saved", nextCursor: null, items: [{ id: "reply", turnId: "turn", type: "agentMessage", text: "completed" }] }; },
  });
  const client = createHostClient(async () => host.bootstrap());
  const values = new Map<string, string>();
  const chat = chatClient(client, values);
  try {
    await expect(chat.send(null, "chat", "retained prompt")).rejects.toBeDefined();
    const saved = values.get('escode-send:[null,"chat"]');
    const restored = chatClient(client, values);
    await restored.open(null, "chat");
    expect(histories).toBe(1);
    expect(values.get('escode-send:[null,"chat"]')).toBe(saved);
    expect(restored.composer(null, "chat")).toBe("retained prompt");
    expect(await restored.send(null, "chat", "retained prompt")).toBe("");
    expect(values.has('escode-send:[null,"chat"]')).toBe(false);
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

test("a delayed live snapshot preserves an admitted historical branch result", async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class extends WebSocket {
    constructor(url: string) { super(url, { origin: "null" }); }
  } as unknown as typeof globalThis.WebSocket;
  let bootstraps = 0;
  const host = await startHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "denied", message: "unused" }),
    chatSnapshot: async () => {
      await new Promise(resolve => setTimeout(resolve, 4000));
      return { project: null, chatId: "chat", threadId: "provider", connected: true,
        busy: false, turnId: null, settings: null, requests: [], error: null, items: [] };
    },
    branchHistory: async () => {
      await new Promise(resolve => setTimeout(resolve, 4500));
      return { status: "applied", token: null, message: "Historical chat created at isolated checkout" };
    },
  });
  const client = createHostClient(async () => { bootstraps++; return host.bootstrap(); });
  const off = client.chatLive(null, "chat", () => {}, () => {});
  try {
    expect(await client.branchHistory(null, "chat", "boundary", "choice", "command")).toEqual({
      status: "applied", token: null, message: "Historical chat created at isolated checkout",
    });
    expect(bootstraps).toBe(1);
  } finally { off(); await client.close(); await host.close(); globalThis.WebSocket = original; }
}, 10000);
