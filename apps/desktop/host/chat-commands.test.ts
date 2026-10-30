import { test, expect } from "vite-plus/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Chats } from "./chat";
import { Checkout } from "./project";
import { ChatService, type ChatEnvironment } from "./chat-service";

async function fixture() {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), "escode-chat-command-")));
  const root = join(dir, "repo"), managed = join(dir, "managed");
  await mkdir(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" }).toString().trim();
  git("init", "-b", "main");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial");
  const project = await Checkout.open(root), store = new Chats(join(dir, "chats.json"));
  const chat = await store.createDraft(root, root);
  let owner = {}, providerCalls = 0;
  const opened: Checkout[] = [project];
  const env: ChatEnvironment = {
    guard: () => {
      const captured = owner;
      return () => { if (captured !== owner) throw Error("Lost project approval"); };
    },
    authorize: async () => {}, currentTarget: async () => root, managedRoot: managed,
    checkout: async path => {
      if (path === root) return project;
      const target = await Checkout.open(path);
      opened.push(target);
      return target;
    },
  };
  const service = new ChatService(store, async () => { providerCalls++; throw Error("fixture provider unavailable"); }, undefined, undefined, env);
  return { dir, root, managed, git, store, chat, env, service,
    revoke: () => { owner = {}; }, providerCalls: () => providerCalls,
    async close() { service.close(); opened.forEach(p => p.close()); await rm(dir, { recursive: true, force: true }); },
  };
}
function gate() {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(r => { release = r; });
  const reached = new Promise<void>(r => { entered = r; });
  return { release, entered, waiting, reached };
}

for (const outcome of ["stop", "shutdown", "reapprove"] as const) {
  for (const lookup of [1, 2]) {
    test(`${outcome} during checkout lookup ${lookup} prevents allocation and provider startup`, async () => {
      const f = await fixture(), g = gate();
      try {
        const base = f.git("rev-parse", "HEAD");
        await f.service.draftAction({ operation: "execution", project: f.root, id: f.chat.id,
          expected: await f.service.expectation(f.root, f.chat.id), mode: "new", value: "HEAD", commit: base });
        const checkout = f.env.checkout;
        let calls = 0;
        f.env.checkout = async path => {
          if (++calls === lookup) { g.entered(); await g.waiting; }
          return checkout(path);
        };
        const sending = f.service.send(f.root, f.chat.id, "retain prompt", await f.service.expectation(f.root, f.chat.id))
          .then(() => "unexpected success", (e: Error) => e.message);
        await g.reached;
        await expect(f.service.send(f.root, f.chat.id, "competitor", "old")).rejects.toThrow("in progress");
        if (outcome === "stop") await f.service.stop(f.root, f.chat.id, f.service.snapshot(f.root, f.chat.id).controlTarget);
        else if (outcome === "shutdown") await f.service.shutdown();
        else f.revoke();
        g.release();
        expect(await sending).toMatch(/cancelled|disconnected|approval/);
        expect(f.providerCalls()).toBe(0);
        expect(existsSync(f.managed)).toBe(false);
        expect(await f.store.get(f.root, f.chat.id)).toMatchObject({ draft: "retain prompt", threadId: null });
        expect((await f.store.get(f.root, f.chat.id)).worktree?.reservation).toBeUndefined();
      } finally { g.release(); await f.close(); }
    });
  }
}

test("started preparation retains its real reservation and checkout after Stop, restart does not replay", async () => {
  const f = await fixture(), g = gate();
  try {
    await f.service.draftAction({ operation: "execution", project: f.root, id: f.chat.id,
      expected: await f.service.expectation(f.root, f.chat.id), mode: "new", value: "HEAD", commit: f.git("rev-parse", "HEAD") });
    const prepare = f.store.prepareWorktree.bind(f.store);
    f.store.prepareWorktree = async (...args) => { const result = await prepare(...args); g.entered(); await g.waiting; return result; };
    const sending = f.service.send(f.root, f.chat.id, "keep", await f.service.expectation(f.root, f.chat.id))
      .then(() => "unexpected success", (e: Error) => e.message);
    await g.reached;
    await f.service.stop(f.root, f.chat.id);
    g.release();
    expect(await sending).toContain("cancelled");
    const saved = await f.store.get(f.root, f.chat.id);
    expect(saved.worktree?.reservation?.root).toBe(saved.checkout);
    expect(existsSync(saved.checkout)).toBe(true);
    await writeFile(join(saved.checkout, "valuable"), "keep");
    const restarted = new ChatService(new Chats(join(f.dir, "chats.json")), async () => { throw Error("must not start"); });
    await restarted.open(f.root, f.chat.id);
    expect(f.providerCalls()).toBe(0);
    expect((await new Chats(join(f.dir, "chats.json")).get(f.root, f.chat.id)).worktree).toEqual(saved.worktree);
    restarted.close();
  } finally { g.release(); await f.close(); }
});

test("production expectations reject stale Send/context/execution and changed displayed bases", async () => {
  const f = await fixture();
  try {
    const expected = await f.service.expectation(f.root, f.chat.id);
    await f.service.draftAction({ operation: "context", project: f.root, id: f.chat.id, expected, target: f.root });
    await expect(f.service.send(f.root, f.chat.id, "keep", expected)).rejects.toThrow("state changed");
    await expect(f.service.draftAction({ operation: "context", project: f.root, id: f.chat.id, expected, target: null })).rejects.toThrow("Draft changed");
    await expect(f.service.draftAction({ operation: "execution", project: f.root, id: f.chat.id, expected, mode: "reuse", value: f.root, commit: "" })).rejects.toThrow("Draft changed");
    await expect(f.service.draftAction({ operation: "execution", project: f.root, id: f.chat.id,
      expected: await f.service.expectation(f.root, f.chat.id), mode: "new", value: "HEAD", commit: "wrong" })).rejects.toThrow("Base is missing or changed");
    expect(f.providerCalls()).toBe(0);
    expect(existsSync(f.managed)).toBe(false);
  } finally { await f.close(); }
});

for (const outcome of ["stop", "shutdown", "reapprove"] as const) {
  test(`${outcome} during final Send persistence prevents provider handoff and retains identity`, async () => {
    const f = await fixture(), g = gate();
    let turns = 0;
    const service = new ChatService(f.store, async cwd => ({
      async request(method: string) {
        if (method === "account/read") return { account: {} };
        if (method === "thread/start") return { thread: { id: "known" }, cwd, model: "fixture", sandbox: {}, approvalPolicy: "on-request" };
        if (method === "turn/start") { turns++; return { turn: { id: "turn" } }; }
        return {};
      }, respond() {}, close() {},
    }), undefined, undefined, f.env);
    try {
      const update = f.store.update.bind(f.store);
      f.store.update = async (...args) => {
        const result = await update(...args);
        if (args[2].hasSent) { g.entered(); await g.waiting; }
        return result;
      };
      const sending = service.send(f.root, f.chat.id, "keep", await service.expectation(f.root, f.chat.id))
        .then(() => "unexpected success", (e: Error) => e.message);
      await g.reached;
      if (outcome === "stop") await service.stop(f.root, f.chat.id);
      else if (outcome === "shutdown") await service.shutdown();
      else f.revoke();
      g.release();
      expect(await sending).toMatch(/cancelled|disconnected|approval/);
      expect(turns).toBe(0);
      expect(await f.store.get(f.root, f.chat.id)).toMatchObject({ threadId: "known", draft: "keep", initialSend: "unaccepted" });
    } finally { g.release(); service.close(); await f.close(); }
  });
}
