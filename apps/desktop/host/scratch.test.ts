import { test, expect } from "vite-plus/test";
import {
  mkdtemp,
  realpath,
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";

for (const failure of ["none", "connect", "create-uncertain", "accepted-lost-ack"] as const) {
  test(`scratch first Send and restart never replace resources or replay: ${failure}`, async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-scratch-")));
    const file = join(dir, "chats.json"),
      store = new Chats(file);
    let turns = 0,
      starts = 0,
      connections = 0;
    const paths: string[] = [];
    const connector: ConstructorParameters<typeof ChatService>[1] = async (cwd, emit, drop) => {
      connections++;
      paths.push(cwd);
      if (failure === "connect" && connections === 1) throw Error("connect failed");
      return {
        async request(method: string, params: any) {
          if (method === "account/read") return { account: {} };
          if (method === "thread/start") {
            starts++;
            if (failure === "create-uncertain" && cwd.endsWith(a.id))
              throw Error("unknown creation");
          }
          if (method === "thread/start" || method === "thread/resume")
            return {
              thread: { id: params.threadId ?? cwd },
              cwd,
              model: "fixture",
              reasoningEffort: "high",
              approvalPolicy: "on-request",
              sandbox: { type: "workspaceWrite" },
            };
          if (method === "turn/start") {
            turns++;
            await writeFile(join(cwd, "kept.txt"), "scratch bytes");
            if (failure === "accepted-lost-ack" && cwd.endsWith(a.id)) throw Error("ack lost");
            return { turn: { id: "turn" } };
          }
          if (method === "thread/turns/list") return { data: [], nextCursor: null };
          return {};
        },
        respond() {},
        close() {
          drop(Error("closed"));
        },
      };
    };
    const service = new ChatService(store, connector);
    const a = await store.createDraft(null, "");
    await store.draft(null, a.id, "keep prompt");
    const b = await store.createDraft(null, "");
    try {
      await service.open(null, a.id);
      expect(connections).toBe(0);
      expect(await readdir(dir)).toEqual(["chats.json.sqlite-state-v1", "chats.json.sqlite-state-v1.established"]);
      if (failure === "none") await service.send(null, a.id, "keep prompt");
      else await expect(service.send(null, a.id, "keep prompt")).rejects.toThrow();
      const saved = await store.get(null, a.id);
      expect(saved).toMatchObject({ id: a.id, createdAt: a.createdAt, project: null });
      expect(saved.scratch?.ino).toBeGreaterThan(0);
      expect(await readdir(saved.checkout)).not.toContain(".git");
      await expect(service.context(null, a.id, "project", dir)).rejects.toThrow("unsent");
      await service.send(null, b.id, "second");
      expect((await store.get(null, b.id)).checkout).not.toBe(saved.checkout);
      await service.shutdown();
      const restart = new ChatService(new Chats(file), connector);
      if (failure === "create-uncertain")
        await expect(restart.open(null, a.id)).rejects.toThrow("uncertain");
      else await restart.open(null, a.id);
      expect(turns).toBe(failure === "none" || failure === "accepted-lost-ack" ? 2 : 1);
      expect(starts).toBe(failure === "connect" ? 1 : 2);
      expect(paths.filter((p) => p === saved.checkout).length).toBe(
        failure === "create-uncertain" || failure === "connect" ? 1 : 2,
      );
      if (failure === "none" || failure === "accepted-lost-ack")
        expect(await readFile(join(saved.checkout, "kept.txt"), "utf8")).toBe("scratch bytes");
      expect((await store.get(null, a.id)).draft).toBe(failure === "none" ? "" : "keep prompt");
      restart.close();
      // A replaced directory is rejected even by a fresh host process.
      await rename(saved.checkout, saved.checkout + "-original");
      await mkdir(saved.checkout);
      const replaced = new ChatService(new Chats(file), connector);
      if (failure !== "create-uncertain")
        await expect(replaced.open(null, a.id)).rejects.toThrow(saved.checkout);
      expect((await store.get(null, a.id)).checkout).toBe(saved.checkout);
      replaced.close();
    } finally {
      service.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("occupied reservation and failures before allocation preserve prompt without launching", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-scratch-collision-")));
  const store = new Chats(join(dir, "chats.json"));
  const chat = await store.createDraft(null, "");
  const destination = join(dir, "scratch", chat.id);
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "foreign"), "untouched");
  let connections = 0;
  const service = new ChatService(store, async () => {
    connections++;
    throw Error("unexpected");
  });
  try {
    const draft = store.draft.bind(store);
    store.draft = async (...args) => { await draft(...args); throw Error("before allocation"); };
    await expect(service.send(null, chat.id, "retained")).rejects.toThrow("before allocation");
    store.draft = draft;
    expect((await store.get(null, chat.id)).scratch).toBeUndefined();
    await expect(service.send(null, chat.id, "retained")).rejects.toThrow(destination);
    await expect(service.send(null, chat.id, "retained")).rejects.toThrow(destination);
    await expect(service.open(null, chat.id)).rejects.toThrow(destination);
    expect(await readFile(join(destination, "foreign"), "utf8")).toBe("untouched");
    expect((await store.get(null, chat.id)).draft).toBe("retained");
    expect(connections).toBe(0);
  } finally {
    service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.env.ESCODE_LIVE_CHAT !== "1")(
  "installed Codex uses distinct scratch cwd/settings, writes retained bytes and reopens history",
  async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-live-scratch-")));
    const file = join(dir, "chats.json"),
      store = new Chats(file);
    let service = new ChatService(store);
    const a = await store.createDraft(null, "");
    await store.draft(null, a.id, "pending");
    const b = await store.createDraft(null, "");
    const evidence: unknown[] = [];
    const projectPath = join(dir, "Project");
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", projectPath]);
    const projectChat = await service.create(projectPath);
    try {
      await service.open(projectPath, projectChat.id);
      await Promise.all([
        service.send(
          projectPath,
          projectChat.id,
          "Reply exactly PROJECT_CONCURRENT. Do not use tools.",
        ),
        ...[a, b].map((chat, i) =>
          service.send(
            null,
            chat.id,
            `Use a shell command to write exactly SCRATCH_${i} to evidence.txt in your current working directory. Then report your absolute working directory. Do not use git.`,
          ),
        ),
      ]);
      for (const [i, chat] of [a, b].entries()) {
        await expect
          .poll(() => service.snapshot(null, chat.id).busy, { timeout: 120000 })
          .toBe(false);
        const saved = await store.get(null, chat.id),
          snapshot = service.snapshot(null, chat.id);
        expect(snapshot.error).toBeNull();
        expect(snapshot.settings?.model).toBeTruthy();
        expect(snapshot.settings?.approval).toBeTruthy();
        expect(snapshot.settings?.sandbox).toBeTruthy();
        expect(await readFile(join(saved.checkout, "evidence.txt"), "utf8")).toBe(`SCRATCH_${i}`);
        expect(await readdir(saved.checkout)).not.toContain(".git");
        evidence.push({
          scratch: saved.checkout,
          settings: snapshot.settings,
          bytes: await readFile(join(saved.checkout, "evidence.txt"), "utf8"),
        });
      }
      await expect
        .poll(() => service.snapshot(projectPath, projectChat.id).busy, { timeout: 120000 })
        .toBe(false);
      expect(service.snapshot(projectPath, projectChat.id).error).toBeNull();
      await service.shutdown();
      service = new ChatService(new Chats(file));
      for (const chat of [a, b]) {
        await service.open(null, chat.id);
        const snapshot = service.snapshot(null, chat.id);
        expect(snapshot.busy).toBe(false);
        expect(snapshot.items.filter((item) => item.type === "userMessage")).toHaveLength(1);
      }
      await writeFile("/tmp/escode-34-live-evidence.json", JSON.stringify(evidence, null, 2));
      await service.send(null, a.id, "Reply with exactly FOLLOWUP. Do not use tools.");
      await expect.poll(() => service.snapshot(null, a.id).busy, { timeout: 120000 }).toBe(false);
      expect((await store.get(null, a.id)).checkout).not.toBe(
        (await store.get(null, b.id)).checkout,
      );
    } finally {
      await service.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  },
  300000,
);

test("folder-to-record failure recovers the observed identity without reconstructing it", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-scratch-handoff-")));
  const store = new Chats(join(dir, "chats.json"));
  const chat = await store.createDraft(null, "");
  const fault = new DatabaseSync(join(dir, "chats.json.sqlite-state-v1/state.sqlite"));
  fault.exec("CREATE TRIGGER fail_ownership BEFORE INSERT ON chats WHEN json_extract(NEW.body, '$.scratch.ino') IS NOT NULL BEGIN SELECT RAISE(ABORT, 'ownership persistence failed'); END");
  const service = new ChatService(store, async () => {
    throw Error("provider must not start");
  });
  try {
    await expect(service.send(null, chat.id, "retained")).rejects.toThrow(
      "storage unavailable",
    );
    const saved = await store.get(null, chat.id);
    expect(saved.scratch).toEqual({ path: saved.checkout });
    expect(await readdir(saved.checkout)).toEqual([]);
    fault.exec("DROP TRIGGER fail_ownership");
    await store.database.close();
    const recovered = new Chats(join(dir, "chats.json"));
    const retained = await recovered.get(null, chat.id);
    expect(retained.scratch?.ino).toBeGreaterThan(0);
    expect(retained.checkout).toBe(saved.checkout);
    expect(await recovered.prepareScratch(retained)).toEqual(retained);
    await recovered.database.close();
    expect(retained.draft).toBe("retained");
  } finally {
    service.close();
    fault.close();
    await store.database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("quit invalidates a scratch provider startup and closes its eventual connection", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-scratch-quit-")));
  const store = new Chats(join(dir, "chats.json")),
    chat = await store.createDraft(null, "");
  let release!: () => void,
    entered!: () => void,
    closed = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const service = new ChatService(store, async () => {
    entered();
    await gate;
    return {
      async request() {
        throw Error("No requests after quit");
      },
      respond() {},
      close() {
        closed++;
      },
    };
  });
  try {
    const sending = service.send(null, chat.id, "retained").catch((e: Error) => e.message);
    await reached;
    expect(service.active()).toBe(true);
    const stopping = service.shutdown();
    release();
    await stopping;
    expect(await sending).toContain("closed during connection");
    expect(closed).toBeGreaterThan(0);
    expect((await store.get(null, chat.id)).threadId).toBeNull();
    expect((await store.get(null, chat.id)).draft).toBe("retained");
    expect(await readdir((await store.get(null, chat.id)).checkout)).toEqual([]);
  } finally {
    release();
    service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing scratch retains active Stop and explicit Retry reuses the restored original directory", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-scratch-missing-")));
  const file = join(dir, "chats.json"),
    store = new Chats(file);
  const chat = await store.createDraft(null, "");
  let turns = 0,
    interrupts = 0;
  const connector: ConstructorParameters<typeof ChatService>[1] = async (cwd, _emit, drop) => ({
    async request(method: string, params: any) {
      if (method === "account/read") return { account: {} };
      if (method === "thread/start" || method === "thread/resume")
        return {
          thread: { id: params.threadId ?? "thread" },
          cwd,
          model: "fixture",
          sandbox: {},
          approvalPolicy: "on-request",
        };
      if (method === "turn/start") {
        turns++;
        return { turn: { id: "turn" } };
      }
      if (method === "turn/interrupt") interrupts++;
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      return {};
    },
    respond() {},
    close() {
      drop(Error("closed"));
    },
  });
  const service = new ChatService(store, connector);
  try {
    await service.send(null, chat.id, "initial");
    const saved = await store.get(null, chat.id);
    await store.draft(null, chat.id, "followup");
    await rename(saved.checkout, saved.checkout + "-away");
    await writeFile(file + ".tmp", "interrupted unrelated write");
    await service.stop(null, chat.id);
    expect(interrupts).toBe(1);
    await rm(file + ".tmp");
    await service.shutdown();
    const restarted = new ChatService(new Chats(file), connector);
    await expect(restarted.open(null, chat.id)).rejects.toThrow(saved.checkout);
    await rename(saved.checkout + "-away", saved.checkout);
    await restarted.open(null, chat.id);
    expect(turns).toBe(1);
    expect(await store.get(null, chat.id)).toMatchObject({
      checkout: saved.checkout,
      draft: "followup",
      threadId: "thread",
    });
    restarted.close();
  } finally {
    service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("scratch parent allocation failure retains the reservation across restart", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-scratch-parent-")));
  const file = join(dir, "host-chats-v1.json");
  const store = new Chats(file);
  const chat = await store.createDraft(null, "");
  const path = join(dir, "scratch", chat.id);
  await writeFile(join(dir, "scratch"), "occupied parent");
  let connections = 0;
  const service = new ChatService(store, async () => { connections++; throw Error("unexpected provider"); });
  try {
    await expect(service.send(null, chat.id, "retained composer")).rejects.toThrow();
    const restartedStore = new Chats(file);
    expect(await restartedStore.get(null, chat.id)).toMatchObject({
      id: chat.id, createdAt: chat.createdAt, checkout: path,
      scratch: { path }, draft: "retained composer", threadId: null,
    });
    await rm(join(dir, "scratch"));
    const restart = new ChatService(restartedStore, async () => { connections++; throw Error("unexpected provider"); });
    await expect(restart.open(null, chat.id)).rejects.toThrow(path);
    await expect(restart.send(null, chat.id, "retained composer")).rejects.toThrow(path);
    expect(connections).toBe(0);
    expect(await readdir(dir)).toEqual(["host-chats-v1.json.sqlite-state-v1", "host-chats-v1.json.sqlite-state-v1.established"]);
    restart.close();
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test("legacy interrupted association evidence is preserved without import", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-scratch-write-")));
  const file = join(dir, "host-chats-v1.json");
  await writeFile(file + ".tmp", "interrupted reservation");
  const store = new Chats(file);
  try {
    expect(await store.all()).toEqual([]);
    expect(await readFile(file + ".tmp", "utf8")).toBe("interrupted reservation");
  } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("a stale draft cannot reserve scratch resources after its context changed", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-stale-preparation-")));
  const store = new Chats(join(dir, "chats"));
  try {
    const stale = await store.createDraft(null, "");
    await store.context(null, stale.id, null, "changed-context");
    await expect(store.prepareScratch(stale)).rejects.toThrow("context changed");
    expect((await store.get(null, stale.id)).checkout).toBe("changed-context");
    expect(await readdir(dir)).not.toContain("scratch");
  } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});
