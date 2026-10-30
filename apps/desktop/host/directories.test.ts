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
    list: async () => ({ kind: "available", listing: { entries: [{ path: "x".repeat(400000), directory: false }], ignored: [] } }) });
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
    socket.pause();
    for (let i = 0; i < 20; i++) socket.send(JSON.stringify({ _tag: "Request", id: i, tag: "listDirectory", headers: [], payload: { root: "/repo", path: "" } }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket.resume();
    await rejected;
    expect(responses).toBeLessThanOrEqual(6);
    const done = closed(socket); socket.close(); await done;
    const healthy = await connect(host.bootstrap().url);
    const response = new Promise<string>((resolve) => healthy.once("message", (data) => resolve(String(data))));
    healthy.send(JSON.stringify({ _tag: "Request", id: 1, tag: "listDirectory", headers: [], payload: { root: "/repo", path: "" } }));
    expect(await response).toContain("available");
    const end = closed(healthy); healthy.close(); await end;
  } finally { await host.close(); }
});

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
