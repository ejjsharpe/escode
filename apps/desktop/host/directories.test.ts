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
const closed = (socket: WebSocket) => new Promise<void>((resolve) => socket.once("close", () => resolve()));
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
