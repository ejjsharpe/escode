import { test, expect } from "vite-plus/test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startHost } from "@escode/host";
import { createHostClient } from "@escode/client-runtime";

function socketFixture() {
  const original = globalThis.WebSocket;
  const sockets: WebSocket[] = [];
  globalThis.WebSocket = class extends WebSocket {
    constructor(url: string) { super(url, { origin: "null" }); sockets.push(this); }
  } as unknown as typeof globalThis.WebSocket;
  return { sockets, restore: () => { globalThis.WebSocket = original; } };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test("held directory rescan preserves bounded listings and ordinary control admission", async () => {
  const fixture = socketFixture();
  const root = await mkdtemp(join(tmpdir(), "escode-admission-"));
  await writeFile(join(root, "file.txt"), "retained");
  const held = gate();
  let active = 0, peak = 0, bootstraps = 0;
  const host = await startHost({ hostId: "host", clientId: "client", origin: "null",
    list: async (directory) => {
      active++; peak = Math.max(peak, active);
      try {
        await held.promise;
        return { kind: "available", listing: { entries: (await readdir(directory)).map(path => ({ path, directory: false })), ignored: [] } };
      } finally { active--; }
    },
    sendState: async () => ({ admissionEpoch: "epoch", expected: "ready" }),
  });
  const client = createHostClient(async () => { bootstraps++; return host.bootstrap(); });
  const listings = Array.from({ length: 20 }, () => client.listDirectory(root, ""));
  const settled = Promise.allSettled(listings);
  try {
    await expect.poll(() => active).toBe(4);
    const result = client.sendState(null, "chat");
    await expect(result).resolves.toEqual({ admissionEpoch: "epoch", expected: "ready" });
    expect(active).toBe(4);
    expect(bootstraps).toBe(1);
    held.release();
    expect((await settled).every(result => result.status === "fulfilled" && result.value.kind === "available")).toBe(true);
    expect(peak).toBe(4);
    expect(await client.listDirectory(root, "")).toMatchObject({ kind: "available", listing: { entries: [{ path: "file.txt", directory: false }] } });
  } finally {
    held.release(); await settled; await client.close(); await host.close(); fixture.restore(); await rm(root, { recursive: true, force: true });
  }
});

test("summary domain failure retains unrelated in-flight queries and recovers on the same session", async () => {
  const fixture = socketFixture();
  const held = gate();
  let entered = false, fail = true, errors = 0, snapshots = 0, bootstraps = 0;
  const host = await startHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "denied", message: "unused" }),
    sendState: async () => { entered = true; await held.promise; return { admissionEpoch: "epoch", expected: "ready" }; },
    summaries: async () => { if (fail) throw Error("Chat summary capacity exhausted"); return []; },
  });
  const client = createHostClient(async () => { bootstraps++; return host.bootstrap(); });
  const query = client.sendState(null, "chat");
  const settled = Promise.allSettled([query]);
  let off = () => {};
  try {
    await expect.poll(() => entered).toBe(true);
    off = client.chatSummaries(() => { snapshots++; }, () => { errors++; });
    await expect.poll(() => errors).toBeGreaterThan(0);
    fail = false;
    held.release();
    await expect(query).resolves.toEqual({ admissionEpoch: "epoch", expected: "ready" });
    await expect.poll(() => snapshots).toBeGreaterThan(0);
    expect(bootstraps).toBe(1);
    expect(fixture.sockets).toHaveLength(1);
  } finally { held.release(); await settled; off(); await client.close(); await host.close(); fixture.restore(); }
});

test("summary transport loss renews authentication; unsubscribing summaries and watches retains the session", async () => {
  const fixture = socketFixture();
  let snapshots = 0, errors = 0, watches = 0, bootstraps = 0;
  const host = await startHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "denied", message: "unused" }),
    summaries: async () => [],
    sendState: async () => ({ admissionEpoch: "epoch", expected: "ready" }),
    watch: () => { watches++; return () => { watches--; }; },
  });
  const client = createHostClient(async () => { bootstraps++; return host.bootstrap(); });
  const off = client.chatSummaries(() => { snapshots++; }, () => { errors++; });
  let unwatch = () => {};
  try {
    await expect.poll(() => snapshots).toBeGreaterThan(0);
    fixture.sockets[0].terminate();
    await expect.poll(() => bootstraps).toBe(2);
    await expect.poll(() => snapshots).toBeGreaterThan(1);
    expect(errors).toBeGreaterThan(0);
    off();
    unwatch = client.watchFiles("/approved", [""], () => {});
    await expect.poll(() => watches).toBe(1);
    unwatch();
    await expect.poll(() => watches).toBe(0);
    expect(await client.sendState(null, "chat")).toEqual({ admissionEpoch: "epoch", expected: "ready" });
    expect(bootstraps).toBe(2);
    expect(fixture.sockets[1].readyState).toBe(WebSocket.OPEN);
  } finally { off(); unwatch(); await client.close(); await host.close(); fixture.restore(); }
});

test("a lost directory watch retires the failed session before the next explicit query", async () => {
  const fixture = socketFixture();
  let errors = 0, watches = 0, bootstraps = 0;
  const host = await startHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "denied", message: "unused" }),
    sendState: async () => ({ admissionEpoch: "epoch", expected: "ready" }),
    watch: () => { watches++; return () => { watches--; }; },
  });
  const client = createHostClient(async () => { bootstraps++; return host.bootstrap(); });
  const off = client.watchFiles("/approved", [""], error => { if (error) errors++; });
  try {
    await expect.poll(() => watches).toBe(1);
    fixture.sockets[0].terminate();
    await expect.poll(() => errors).toBe(1);
    await expect.poll(() => watches).toBe(0);
    expect(await client.sendState(null, "chat")).toEqual({ admissionEpoch: "epoch", expected: "ready" });
    expect(bootstraps).toBe(2);
  } finally { off(); await client.close(); await host.close(); fixture.restore(); }
});

for (const method of ["watchFiles", "observeFiles"] as const) test(`${method} setup rejection preserves concurrent workspace persistence and the shared session`, async () => {
  const fixture = socketFixture();
  const held = gate();
  let entered = false, bootstraps = 0;
  const errors: string[] = [];
  const host = await startHost({ hostId: "host", clientId: "client", origin: "null",
    list: async () => ({ kind: "denied", message: "unused" }),
    persistWorkspace: async () => { entered = true; await held.promise; },
    watch: () => { throw Error("App state is unavailable in Files."); },
    observeFiles: () => { throw Error("App state is unavailable in Files."); },
  });
  const client = createHostClient(async () => { bootstraps++; return host.bootstrap(); });
  const query = client.persistWorkspace({ projects: [], selected: "agents", views: {}, drafts: [] });
  const settled = Promise.allSettled([query]);
  let off = () => {};
  try {
    await expect.poll(() => entered).toBe(true);
    const notify = (error?: string) => { if (error) errors.push(error); };
    off = method === "watchFiles" ? client.watchFiles("/approved", [""], notify) : client.observeFiles("/approved", notify);
    await expect.poll(() => errors.length).toBe(1);
    expect(errors[0]).toContain("App state is unavailable in Files.");
    held.release();
    await expect(query).resolves.toBeUndefined();
    await expect(client.persistWorkspace({ projects: [], selected: "agents", views: {}, drafts: [] })).resolves.toBeUndefined();
    expect(bootstraps).toBe(1);
    expect(fixture.sockets).toHaveLength(1);
  } finally { held.release(); await settled; off(); await client.close(); await host.close(); fixture.restore(); }
});

test("bootstrap rejection retains its diagnostic and releases the failed session for retry", async () => {
  let attempts=0;
  const client=createHostClient(async()=>{throw Error(`Invalid local bootstrap request ${++attempts}`);});
  try {
    await expect(client.sendState(null,'chat')).rejects.toThrow('Invalid local bootstrap request 1');
    await expect(client.sendState(null,'chat')).rejects.toThrow('Invalid local bootstrap request 2');
  } finally {await client.close();}
});
