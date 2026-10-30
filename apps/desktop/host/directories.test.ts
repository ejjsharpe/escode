import { test, expect } from "vite-plus/test";
import WebSocket from "ws";
import { startDirectoryHost } from "@escode/host";
import { maximumFrameBytes } from "@escode/contracts";

async function connect(url: string, headers = { Origin: "null" }): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
    socket.once("unexpected-response", (_, response) => {
      response.resume(); socket.terminate(); reject(Error(String(response.statusCode)));
    });
  });
}
const closed = (socket: WebSocket) => new Promise<void>((resolve) => { if (socket.readyState === WebSocket.CLOSED) resolve(); else socket.once("close", () => resolve()); });
test("local trust checks reject before dispatch; credentials expire and cannot be replayed", async () => {
  let clock = Date.now(), calls = 0;
  const host = await startDirectoryHost({ hostId: "host", clientId: "client", origin: "null", now: () => clock,
    list: async () => { calls++; return { kind: "denied", message: "Unknown root" }; } });
  try {
    for (const change of ["origin", "host", "path", "identity", "wire", "credential", "expired"]) {
      const url = new URL(host.bootstrap().url);
      const headers = { Origin: "null", Host: url.host };
      if (change === "origin") headers.Origin = "https://evil.invalid";
      if (change === "host") headers.Host = "evil.invalid";
      if (change === "path") url.pathname = "/wrong";
      if (change === "identity") url.searchParams.set("hostId", "wrong");
      if (change === "wire") url.searchParams.set("wire", "2");
      if (change === "credential") url.searchParams.delete("ticket");
      if (change === "expired") clock += 10001;
      await expect(connect(url.href, headers)).rejects.toThrow("401");
    }
    const target = host.bootstrap();
    const socket = await connect(target.url);
    await expect(connect(target.url)).rejects.toThrow("401");
    const response = new Promise<string>((resolve) => socket.once("message", (data) => resolve(String(data))));
    socket.send(JSON.stringify({ _tag: "Request", id: "1", tag: "listDirectory", payload: { root: "/unapproved", path: "" }, headers: [] }));
    expect(await response).toContain("Unknown root");
    expect(calls).toBe(1);
    const done = closed(socket); socket.close(); await done;
  } finally { await host.close(); }
});

test("oversized frames close without directory dispatch and admission recovers", async () => {
  let calls = 0;
  const host = await startDirectoryHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => { calls++; return { kind: "denied", message: "denied" }; } });
  try {
    const socket = await connect(host.bootstrap().url);
    const done = closed(socket);
    socket.send("x".repeat(maximumFrameBytes + 1));
    await done;
    expect(calls).toBe(0);
    for (let i = 0; i < 8; i++) host.bootstrap();
    expect(() => host.bootstrap()).toThrow("exhausted");
  } finally { await host.close(); }
});

test("malformed envelopes and payloads never reach the adapter; a healthy client still works", async () => {
  let calls = 0;
  const host = await startDirectoryHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => { calls++; return { kind: "available", listing: { entries: [], ignored: [] } }; } });
  try {
    for (const payload of [{ root: 7, path: "" }, { root: "/repo" }]) {
      const socket = await connect(host.bootstrap().url);
      const reply = new Promise<string>((resolve) => socket.once("message", (data) => resolve(String(data))));
      socket.send(JSON.stringify({ _tag: "Request", id: "1", tag: "listDirectory", headers: [], payload }));
      expect(await reply).toContain("Failure");
      const done = closed(socket); socket.close(); await done;
    }
    const malformed = await connect(host.bootstrap().url);
    const rejection = new Promise<string>((resolve) => malformed.once("message", (data) => resolve(String(data))));
    malformed.send(JSON.stringify({ _tag: "Request", id: "bad", headers: "invalid" }));
    expect(await rejection).toContain("Invalid request");
    const done = closed(malformed); malformed.close(); await done;
    expect(calls).toBe(0);
    const healthy = await connect(host.bootstrap().url);
    const reply = new Promise<string>((resolve) => healthy.once("message", (data) => resolve(String(data))));
    healthy.send(JSON.stringify({ _tag: "Request", id: "1", tag: "listDirectory", headers: [], payload: { root: "/repo", path: "" } }));
    expect(await reply).toContain("available");
    expect(calls).toBe(1);
    const end = closed(healthy); healthy.close(); await end;
  } finally { await host.close(); }
});

test("request admission stays bounded while an adapter is stalled", async () => {
  const releases: (() => void)[] = [];
  const host = await startDirectoryHost({ hostId: "host", clientId: "client", origin: "null",
    list: () => new Promise((resolve) => releases.push(() => resolve({ kind: "available", listing: { entries: [], ignored: [] } }))) });
  try {
    const socket = await connect(host.bootstrap().url);
    const rejection = new Promise<string>((resolve) => socket.on("message", (data) => {
      if (String(data).includes("admission exhausted")) resolve(String(data));
    }));
    for (let i = 0; i < 40; i++) socket.send(JSON.stringify({ _tag: "Request", id: String(i), tag: "listDirectory", headers: [], payload: { root: "/repo", path: "" } }));
    expect(await rejection).toContain("admission exhausted");
    expect(releases.length).toBeLessThanOrEqual(16);
    releases.forEach((release) => release());
    const done = closed(socket); socket.close(); await done;
  } finally { releases.forEach((release) => release()); await host.close(); }
});

test("stalled delivery exhausts a finite response budget without blocking a healthy client", async () => {
  const host = await startDirectoryHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "available", listing: { entries: [], ignored: [] } }),
    summaries: async () => [{ id: "x".repeat(400000), project: null, checkout: "", threadId: null, busy: false, needsInput: false, unavailable: false }] });
  try {
    const socket = await connect(host.bootstrap().url);
    let responses = 0;
    const rejected = new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.on("message", (data) => {
        responses++;
        if (String(data).includes("admission exhausted")) resolve();
      });
    });
    for (let i = 0; i < 20; i++) socket.send(JSON.stringify({ _tag: "Request", id: i, tag: "chatSummaries", headers: [], payload: null }));
    await rejected;
    expect(responses).toBeLessThanOrEqual(16);
    const done = closed(socket); socket.close(); await done;
    const healthy = await connect(host.bootstrap().url);
    const response = new Promise<string>((resolve) => healthy.once("message", (data) => resolve(String(data))));
    healthy.send(JSON.stringify({ _tag: "Request", id: 1, tag: "listDirectory", headers: [], payload: { root: "/repo", path: "" } }));
    expect(await response).toContain("available");
    const end = closed(healthy); healthy.close(); await end;
  } finally { await host.close(); }
});

test("summary snapshots stream metadata and activity, cancel cleanly, and bound oversized projections", async () => {
  let busy = false, calls = 0, oversized = false;
  const host = await startDirectoryHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "denied", message: "unused" }),
    summaries: async () => { calls++; return [{ id: oversized ? "x".repeat(maximumFrameBytes) : "chat", project: null, checkout: "", threadId: null, busy, needsInput: false, unavailable: false }]; },
  });
  const sockets: WebSocket[] = [];
  try {
    const socket = await connect(host.bootstrap().url);
    sockets.push(socket);
    const chunks: any[] = [];
    socket.on("message", data => {
      const frames = JSON.parse(String(data));
      for (const frame of Array.isArray(frames) ? frames : [frames]) {
        if (frame._tag === "Chunk") {
          chunks.push(...frame.values);
          socket.send(JSON.stringify({ _tag: "Ack", requestId: "1" }));
        }
      }
    });
    socket.send(JSON.stringify({ _tag: "Request", id: "1", tag: "chatSummaries", payload: null, headers: [] }));
    await expect.poll(() => chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chats[0]).toMatchObject({ id: "chat", busy: false });
    busy = true;
    await expect.poll(() => chunks.at(-1)?.chats[0].busy).toBe(true);
    expect(chunks.at(-1).epoch).toBe(chunks[0].epoch);
    expect(chunks.at(-1).revision).toBeGreaterThan(chunks[0].revision);
    const interrupted = new Promise<void>(resolve => socket.on("message", data => { if (String(data).includes('"Exit"')) resolve(); }));
    socket.send(JSON.stringify({ _tag: "Interrupt", requestId: "1" }));
    await interrupted;
    const done = closed(socket); socket.close(); await done;
    await new Promise(resolve => setTimeout(resolve, 400));
    const stopped = calls;
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(calls).toBe(stopped);
    oversized = true;
    const exhausted = await connect(host.bootstrap().url);
    sockets.push(exhausted);
    const response = new Promise<string>(resolve => exhausted.once("message", data => resolve(String(data))));
    exhausted.send(JSON.stringify({ _tag: "Request", id: "1", tag: "chatSummaries", payload: null, headers: [] }));
    expect(await response).toContain("capacity exhausted");
    const end = closed(exhausted); exhausted.close(); await end;
  } finally { sockets.forEach(s => s.terminate()); await host.close(); }
});

test("acknowledged summaries stay connected beyond the directory deadline and cumulative budget", async () => {
  const host = await startDirectoryHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "denied", message: "unused" }),
    summaries: async () => [{ id: "x".repeat(50000), project: null, checkout: "", threadId: null, busy: false, needsInput: false, unavailable: false }],
  });
  const socket = await connect(host.bootstrap().url);
  let chunks = 0;
  socket.on("message", data => {
    if (JSON.parse(String(data))._tag === "Chunk") {
      chunks++;
      socket.send(JSON.stringify({ _tag: "Ack", requestId: "1" }));
    }
  });
  try {
    socket.send(JSON.stringify({ _tag: "Request", id: "1", tag: "chatSummaries", payload: null, headers: [] }));
    await new Promise(resolve => setTimeout(resolve, 16000));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(chunks).toBeGreaterThan(45);
  } finally { socket.terminate(); await host.close(); }
}, 22000);
test("watch streams share the query connection, report failures, and release on interrupt and disconnect", async () => {
  const listeners = new Set<(error?: string) => void>();
  const host = await startDirectoryHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "available", listing: { entries: [{ path: "external.txt", directory: false }], ignored: [] } }),
    watch: (_root, _paths, notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; },
  });
  const socket = await connect(host.bootstrap().url);
  const messages: any[] = [];
  socket.on("message", (data) => {
    const message = JSON.parse(String(data)); messages.push(message);
    if (message._tag === "Chunk") socket.send(JSON.stringify({ _tag: "Ack", requestId: message.requestId }));
  });
  const request = (id: string, tag: string, payload: unknown) => socket.send(JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }));
  try {
    request("watch", "watchDirectories", { root: "/repo", paths: [""] });
    await expect.poll(() => messages.some((m) => m._tag === "Chunk")).toBe(true);
    expect(listeners.size).toBe(1);
    listeners.forEach((notify) => notify("EMFILE injected"));
    await expect.poll(() => JSON.stringify(messages)).toContain("EMFILE injected");
    request("list", "listDirectory", { root: "/repo", path: "" });
    await expect.poll(() => JSON.stringify(messages)).toContain("external.txt");
    socket.send(JSON.stringify({ _tag: "Interrupt", requestId: "watch" }));
    await expect.poll(() => listeners.size).toBe(0);
    request("again", "watchDirectories", { root: "/repo", paths: [""] });
    await expect.poll(() => listeners.size).toBe(1);
    socket.terminate();
    await expect.poll(() => listeners.size).toBe(0);
  } finally { socket.terminate(); await host.close(); }
});


test("consumed unary listings may exceed the aggregate stream delivery budget", async () => {
  const host = await startDirectoryHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "available", listing: { entries: [{ path: "x".repeat(400000), directory: false }], ignored: [] } }),
  });
  const socket = await connect(host.bootstrap().url);
  try {
    for (let id = 0; id < 8; id++) {
      const reply = new Promise<string>((resolve) => socket.once("message", (data) => resolve(String(data))));
      socket.send(JSON.stringify({ _tag: "Request", id, tag: "listDirectory", payload: { root: "/repo", path: "" }, headers: [] }));
      expect(await reply).toContain("available");
    }
  } finally { socket.terminate(); await host.close(); }
});

test("saved history uses authenticated validated queries and bounded responses", async () => {
  const calls: unknown[] = [];
  const host = await startDirectoryHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "denied", message: "denied" }),
    history: async (project, id, cursor) => {
      calls.push({ project, id, cursor });
      if (id === "large") return { revision: "r", nextCursor: null, items: [{ id: "i", turnId: "t", type: "agentMessage", text: "x".repeat(maximumFrameBytes) }] };
      return { revision: "immutable", nextCursor: "older", items: [{ id: "i", turnId: "t", type: "agentMessage", text: "saved text" }] };
    },
  });
  try {
    for (const payload of [{ project: null, id: "saved", cursor: null }, { project: null, id: "large", cursor: null }, { project: null, id: "bad", cursor: 3 }]) {
      const socket = await connect(host.bootstrap().url);
      const reply = new Promise<string>(resolve => socket.once("message", data => resolve(String(data))));
      socket.send(JSON.stringify({ _tag: "Request", id: "1", tag: "chatHistory", payload, headers: [] }));
      const result = await reply;
      expect(result).toContain(payload.id === "saved" ? "saved text" : payload.id === "large" ? "capacity exhausted" : "Failure");
      const done = closed(socket); socket.close(); await done;
    }
    expect(calls).toEqual([{ project: null, id: "saved", cursor: null }, { project: null, id: "large", cursor: null }]);
  } finally { await host.close(); }
});

test("live handoff sends bounded append batches, retains ACK charge and releases stalled views", async () => {
  let text = "captured", captures = 0;
  const host = await startDirectoryHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "denied", message: "denied" }),
    chatSnapshot: async () => {
      const value = text;
      captures++;
      // A provider update during snapshot capture must be covered by the following batch.
      if (captures === 1) text += " during capture";
      return { project: null, chatId: "chat", threadId: "provider", connected: true, busy: true,
        turnId: "turn", settings: null, requests: [], error: null,
        items: [{ id: "body", turnId: "turn", type: "agentMessage", text: value }] };
    },
  });
  const socket = await connect(host.bootstrap().url);
  const messages: any[] = [];
  let ack = true;
  socket.on("message", data => {
    const message = JSON.parse(String(data)); messages.push(message);
    if (ack && message._tag === "Chunk") socket.send(JSON.stringify({ _tag: "Ack", requestId: message.requestId }));
  });
  try {
    socket.send(JSON.stringify({ _tag: "Request", id: "1", tag: "chatLive", headers: [], payload: { project: null, id: "chat" } }));
    await expect.poll(() => messages.filter(m => m._tag === "Chunk").length).toBeGreaterThanOrEqual(2);
    const batches = messages.filter(m => m._tag === "Chunk").flatMap(m => m.values);
    expect(batches[0].changes[0]).toMatchObject({ append: false, item: { text: "captured" } });
    expect(batches[1].changes[0]).toMatchObject({ append: true, item: { text: " during capture" } });
    expect(batches[1].revision).toBe(batches[0].revision + 1);
    ack = false;
    await expect.poll(() => messages.some(m => m._tag === "Defect" && String(m.defect).includes("stalled")), { timeout: 18000 }).toBe(true);
    const count = captures;
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(captures).toBe(count);
    const healthy = await connect(host.bootstrap().url);
    const response = new Promise<string>(resolve => healthy.once("message", value => resolve(String(value))));
    healthy.send(JSON.stringify({ _tag: "Request", id: "2", tag: "listDirectory", headers: [], payload: { root: "repo", path: "" } }));
    expect(await response).toContain("denied");
    healthy.terminate();
  } finally { socket.terminate(); await host.close(); }
}, 22000);
