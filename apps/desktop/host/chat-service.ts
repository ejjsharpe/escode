import { captureTurnCheckpoint } from "./checkpoints";
import type { Checkout } from "./project";
import type { DraftAction } from "@escode/contracts";
import { LiveSpool } from "./live-spool";
import type { HistoryPage } from "@escode/contracts";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { Chats, type SavedChat } from "./chat";
import { codexDiagnostic, connectCodex, type CodexConnection, type WireMessage } from "./tools";
export type ChatItem = import("@escode/contracts").Mutable<HistoryPage["items"][number]>;
type RequestParams = import("./vendor/codex/src/schema").ServerRequestParamsByMethod;
export type LiveRequest = { [M in keyof RequestParams]: { token: string; method: M; params: RequestParams[M] } }[keyof RequestParams];
export type ChatSnapshot = import("@escode/contracts").Mutable<import("@escode/contracts").ChatDetail>;
type RuntimeSnapshot = Omit<ChatSnapshot, "settings" | "requests"> & {
  settings: { model?: string | null; reasoning?: unknown; approval?: unknown; sandbox?: unknown } | null;
  requests: LiveRequest[];
};
// Connection readiness and callback ownership are independent of saved provider identity.
type ConnectionState = {
  status: "disconnected" | "connecting" | "connected";
  epoch: string;
  rpc?: CodexConnection;
  opening?: Promise<void>;
  seenRequestIds?: Set<string | number>;
};
// Starting has no provider turn ID yet; Stop becomes interruptible once running.
type TurnState =
  | { phase: "idle" | "starting"; id: null }
  | { phase: "running" | "stopping"; id: string };
type OutputState = {
  failed?: boolean;
  recovered?: boolean;
  recovering?: Promise<void>;
  pending?: ChatItem[];
  writing?: Promise<void>;
};
type Session = Omit<RuntimeSnapshot, "connected" | "busy" | "turnId" | "preparing" | "controlTarget"> & {
  connection: ConnectionState;
  turn: TurnState;
  output: OutputState;
  requestIds: Map<string, string | number>;
  // Send remains in flight through persistence, even if the provider already completed.
  sending?: boolean;
  completing?: Promise<void>;
  completedTurnId?: string;
  completion?: { chat: Readonly<SavedChat>; id: string; createdAt: number; commandId?: string };
  preparation?: { id: string; cancelled: boolean };
  checkoutIdentity?: { path: string; dev: number; ino: number };
};
export type ChatEnvironment = {
  // Capture the approval session; the returned check must reject even after reapproval.
  guard: (project: string | null) => () => void;
  authorize: (project: string | null) => Promise<void>;
  checkout: (root: string) => Promise<Checkout>;
  currentTarget: (project: string) => Promise<string>;
  managedRoot: string;
};
export class ChatService {
  private sessions = new Map<string, Session>();
  private revisions = new Map<string, number>();
  private revision(id: string) { return this.revisions.get(id) ?? 0; }
  private transitions = new Map<string, string | null>();
  // Hold identity stable from host authorization through binding; live responses stay independent.
  private async inContext<T>(project: string | null, id: string, action: () => Promise<T>) {
    if (this.transitions.has(id))
      throw Error("This chat already has an active turn or context change in progress.");
    this.transitions.set(id, project);
    try {
      return await action();
    } finally {
      this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
      this.transitions.delete(id);
    }
  }
  constructor(
    private store: Chats,
    private connect = connectCodex,
    private spool: Pick<LiveSpool, "read" | "write"> = new LiveSpool(store.spoolDirectory),
    private previewSettings?: (cwd: string) => Promise<RuntimeSnapshot["settings"]>,
    private environment?: ChatEnvironment,
  ) {}
  async expectation(project: string | null, id: string) {
    const chat = await this.store.get(project, id);
    await this.environment?.authorize(project);
    const detail = this.snapshot(project, id);
    return JSON.stringify([this.revision(id), chat.checkout, chat.threadId, chat.phase, chat.directoryIdentity,
      chat.worktree, chat.scratch, detail.connected, detail.busy, detail.turnId]);
  }
  private async expectState(project: string | null, id: string, expected: string, message: string) {
    if (await this.expectation(project, id) !== expected) throw Error(message);
  }
  async draftAction(action: DraftAction) {
    const env = this.environment;
    if (!env) throw Error("Chat environment unavailable");
    const { project, operation } = action;
    const check = env.guard(project);
    check();
    if (operation === "createDraft") {
      let target = action.checkout ?? (project === null ? "" : await env.currentTarget(project));
      if (action.checkout !== undefined) {
        if (project === null) throw Error("A captured checkout requires a project.");
        const checkout = await env.checkout(action.checkout);
        check();
        checkout.checkoutIdentity();
        if (checkout.repositoryGit.repository() !== project) throw Error("Wrong project checkout.");
        if (!checkout.repositoryGit.worktreeOptions().checkouts.includes(checkout.root))
          throw Error("Choose an available Git checkout.");
        target = checkout.root;
      }
      check();
      return this.store.createDraft(project, target, true);
    }
    return this.inContext(project, action.id, async () => {
      await this.expectState(project, action.id, action.expected, "Draft changed. Inspect and retry.");
      check();
      if (operation === "context") {
        const targetCheck = env.guard(action.target);
        targetCheck();
        const target = action.target === null ? "" : await env.currentTarget(action.target);
        check();
        targetCheck();
        return this.changeContext(project, action.id, action.target, target);
      }
      const saved = await this.store.get(project, action.id);
      const source = saved.worktree?.source ?? saved.checkout;
      const checkout = await env.checkout(source);
      check();
      if (checkout.repositoryGit.repository() !== project) throw Error("Wrong project checkout.");
      const options = checkout.repositoryGit.worktreeOptions();
      if (action.mode === "new") {
        if (!options.bases.some(b => b.ref === action.value && b.commit === action.commit))
          throw Error("Base is missing or changed. Refresh and choose again.");
        return this.changeContext(project, action.id, project, source, { source, ref: action.value, commit: action.commit });
      }
      if (!options.checkouts.includes(action.value)) throw Error("Choose a Git-discovered worktree explicitly.");
      const target = await env.checkout(action.value);
      check();
      if (target.repositoryGit.repository() !== project) throw Error("Wrong project checkout.");
      return this.changeContext(project, action.id, project, target.root);
    });
  }
  private async authorizeSend(chat: Readonly<SavedChat>, check: () => void) {
    if (chat.project === null) return;
    const target = await this.environment!.checkout(chat.checkout);
    check();
    target.checkoutIdentity();
    if (chat.phase === "draft" && !chat.directoryIdentity && !chat.worktree?.reservation &&
        !target.repositoryGit.validateRepository().includes(target.root))
      throw Error("Choose an available Git checkout before first Send. Prompt retained.");
    if (target.repositoryGit.repository() !== chat.project)
      throw Error("Saved checkout is unavailable or no longer belongs to this project. Prompt retained; restore this exact path and Retry.");
  }
  private async prepareSend(chat: Readonly<SavedChat>, check: () => void) {
    if (!chat.worktree) return chat;
    if (chat.worktree.reservation) {
      this.store.validateWorktree(chat);
      return chat;
    }
    const source = await this.environment!.checkout(chat.worktree.source);
    check();
    if (source.repositoryGit.repository() !== chat.project) throw Error("Wrong project checkout.");
    const prepared = await this.store.prepareWorktree(chat, source, this.environment!.managedRoot);
    check();
    const target = await this.environment!.checkout(prepared.checkout);
    check();
    if (target.repositoryGit.repository() !== chat.project || !target.repositoryGit.validateRepository().includes(target.root))
      throw Error("Prepared checkout is no longer registered with this project.");
    return prepared;
  }
  private clearRequests(s: Session) {
    s.requests = [];
    s.requestIds.clear();
  }
  // Retire live controls without clearing preparation reservations or persisted output.
  private endConnection(s: Session) {
    s.connection.epoch = randomUUID();
    s.connection.status = "disconnected";
    s.turn = { phase: "idle", id: null };
    this.clearRequests(s);
  }
  private closeConnection(s: Session) {
    this.endConnection(s);
    s.connection.rpc?.close();
  }
  private writers = 0;
  private persistOutput(s: Session) {
    if (s.output.writing) return;
    if (this.writers >= 16) { s.output.pending = undefined; s.output.failed = true; s.error = "Live output partial: persistence admission exhausted. Stop remains available."; return; }
    this.writers++;
    s.output.writing = (async () => {
      try {
        while (s.output.pending) {
          const items = s.output.pending;
          if (s.threadId) await this.spool.write(s.chatId, s.threadId, items, false);
          s.items = items;
          if (s.output.pending === items) s.output.pending = undefined;
        }
      } catch (error) {
        s.output.pending = undefined; s.output.failed = true;
        s.error = `Live output partial/unavailable: ${String(error)}. Provider work continues; Stop remains available. Reload saved history after completion.`;
      } finally { this.writers--; s.output.writing = undefined; }
    })();
  }
  list(project: string | null) {
    return this.store.list(project);
  }
  create(project: string, checkout = project) {
    return this.store.create(project, checkout);
  }
  draft(project: string | null, id: string, text: string) {
    return this.store.draft(project, id, text);
  }
  private session(project: string | null, id: string, retain = true) {
    let s = this.sessions.get(id);
    if (s && s.project !== project) throw Error("Unknown project/chat.");
    if (!s) {
      s = {
        project,
        chatId: id,
        threadId: null,
        connection: { status: "disconnected", epoch: randomUUID() },
        turn: { phase: "idle", id: null },
        output: {},
        settings: null,
        items: [],
        requests: [],
        requestIds: new Map(),
        error: null,
      };
      if (retain) this.sessions.set(id, s);
    }
    return s;
  }
  summary(project: string | null, id: string) {
    const s = this.sessions.get(id);
    return { busy: !!((s && s.turn.phase !== "idle") || s?.sending || s?.completing || s?.connection.opening || this.transitions.has(id)),
      needsInput: !!s?.requests.length, unavailable: !!s?.error };
  }
  snapshot(project: string | null, id: string): RuntimeSnapshot {
    const s = this.session(project, id, false);
    return structuredClone({
      controlTarget: JSON.stringify([s.connection.epoch, s.turn.id, s.preparation?.id]),
      project,
      chatId: id,
      threadId: s.threadId,
      connected: s.connection.status === "connected",
      busy: s.turn.phase !== "idle" || !!s.completing,
      preparing: !!s.preparation,
      turnId: s.turn.id,
      settings: s.settings,
      items: s.items,
      requests: s.requests,
      error: s.error,
      history: s.history,
    });
  }
  async inspect(project: string | null, id: string) {
    const chat = await this.store.get(project, id);
    const s = this.session(project, id);
    if (!s.connection.rpc && chat.threadId) await this.recoverOutput(s, chat.threadId);
    const snapshot = this.snapshot(project, id);
    snapshot.contextError =
      chat.phase === "draft" &&
      ((chat.project === null && !chat.scratch) || (chat.worktree && !chat.worktree.reservation))
        ? chat.availabilityError
        : await this.store.validateDirectory(chat);
    return snapshot;
  }
  private async recoverOutput(s: Session, threadId: string) {
    if (s.output.recovering) return s.output.recovering;
    if (s.output.recovered) return;
    s.output.recovered = true;
    s.threadId = threadId;
    s.output.recovering = (async () => {
      try {
        const saved = await this.spool.read(s.chatId, threadId);
        if (saved) { s.items = [...saved.items]; s.error = "Recovered live output; Retry to inspect provider history. Work was not resumed."; }
      } catch { s.error = "Live output unavailable: incomplete spool. Provider identity retained; Retry explicitly."; }
    })();
    try { await s.output.recovering; } finally { s.output.recovering = undefined; }
  }
  private validateCheckout(s: Session, checkout: string) {
    try {
      accessSync(checkout, constants.R_OK | constants.X_OK);
      const identity = statSync(checkout);
      const path = realpathSync(checkout);
      const previous = s.checkoutIdentity;
      if (
        !identity.isDirectory() ||
        (previous &&
          (previous.path !== path ||
            previous.dev !== identity.dev ||
            previous.ino !== identity.ino))
      )
        throw Error("Checkout changed");
      s.checkoutIdentity = { path, dev: identity.dev, ino: identity.ino };
    } catch {
      s.error = `Checkout unavailable or changed: ${checkout}. Restore access to the original directory, then Retry connection. History and drafts are retained; work was not resent.`;
      throw Error(s.error);
    }
  }
  context(
    project: string | null,
    id: string,
    target: string | null,
    checkout: string,
    worktree?: SavedChat["worktree"],
  ) {
    return this.inContext(project, id, () => this.changeContext(project, id, target, checkout, worktree));
  }
  private async changeContext(project: string | null, id: string, target: string | null, checkout: string, worktree?: SavedChat["worktree"]) {
    const chat = await this.store.context(project, id, target, checkout, worktree);
    const previous = this.sessions.get(id);
    if (previous) this.closeConnection(previous);
    this.sessions.delete(id);
    return chat;
  }
  open(project: string | null, id: string) {
    if (this.transitions.get(id) === project && this.sessions.get(id)?.connection.status === "connected")
      return this.connectSession(project, id);
    return this.inContext(project, id, () => this.connectSession(project, id));
  }
  private async connectSession(
    project: string | null,
    id: string,
    authorizedDraft?: Readonly<SavedChat>,
  ) {
    const s = this.session(project, id);
    if (s.connection.opening) {
      await s.connection.opening;
      return this.snapshot(project, id);
    }
    if (s.connection.status === "connected") {
      const error = await this.store.validateDirectory(await this.store.get(project, id), true);
      if (error) throw Error(error);
      return this.snapshot(project, id);
    }
    s.connection.status = "connecting";
    s.connection.opening = (async () => {
      const epoch = randomUUID();
      s.connection.epoch = epoch;
      s.connection.seenRequestIds = new Set();
      s.error = null;
      let rpc: CodexConnection | undefined;
      let chat: Readonly<SavedChat> | undefined;
      try {
        chat = authorizedDraft ?? (await this.store.get(project, id));
        if (chat.phase === "bound" && !chat.threadId && chat.initialSend === "creating")
          throw Error(
            "Provider creation outcome is uncertain. No thread identity was returned; the saved path and prompt are retained. Retry cannot create a replacement conversation.",
          );
        if (chat.removed)
          throw Error(
            "Checkout was removed. History and drafts are retained; this chat cannot run.",
          );
        if (s.connection.epoch !== epoch) throw Error("Project closed while loading saved chat.");
        if (chat.phase === "draft" && !authorizedDraft) {
          if (chat.project !== null && !chat.worktree) this.validateCheckout(s, chat.checkout);
          else if (chat.worktree?.reservation) this.store.validateWorktree(chat);
          else if (chat.scratch) this.store.validateScratch(chat);
          if (this.previewSettings && chat.checkout) s.settings = await this.previewSettings(chat.checkout);
          return;
        }
        const directoryError = await this.store.validateDirectory(chat);
        if (directoryError) throw Error(directoryError);
        this.validateCheckout(s, chat.checkout);
        if (!chat.directoryIdentity) {
          const error = await this.store.validateDirectory(chat, true);
          if (error) throw Error(error);
        }
        if (chat.threadId) await this.recoverOutput(s, chat.threadId);
        rpc = await this.connect(
          chat.checkout,
          (event) => {
            if (s.connection.epoch === epoch) this.event(s, event);
          },
          (error) => {
            if (s.connection.epoch !== epoch) return;
            this.endConnection(s);
            s.error = error.message;
          },
        );
        if (s.connection.epoch !== epoch) {
          rpc.close();
          throw Error("Project closed during connection.");
        }
        s.connection.rpc = rpc;
        const account = await rpc.request("account/read", { refreshToken: false }) as import("./vendor/codex/src/schema").V2GetAccountResponse;
        if (!account.account)
          throw Error(
            "Run codex login externally, then Retry connection. Draft and saved history are retained.",
          );
        // A known provider identity is never replaced, including older unsent records.
        const resume = Boolean(chat.threadId);
        this.store.validateWorktree(chat);
        this.store.validateScratch(chat);
        this.validateCheckout(s, chat.checkout);
        if (chat.phase === "draft")
          await this.store.update(project, id, { phase: "bound", initialSend: "creating" });
        const result = await rpc.request(
          resume ? "thread/resume" : "thread/start",
          resume
            ? { threadId: chat.threadId, cwd: chat.checkout, excludeTurns: true }
            : { cwd: chat.checkout },
        ) as import("./vendor/codex/src/schema").V2ThreadStartResponse;
        // Retain returned identity even if later response validation or persistence fails.
        if (
          typeof result.thread?.id === "string" &&
          (!resume || result.thread.id === chat.threadId)
        ) {
          s.threadId = result.thread.id;
          await this.store.prepared(project, id, { threadId: s.threadId });
        }
        if (
          result.cwd !== chat.checkout ||
          typeof result.model !== "string" ||
          !result.sandbox ||
          !result.approvalPolicy ||
          typeof result.thread?.id !== "string" ||
          (resume && result.thread.id !== chat.threadId)
        )
          throw Error(
            "Incompatible Codex thread response. Check supported CLI, then Retry connection.",
          );
        s.threadId = result.thread.id;
        await this.store.update(project, id, {
          threadId: s.threadId,
          ...(chat.phase
            ? {
                initialSend:
                  chat.initialSend === "uncertain" || chat.initialSend === "accepted"
                    ? chat.initialSend
                    : ("unaccepted" as const),
              }
            : {}),
        });
        s.settings = {
          model: result.model,
          reasoning: result.reasoningEffort ?? null,
          approval: result.approvalPolicy,
          sandbox: result.sandbox,
        };
        if (resume) {
          await s.output.writing;
          const page = await this.readHistory(s, null);
          await s.output.writing;
          const retained = s.items.filter(item => !page.items.some(saved => saved.id === item.id && saved.turnId === item.turnId && saved.text.startsWith(item.text)));
          s.items = [...page.items.filter(item => !retained.some(value => value.id === item.id && value.turnId === item.turnId)), ...retained];
          if (!retained.length) s.error = null;
          s.output.failed = false;
          s.history = { nextCursor: page.nextCursor, revision: page.revision };
        }
        if (s.connection.epoch !== epoch) throw Error("Codex disconnected during setup. Retry connection.");
        this.store.validateWorktree(chat);
        this.store.validateScratch(chat);
        this.validateCheckout(s, chat.checkout);
        s.connection.status = "connected";
      } catch (error) {
        if (!chat && !s.threadId && !s.connection.rpc && this.sessions.get(id) === s) this.sessions.delete(id);
        if ((error as { rejected?: boolean }).rejected) {
          const saved = await this.store.get(project, id);
          if (saved.initialSend === "creating" && !saved.threadId)
            await this.store.update(project, id, { phase: "draft", initialSend: "unaccepted" });
        }
        this.endConnection(s);
        rpc?.close();
        await rpc?.finished;
        const message = error instanceof Error ? error.message : String(error);
        s.error = rpc?.installation
          ? codexDiagnostic(rpc.installation.path, rpc.installation.version, message)
          : message;
        throw Error(s.error);
      }
    })();
    try {
      await s.connection.opening;
    } finally {
      s.connection.opening = undefined;
      if (s.connection.status === "connecting") s.connection.status = "disconnected";
    }
    return this.snapshot(project, id);
  }
  private rewindChoices = new Map<string, string>();
  async rewind(project: string | null, id: string, boundary: string, token: string | null, commandId: string | null): Promise<import("@escode/contracts").RewindResult> {
    const check = this.environment?.guard(project) ?? (() => {});
    await this.environment?.authorize(project);
    check();
    await this.store.get(project, id);
    const identity = JSON.stringify([project, id, boundary, token]);
    if (commandId) {
      const prior = await this.store.database.command("rewindRead", { commandId });
      if (prior) { if (prior.identity !== identity) throw Error("Rewind identity conflict"); return prior.result; }
    }
    if (this.checkoutActive(project, id)) throw Error("Stop active work before rewinding.");
    return this.inContext(project, id, async () => {
      const unavailable = (message: string) => ({ status: "unavailable" as const, token: null, message });
      const chat = await this.store.get(project, id);
      const error = await this.store.validateDirectory(chat);
      if (error) return unavailable(error);
      const batch = await this.store.database.command("checkpointPoints", { commandId: id, body: { boundary } }) as import("@escode/contracts").CheckpointPage;
      const point = batch.points[0];
      if (!point?.turnId || !point.threadId || point.threadId !== chat.threadId) return unavailable("Provider boundary reference unavailable.");
      let rpc: CodexConnection | undefined;
      try {
        rpc = await this.connect(chat.checkout, () => {}, () => {});
        const turns: string[] = []; let cursor: string | null = null;
        const seen = new Set<string | null>();
        for (let n = 0; n < 50; n++) {
          if (seen.has(cursor)) return unavailable("Repeated provider history cursor.");
          seen.add(cursor);
          const page = await rpc.request("thread/turns/list", { threadId: point.threadId, cursor, limit: 20, itemsView: "full", sortDirection: "asc" }) as { data: { id: string; status?: string }[]; nextCursor: string | null };
          this.historyPage({ ...page, data: page.data.map(t => ({ ...t, items: [] })) } as any, cursor);
          if (page.data.some(t => t.status === "inProgress")) return unavailable("Provider work is active.");
          turns.push(...page.data.map(t => t.id)); cursor = page.nextCursor;
          if (cursor === null) break;
        }
        if (cursor !== null || new Set(turns).size !== turns.length) return unavailable("Provider history exceeds rewind limits or repeats turns.");
        const index = turns.indexOf(point.turnId) - (point.kind === "before-message" ? 1 : 0);
        if (!turns.includes(point.turnId) || index < 0) return unavailable("Provider history lost or no supported predecessor for this boundary.");
        const captured = JSON.stringify([project, id, point, chat.directoryIdentity, turns]);
        if (!token && !commandId) {
          if (this.rewindChoices.size >= 100) this.rewindChoices.clear();
          const choice = randomUUID(); this.rewindChoices.set(choice, captured);
          return { status: "ready", token: choice, message: "Rewind conversation only. Current saved files, staging index, unsaved edits and unsent text stay in place. Later restore points may be abandoned. No turn will start." };
        }
        if (!token || !commandId || this.rewindChoices.get(token) !== captured) return unavailable("Selected boundary or provider history changed. Choose again.");
        check();
        const changedDirectory = await this.store.validateDirectory(chat);
        if (changedDirectory) return unavailable(changedDirectory);
        check();
        const result = { status: "uncertain" as const, token: null, message: "Rewind outcome uncertain. Inspect provider history; this command will never be replayed." };
        await this.store.database.command("rewindWrite", { commandId, body: { identity, captured, result } });
        this.rewindChoices.delete(token);
        const session = this.sessions.get(id);
        if (session) this.closeConnection(session);
        try {
          check();
          const response = await rpc.request("thread/fork", { threadId: point.threadId, lastTurnId: turns[index] }) as { thread?: { id?: string } };
          const threadId = response?.thread?.id;
          if (typeof threadId !== "string" || !threadId || threadId.length > 100 || threadId === point.threadId) throw Error("Provider historical context unavailable");
          await this.store.database.command("rewindWrite", { commandId, body: { identity, captured, result, providerThreadId: threadId } });
          await this.store.update(project, id, { threadId });
          const applied = { status: "applied" as const, token: null, message: "Conversation rewound. Current files and drafts retained. Send explicitly to continue." };
          await this.store.database.command("rewindWrite", { commandId, body: { identity, captured, providerThreadId: threadId, result: applied } });
          return applied;
        } catch (failure) {
          if ((failure as { rejected?: boolean }).rejected) {
            const rejected = unavailable("Provider historical context unavailable: " + String(failure));
            await this.store.database.command("rewindWrite", { commandId, body: { identity, captured, result: rejected } });
            return rejected;
          }
          return { ...result, message: result.message + " " + String(failure) };
        }
      } catch (failure) { return unavailable("Provider rewind unavailable: " + String(failure)); }
      finally { rpc?.close(); }
    });
  }
  async checkpointPoints(project: string | null, id: string, cursor: string | null) {
    await this.store.get(project, id);
    return this.store.database.command("checkpointPoints", { commandId: id, body: { cursor } }) as Promise<import("@escode/contracts").CheckpointPage>;
  }
  async inspectBoundary(project: string | null, id: string, boundary: string, cursor: string | null): Promise<import("@escode/contracts").BoundaryInspection> {
    const empty = { items: [], nextCursor: null, revision: "unavailable" };
    const unavailable = (message: string) => ({ page: empty, availability: "unavailable" as const, message });
    const chat = await this.store.get(project, id);
    // Discovery is metadata only; inspection never resumes or changes the live provider session.
    const batch = await this.store.database.command("checkpointPoints", { commandId: id, body: { boundary } }) as import("@escode/contracts").CheckpointPage;
    const point = batch.points[0];
    if (!point) throw Error("Checkpoint boundary unavailable");
    if (!point.threadId || point.threadId !== chat.threadId || !point.turnId) return unavailable("Provider boundary reference unavailable. File coverage is independent.");
    const error = await this.store.validateDirectory(chat);
    if (error) return unavailable(error);
    let rpc: CodexConnection | undefined;
    try {
      rpc = await this.connect(chat.checkout, () => {}, () => {});
      let next: string | null = null;
      let selected: HistoryPage | undefined;
      const seen = new Set<string | null>();
      // Bound provider work as well as each returned page; never substitute current context.
      for (let n = 0; n < 50; n++) {
        if (seen.has(next)) throw Error("Repeated provider history cursor");
        seen.add(next);
        const raw = await rpc.request("thread/turns/list", { threadId: point.threadId, cursor: next, limit: 20, itemsView: "full", sortDirection: "asc" }) as import("./vendor/codex/src/schema").V2ThreadTurnsListResponse;
        if (!Array.isArray(raw.data) || raw.data.length > 20) throw Error("Malformed provider history");
        const target = raw.data.findIndex(t => t.id === point.turnId);
        const data = target < 0 ? raw.data : raw.data.slice(0, target + (point.kind === "after-turn" ? 1 : 0));
        const page = this.historyPage({ data, nextCursor: target < 0 ? raw.nextCursor : null }, next);
        if (next === cursor) selected = page;
        if (target >= 0) return selected ? { page: selected, availability: "available", message: "Read-only provider history through the selected boundary. One bounded page; earlier provider history may be incomplete." } : unavailable("History page is outside the selected boundary.");
        next = page.nextCursor;
        if (next === null) break;
      }
      return unavailable("Provider history lost, unsupported, or boundary beyond the 1,000-turn inspection limit. Retained files do not establish conversation history.");
    } catch (failure) { return unavailable(`Provider inspection unavailable: ${String(failure)}`); }
    finally { rpc?.close(); }
  }
  async history(project: string | null, id: string, cursor: string | null): Promise<HistoryPage> {
    await this.store.get(project, id);
    const read = async () => {
      await this.connectSession(project, id);
      const s = this.session(project, id);
      const chat = await this.store.get(project, id);
      const error = await this.store.validateDirectory(chat);
      if (error) throw Error(error);
      if (!chat.threadId) return { items: [], nextCursor: null, revision: "empty" };
      if (s.threadId !== chat.threadId) throw Error("History provider binding changed");
      return this.readHistory(s, cursor);
    };
    if (this.transitions.get(id) === project && this.sessions.get(id)?.connection.status === "connected") return read();
    return this.inContext(project, id, read);
  }
  private async readHistory(s: Session, cursor: string | null): Promise<HistoryPage> {
    if (!s.connection.rpc) throw Error("History unavailable. Retry connection.");
    const page = await s.connection.rpc.request("thread/turns/list", {
      threadId: s.threadId, cursor, limit: 20, sortDirection: "asc", itemsView: "full",
    }) as import("./vendor/codex/src/schema").V2ThreadTurnsListResponse;
    return this.historyPage(page, cursor);
  }
  private historyPage(page: import("./vendor/codex/src/schema").V2ThreadTurnsListResponse, cursor: string | null): HistoryPage {
    if (!page || !Array.isArray(page.data) || page.data.length > 20 ||
        !(page.nextCursor === null || (typeof page.nextCursor === "string" && page.nextCursor.length <= 4096)) ||
        (cursor !== null && cursor === page.nextCursor)) throw Error("Malformed or repeated history page. History unavailable.");
    const items: ChatItem[] = [];
    let bytes = 0;
    for (const turn of page.data) {
      if (typeof turn?.id !== "string" || !Array.isArray(turn.items)) throw Error("Malformed history turn");
      for (const raw of turn.items) {
        if (typeof raw?.id !== "string" || typeof raw.type !== "string") throw Error("Malformed history item");
        const item = this.item(turn.id, raw);
        if (typeof item.text !== "string") throw Error("Malformed history body");
        bytes += Buffer.byteLength(JSON.stringify(item));
        if (bytes > 128 * 1024 || items.length >= 1000) throw Error("History page exceeds display limit. This portion is unavailable.");
        item.revision = createHash("sha256").update(JSON.stringify(item)).digest("hex");
        items.push(item);
      }
    }
    const body = JSON.stringify({ items, nextCursor: page.nextCursor });
    return { items, nextCursor: page.nextCursor, revision: createHash("sha256").update(body).digest("hex") };
  }
  private item(turnId: string, item: import("./vendor/codex/src/schema").V2ItemCompletedNotification__ThreadItem): ChatItem {
    const text =
      ("text" in item ? item.text : undefined) ??
      (item.type === "userMessage"
        ? item.content.map((c) => "text" in c ? c.text : "").join("\n")
        : item.type === "commandExecution"
          ? `${item.command}\n${item.aggregatedOutput ?? ""}`
          : JSON.stringify(item));
    return { id: item.id, turnId, type: item.type, text };
  }
  private event(s: Session, message: WireMessage) {
    const p = message.params;
    if (!p || p.threadId !== s.threadId) return;
    if (message.method === "serverRequest/resolved") {
      for (const [token, id] of s.requestIds)
        if (id === p.requestId) {
          s.requestIds.delete(token);
          s.requests = s.requests.filter((r) => r.token !== token);
        }
      return;
    }
    if (message.method === "thread/settings/updated") {
      const settings = p.threadSettings;
      s.settings = {
        model: settings.model,
        reasoning: settings.effort ?? null,
        approval: settings.approvalPolicy,
        sandbox: settings.sandboxPolicy,
      };
      return;
    }
    if (message.method === "model/rerouted" && p.turnId === s.turn.id && s.settings) {
      s.settings.model = p.toModel;
      return;
    }
    if (message.method === "turn/started") {
      if (s.completedTurnId === p.turn.id || s.completing || (s.turn.id && s.turn.id !== p.turn.id)) return;
      if (s.turn.phase === "stopping" && s.turn.id === p.turn.id) return;
      s.turn = { phase: "running", id: p.turn.id };
      return;
    }
    if (message.id !== undefined) {
      const standalone = message.method === "mcpServer/elicitation/request" && p.turnId == null;
      if (!standalone && (s.turn.phase === "idle" || s.turn.phase === "stopping" || p.turnId !== s.turn.id)) return;
      const allowed = [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "item/tool/requestUserInput",
        "item/permissions/requestApproval",
        "mcpServer/elicitation/request",
      ];
      if (!allowed.includes(message.method!)) {
        s.error = `Unsupported Codex request: ${message.method}. Stop and update escode before retrying.`;
        this.closeConnection(s);
        return;
      }
      if (s.connection.seenRequestIds?.has(message.id)) {
        for (const [token, wireId] of s.requestIds) if (wireId === message.id) { s.requestIds.delete(token); s.requests = s.requests.filter(r => r.token !== token); }
        s.error = "Provider reused a live request identifier. Stop and reconnect."; return; }
      if ((s.connection.seenRequestIds?.size ?? 0) >= 4096) { s.error = "Provider request identity capacity exhausted. Stop and reconnect before further requests."; return; }
      s.connection.seenRequestIds?.add(message.id);
      if (s.requests.length >= 32 || Buffer.byteLength(JSON.stringify([...s.requests, { params: p }])) > 64 * 1024) {
        s.error = "Provider request capacity exhausted. Request details unavailable; provider work continues and Stop remains available.";
        return;
      }
      const token = randomUUID();
      s.requestIds.set(token, message.id);
      s.requests.push({ token, method: message.method!, params: p } as LiveRequest);
      return;
    }
    if (message.method === "turn/completed" && p.turn.id === s.turn.id) {
      s.completedTurnId = p.turn.id;
      const completion = s.completion;
      s.completion = undefined;
      if (completion) {
        const status = p.turn.status ?? "unavailable";
        s.completing = captureTurnCheckpoint(this.store.database, completion.chat, s.threadId, completion.commandId,
          { id: completion.id, createdAt: completion.createdAt, turnId: p.turn.id, completion: status })
          .then(error => { if (error) s.error = error; })
          .finally(() => { s.completing = undefined; });
      }
      s.turn = { phase: "idle", id: null };
      s.requests = s.requests.filter((r) => ("turnId" in r.params ? r.params.turnId : null) == null);
      for (const token of s.requestIds.keys())
        if (!s.requests.some((r) => r.token === token)) s.requestIds.delete(token);
      if (p.turn.error) s.error = p.turn.error.message;
      return;
    }
    if (p.turnId !== s.turn.id) return;
    if (s.output.failed && (p.item || typeof p.delta === "string")) return;
    const items = [...(s.output.pending ?? s.items)];
    if (message.method === "item/started" || message.method === "item/completed") {
      const value = this.item(p.turnId, p.item);
      const index = items.findIndex((i) => i.id === value.id && i.turnId === value.turnId);
      if (index < 0) items.push(value);
      else items[index] = value;
    } else if (typeof p.delta === "string" && p.itemId) {
      let item = items.find((i) => i.id === p.itemId && i.turnId === p.turnId);
      if (!item) {
        item = {
          id: p.itemId,
          turnId: p.turnId,
          type: message.method?.includes("agentMessage") ? "agentMessage" : "activity",
          text: "",
        };
        items.push(item);
      }
      const index = items.indexOf(item);
      items[index] = { ...item, text: item.text + p.delta };
      delete items[index].revision;
    } else if (message.method === "error")
      s.error = p.error?.message ?? "Codex turn failed. Send a new message to continue.";
    if (p.item || typeof p.delta === "string") {
      try {
        if (items.length > 1000 || Buffer.byteLength(JSON.stringify(items)) > 128 * 1024)
          throw Error("Live display capacity exhausted");
        s.output.pending = items;
        this.persistOutput(s);
      } catch (error) {
        s.output.failed = true;
        s.error = `Live output partial/unavailable: ${String(error)}. Provider work continues; Stop remains available. Reload saved history after completion.`;
      }
    }
  }
  send(
    project: string | null,
    id: string,
    text: string,
    expected?: string,
    commandId?: string,
  ) {
    return this.inContext(project, id, () =>
      this.sendInContext(project, id, text, expected, commandId),
    );
  }
  private async sendInContext(
    project: string | null,
    id: string,
    text: string,
    expected?: string,
    commandId?: string,
  ) {
    const s = this.session(project, id);
    if (s.sending || s.completing || s.turn.phase !== "idle") throw Error("This chat already has an active turn.");
    if (!text.trim() || text.length > 100000)
      throw Error("Enter a message under 100,000 characters.");
    s.sending = true;
    s.preparation = { id: randomUUID(), cancelled: false };
    let launched = false;
    let sendIntent = false;
    let chat: Readonly<SavedChat> | undefined;
    try {
      let epoch = s.connection.epoch;
      const authority = this.environment?.guard(project);
      if (expected !== undefined && !authority) throw Error("Chat environment unavailable");
      const check = () => {
        if (this.sessions.get(id) !== s || s.connection.epoch !== epoch || s.preparation?.cancelled)
          throw Error(s.preparation?.cancelled ? "Preparation cancelled; reserved resources retained and may be partially prepared. Work was not submitted." : "Chat disconnected during authorization or preparation. Work was not submitted.");
        authority?.();
      };
      check();
      chat = Object.freeze(await this.store.get(project, id));
      if (chat.removed) throw Error("Checkout was removed. This chat cannot run.");
      await this.store.draft(project, id, text);
      if (expected !== undefined) {
        await this.expectState(project, id, expected, "Chat/context state changed. Inspect before sending again.");
        check();
      }
      if (this.environment) await this.authorizeSend(chat, check);
      check();
      if (chat.project === null) chat = await this.store.prepareScratch(chat);
      else if (this.environment) chat = await this.prepareSend(chat, check);
      check();
      if (chat.phase === "draft") {
        await this.store.update(project, id, { initialSend: "preparing" });
        check();
        await this.connectSession(project, id, chat);
        epoch = s.connection.epoch;
      }
      if (s.connection.status !== "connected" || !s.connection.rpc)
        throw Error("Retry connection before sending. Work was not resent.");
      this.store.validateWorktree(chat);
      this.store.validateScratch(chat);
      this.validateCheckout(s, chat.checkout);
      const directoryError = await this.store.validateDirectory(
        await this.store.get(project, id),
        true,
      );
      if (directoryError) throw Error(directoryError);
      if (s.preparation?.cancelled) throw Error("Preparation cancelled; reserved resources retained and may be partially prepared.");
      check();
      s.completedTurnId = undefined;
      s.turn = { phase: "starting", id: null };

      s.error = null;
      await this.store.update(project, id, {
        hasSent: true,
        ...(chat.phase ? { initialSend: "uncertain" as const } : {}),
      });
      sendIntent = true;
      check();
      s.error = await captureTurnCheckpoint(this.store.database, chat, s.threadId, commandId);
      check();
      s.preparation = undefined;
      this.store.validateWorktree(chat);
      this.store.validateScratch(chat);
      this.validateCheckout(s, chat.checkout);
      const completion = { chat, id: randomUUID(), createdAt: Date.now(), commandId };
      s.completion = completion;
      try {
        await this.store.database.command("checkpoint", { body: { id: completion.id, kind: "after-turn", chatId: chat.id,
          project: chat.project, checkout: chat.checkout, directoryIdentity: chat.directoryIdentity, threadId: s.threadId,
          commandId: commandId ?? null, createdAt: completion.createdAt, completion: "pending", availability: "unavailable",
          reason: "Completion not observed or capture interrupted; no automatic capture on restart", gitBase: null } });
      } catch (error) { s.error = `Completion boundary persistence failed: ${String(error)}`; }
      check();
      launched = true;
      const result = await s.connection.rpc.request("turn/start", {
        threadId: s.threadId,
        input: [{ type: "text", text, text_elements: [] }],
      }) as import("./vendor/codex/src/schema").V2TurnStartResponse;
      if (s.turn.phase === "starting") s.turn = { phase: "running", id: result.turn.id };
      await s.completing;
      await this.store.update(project, id, {
        draft: "",
        ...(chat.phase ? { initialSend: "accepted" as const } : {}),
      });
    } catch (error) {
      if (!chat) {
        if (!s.threadId && !s.connection.rpc && this.sessions.get(id) === s) this.sessions.delete(id);
        throw error;
      }
      this.closeConnection(s);
      const saved = await this.store.get(project, id);
      const rejected = (error as { rejected?: boolean }).rejected;
      if (
        saved.phase === "draft" ||
        (saved.phase === "bound" && ((launched && rejected) || (!launched && sendIntent)))
      )
        await this.store.update(project, id, { initialSend: "unaccepted" });
      s.error =
        (error instanceof Error ? error.message : String(error)) +
        (launched && !rejected
          ? " Message acceptance is uncertain. Prompt and provider identity are retained. Retry reloads history without resending; inspect history before explicitly sending another message."
          : " Message was not submitted. Prompt and any known provider identity are retained.");
      throw Object.assign(Error(s.error), { rejected: !!rejected });
    } finally {
      s.sending = false;
      s.preparation = undefined;
    }
    return this.snapshot(project, id);
  }
  liveStopTarget(project: string | null, id: string) {
    const s = this.sessions.get(id);
    if (!s || s.project !== project || !(s.preparation || s.connection.status === "connected" && s.turn.phase !== "idle" && s.turn.id))
      throw Error("No interruptible active work.");
    return this.snapshot(project, id).controlTarget;
  }
  async stop(project: string | null, id: string, target?: string) {
    if (!this.store.database.unavailable) await this.store.get(project, id);
    else this.liveStopTarget(project, id);
    const s = this.session(project, id, false);
    if (target !== undefined && target !== this.snapshot(project, id).controlTarget) throw Object.assign(Error("Stale Stop target."), { rejected: true });
    if (s.preparation) { s.preparation.cancelled = true; s.error = "Preparation cancelled; reserved resources retained and may be partially prepared."; return; }
    if (s.connection.status !== "connected" || s.turn.phase === "idle" || !s.turn.id) throw Error("No interruptible active turn.");
    s.turn.phase = "stopping";
    this.clearRequests(s);
    await s.connection.rpc!.request("turn/interrupt", { threadId: s.threadId, turnId: s.turn.id });
  }
  async answer(project: string | null, id: string, token: string, answer: unknown) {
    await this.store.get(project, id);
    const s = this.session(project, id, false);
    const request = s.requests.find((r) => r.token === token),
      wireId = s.requestIds.get(token);
    if (
      !request ||
      wireId === undefined ||
      s.connection.status !== "connected" ||
      (("turnId" in request.params ? request.params.turnId : null) != null && (s.turn.phase === "idle" || ("turnId" in request.params ? request.params.turnId : null) !== s.turn.id))
    )
      throw Object.assign(Error("Stale or mismatched live request. Reopen the originating chat."), { rejected: true });
    let result: unknown;
    if (request.method === "mcpServer/elicitation/request") {
      if (!answer || typeof answer !== "object" || Array.isArray(answer))
        throw Error("Invalid input response.");
      const value = answer as { action?: unknown; content?: unknown };
      if (!["accept", "decline", "cancel"].includes(String(value.action)))
        throw Error("Invalid input action.");
      if (
        value.action === "accept" &&
        request.params.mode !== "url" &&
        (!value.content || typeof value.content !== "object" || Array.isArray(value.content))
      )
        throw Error("Provide the requested information as an object.");
      result = {
        action: value.action,
        content: value.action === "accept" ? (value.content ?? null) : null,
        _meta: null,
      };
    } else if (request.method === "item/tool/requestUserInput") {
      if (!answer || typeof answer !== "object" || Array.isArray(answer))
        throw Error("Answer each question.");
      const answers: Record<string, { answers: string[] }> = {};
      for (const q of request.params.questions) {
        const value = (answer as Record<string, unknown>)[q.id];
        if (typeof value !== "string" || !value.trim() || value.length > 100000)
          throw Error("Answer each question.");
        answers[q.id] = { answers: [value] };
      }
      result = { answers };
    } else {
      if (answer !== "accept" && answer !== "decline" && answer !== "cancel")
        throw Error("Invalid approval response.");
      result =
        request.method === "item/permissions/requestApproval"
          ? { permissions: answer === "accept" ? request.params.permissions : {}, scope: "turn" }
          : { decision: answer };
    }
    s.requestIds.delete(token);
    s.requests = s.requests.filter((r) => r.token !== token);
    s.connection.rpc!.respond(wireId, result);
  }
  disconnect(project: string | null, id: string) {
    const s = this.session(project, id, false);
    if (this.transitions.has(id) || s.turn.phase !== "idle" || s.connection.opening || s.sending)
      throw Error("Stop active work before reconnecting.");
    this.closeConnection(s);
  }
  checkoutActive(project: string | null, id: string) {
    const s = this.sessions.get(id);
    return (
      this.transitions.has(id) ||
      (!!s && s.project === project && !!(s.turn.phase !== "idle" || s.connection.opening || s.sending || s.requests.length))
    );
  }
  async markUnavailable(project: string | null, id: string) {
    return this.inContext(project, id, async () => {
      await this.store.get(project, id);
      const s = this.session(project, id);
      this.closeConnection(s);
      s.error =
        "Checkout removal requested. History and drafts are retained; this chat cannot run.";
      await this.store.update(project, id, { removed: true });
    });
  }
  active(project?: string | null) {
    return (
      [...this.transitions.values()].some((p) => project === undefined || p === project) ||
      [...this.sessions.values()].some(
        (s) =>
          (project === undefined || s.project === project) &&
          (s.turn.phase !== "idle" || s.connection.opening || s.sending || s.requests.length),
      )
    );
  }
  async shutdown(project?: string | null) {
    const sessions = [...this.sessions.values()].filter(
      (s) => project === undefined || s.project === project,
    );
    await Promise.all(
      sessions.map(async (s) => {
        if (s.turn.phase !== "idle" && s.turn.id && s.connection.rpc) {
          await Promise.race([
            s.connection.rpc
              .request("turn/interrupt", { threadId: s.threadId, turnId: s.turn.id })
              .catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 500)),
          ]);
        }
        // Invalidate setup before waiting: an in-flight connector must close its eventual RPC.
        this.closeConnection(s);
        await s.connection.opening?.catch(() => {});
        s.connection.rpc?.close();
        await s.connection.rpc?.finished;
        await s.output.writing;
        this.endConnection(s);
      }),
    );
  }
  close() {
    for (const s of this.sessions.values()) this.closeConnection(s);
  }
}
