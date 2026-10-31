import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Checkout } from "./project";
import { test, expect } from "vite-plus/test";
import { mkdtemp, rm, realpath, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
test("custom and managed policy cannot be replaced by a preset", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-permissions-"));
  const store = new Chats(join(dir, "chats"));
  let config: Record<string, unknown> = { sandbox_workspace_write: { writable_roots: ["/custom"], network_access: true } };
  let requirements: unknown = null;
  const connect = async () => ({ request: async (method: string) => method === "config/read" ? { config } : { requirements }, respond() {}, close() {} });
  try {
    const chat = await store.create(dir);
    const service = new ChatService(store, connect as never);
    await expect(service.permissions(dir, chat.id, "full")).rejects.toThrow("Custom or managed");
    config = {}; requirements = { allowedSandboxModes: ["read-only"] };
    await expect(service.permissions(dir, chat.id, "edits")).rejects.toThrow("Custom or managed");
    requirements = null;
    config = { sandbox_mode: { malformed: true } };
    await expect(service.permissions(dir, chat.id, "full")).rejects.toThrow("Custom or managed");
    config = {};
    await expect(service.permissions(dir, chat.id, "invalid")).rejects.toThrow("Unsupported");
    await expect(service.permissions(dir, chat.id, "")).rejects.toThrow("Unsupported");
    expect((await service.permissions(dir, chat.id)).choice).toBe("full");
    await service.permissions(dir, chat.id, "supervised");
    expect((await new ChatService(new Chats(join(dir, "chats")), connect as never).permissions(dir, chat.id)).choice).toBe("supervised");
  } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("saved policy conflict keeps history accessible and blocks Send until explicitly resolved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-policy-resume-"));
  const store = new Chats(join(dir, "chats"));
  let turns = 0;
  const connect = async () => ({ request: async (method: string) => {
    if (method === "config/read") return { config: {} };
    if (method === "configRequirements/read") return { requirements: null };
    if (method === "account/read") return { account: {} };
    if (method === "thread/resume") return { thread: { id: "original" }, cwd: dir, model: "a", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false } };
    if (method === "thread/turns/list") return { data: [{ id: "old-turn", items: [{ id: "old-message", type: "agentMessage", text: "retained history" }] }], nextCursor: null };
    if (method === "turn/start") { turns++; return { turn: { id: "new-turn" } }; }
    return {};
  }, close() {} });
  try {
    const chat = await store.create(dir);
    await store.update(dir, chat.id, { threadId: "original", hasSent: true, nextPermission: "full" });
    await store.draft(dir, chat.id, "retained draft");
    const service = new ChatService(store, connect as never);
    await service.open(dir, chat.id);
    expect(service.snapshot(dir, chat.id).items).toEqual(expect.arrayContaining([expect.objectContaining({ text: "retained history" })]));
    expect((await service.permissions(dir, chat.id)).message).toContain("Supervised");
    await expect(service.send(dir, chat.id, "retained draft")).rejects.toThrow("permission policy");
    expect(turns).toBe(0);
    expect(await store.get(dir, chat.id)).toMatchObject({ threadId: "original", draft: "retained draft", nextPermission: "full" });
    await service.permissions(dir, chat.id, "supervised");
    await service.send(dir, chat.id, "retained draft");
    expect(turns).toBe(1);
  } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Codex 0.166 restricted execution is refused without replacing saved policy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-network-policy-"));
  const store = new Chats(join(dir, "chats"));
  let turns = 0;
  const connect = async () => ({ installation: { path: "codex", version: "codex-cli 0.166.0" }, request: async (method: string) => {
    if (method === "config/read") return { config: {} };
    if (method === "configRequirements/read") return { requirements: null };
    if (method === "account/read") return { account: {} };
    if (method === "thread/start") return { thread: { id: "original" }, cwd: dir, model: "a", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false } };
    if (method === "thread/turns/list") return { data: [], nextCursor: null };
    if (method === "turn/start") { turns++; return { turn: { id: "turn" } }; }
    return {};
  }, close() {} });
  try {
    const chat = await store.create(dir);
    await store.update(dir, chat.id, { nextPermission: "supervised" });
    const service = new ChatService(store, connect as never);
    await service.open(dir, chat.id);
    await expect(service.send(dir, chat.id, "retained prompt")).rejects.toThrow("network isolation");
    expect(turns).toBe(0);
    expect((await store.get(dir, chat.id)).nextPermission).toBe("supervised");
  } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test("unqualified read-only title execution retains the fallback without a provider turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-title-isolation-"));
  const store = new Chats(join(dir, "chats"));
  let turns = 0, starts = 0;
  let closed!: () => void;
  const finished = new Promise<void>(resolve => { closed = resolve; });
  const titleConnect = async () => ({ installation: { path: "codex", version: "codex-cli 0.166.0" }, request: async (method: string) => {
    if (method === "model/list") return { data: [{ model: "gpt-6-luna" }] };
    if (method === "thread/start") { starts++; return { thread: { id: "title" } }; }
    if (method === "turn/start") turns++;
    return {};
  }, close: closed });
  try {
    const chat = await store.create(dir);
    await store.titleGeneration(dir, chat.id, "Retained title fallback");
    const before = (await store.get(dir, chat.id)).title;
    const service = new ChatService(store, undefined, undefined, undefined, undefined, undefined, titleConnect as never);
    await service.titleAction({ project: dir, id: chat.id });
    await finished;
    expect(turns).toBe(0);
    expect(starts).toBe(0);
    expect((await store.get(dir, chat.id)).title).toBe(before);
  } finally { await store.database.close(); await rm(dir, { recursive: true, force: true }); }
});

for (const kind of ["scratch", "worktree"] as const) {
  test(`unsupported restricted ${kind} Send preserves editable draft without resource effects`, async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "escode-admission-")));
    const root = join(dir, "repo"), managed = join(dir, "managed");
    await mkdir(root);
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]).toString();
    git("init", "-b", "main");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial");
    const checkout = await Checkout.open(root);
    const store = new Chats(join(dir, "chats.json"));
    const project = kind === "scratch" ? null : root;
    const chat = await store.createDraft(project, project ?? "");
    if (kind === "worktree") {
      const base = checkout.repositoryGit.worktreeOptions().bases.find(b => b.ref === "HEAD")!;
      await store.context(root, chat.id, root, root, { ...base, source: root });
    }
    await store.update(project, chat.id, { nextPermission: kind === "scratch" ? "supervised" : "edits" });
    await store.draft(project, chat.id, "retained prompt");
    const before = await store.get(project, chat.id);
    const branches = git("branch", "--list");
    const worktrees = git("worktree", "list", "--porcelain");
    let starts = 0, turns = 0;
    const opened: Checkout[] = [];
    const service = new ChatService(store, (async (cwd: string) => ({
      installation: { path: "codex", version: "codex-cli 0.166.0" },
      request: async (method: string, params: any) => {
        if (method === "config/read") return { config: {} };
        if (method === "configRequirements/read") return { requirements: null };
        if (method === "account/read") return { account: {} };
        if (method === "thread/start") { starts++; return { thread: { id: "task" }, cwd, model: "fixture", approvalPolicy: params.approvalPolicy, approvalsReviewer: "user", sandbox: params.sandbox === "danger-full-access" ? { type: "dangerFullAccess" } : { type: "readOnly", networkAccess: false } }; }
        if (method === "thread/turns/list") return { data: [], nextCursor: null };
        if (method === "turn/start") { turns++; return { turn: { id: "turn" } }; }
        return {};
      }, close() {},
    })) as never, undefined, undefined, {
      guard: () => () => {}, authorize: async () => {}, currentTarget: async () => root, managedRoot: managed,
      checkout: async path => { if (path === root) return checkout; const target = await Checkout.open(path); opened.push(target); return target; },
    });
    try {
      await expect(service.send(project, chat.id, "retained prompt")).rejects.toThrow("network isolation");
      expect(await store.get(project, chat.id)).toEqual({ ...before, initialSend: "unaccepted" });
      expect(starts).toBe(0); expect(turns).toBe(0);
      expect(existsSync(join(dir, "scratch"))).toBe(false);
      expect(existsSync(managed)).toBe(false);
      expect(git("branch", "--list")).toBe(branches);
      expect(git("worktree", "list", "--porcelain")).toBe(worktrees);
      await service.context(project, chat.id, root, root);
      await service.context(root, chat.id, project, project ?? "", before.worktree);
      await service.permissions(project, chat.id, "full");
      await service.send(project, chat.id, "retained prompt");
      expect(starts).toBe(1); expect(turns).toBe(1);
      const sent = await store.get(project, chat.id);
      expect(sent.phase).toBe("bound");
      expect(kind === "scratch" ? sent.scratch?.ino : sent.worktree?.reservation?.ino).toBeGreaterThan(0);
      expect(existsSync(sent.checkout)).toBe(true);
    } finally {
      await service.shutdown();
      for (const target of opened) target.close();
      checkout.close();
      await store.database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
