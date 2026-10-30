import { LiveSpool } from "./live-spool";
import type { HistoryPage } from "@escode/contracts";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { Chats, type SavedChat } from "./chat";
import { codexDiagnostic, connectCodex, type CodexConnection, type WireMessage } from "./tools";
export type ChatItem = { id: string; turnId: string; type: string; text: string; revision?: string };
export type LiveRequest = { token: string; method: string; params: any };
export type ChatSnapshot = {
  project: string | null;
  chatId: string;
  threadId: string | null;
  connected: boolean;
  busy: boolean;
  turnId: string | null;
  settings: any;
  items: ChatItem[];
  requests: LiveRequest[];
  error: string | null;
  contextError?: string | null;
  history?: { nextCursor: string | null; revision: string };
};
type Session = ChatSnapshot & {
  rpc?: CodexConnection;
  epoch: string;
  opening?: Promise<void>;
  requestIds: Map<string, string | number>;
  stopping: boolean;
  outputFailed?: boolean;
  recovered?: boolean;
  recovering?: Promise<void>;
  outputItems?: ChatItem[];
  writing?: Promise<void>;
  sending?: boolean;
  checkoutIdentity?: { path: string; dev: number; ino: number };
};
export class ChatService {
  private sessions = new Map<string, Session>();
  private revisions = new Map<string, number>();
  revision(id: string) { return this.revisions.get(id) ?? 0; }
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
  ) {}
  private writers = 0;
  private persistOutput(s: Session) {
    if (s.writing) return;
    if (this.writers >= 16) { s.outputItems = undefined; s.outputFailed = true; s.error = "Live output partial: persistence admission exhausted. Stop remains available."; return; }
    this.writers++;
    s.writing = (async () => {
      try {
        while (s.outputItems) {
          const items = s.outputItems;
          if (s.threadId) await this.spool.write(s.chatId, s.threadId, items, false);
          s.items = items;
          if (s.outputItems === items) s.outputItems = undefined;
        }
      } catch (error) {
        s.outputItems = undefined; s.outputFailed = true;
        s.error = `Live output partial/unavailable: ${String(error)}. Provider work continues; Stop remains available. Reload saved history after completion.`;
      } finally { this.writers--; s.writing = undefined; }
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
        connected: false,
        busy: false,
        turnId: null,
        settings: null,
        items: [],
        requests: [],
        requestIds: new Map(),
        epoch: randomUUID(),
        error: null,
        stopping: false,
      };
      if (retain) this.sessions.set(id, s);
    }
    return s;
  }
  summary(project: string | null, id: string) {
    const s = this.sessions.get(id);
    return { busy: !!(s?.busy || s?.sending || s?.opening || this.transitions.has(id)),
      needsInput: !!s?.requests.length, unavailable: !!s?.error };
  }
  snapshot(project: string | null, id: string): ChatSnapshot {
    const s = this.session(project, id, false);
    return structuredClone({
      project,
      chatId: id,
      threadId: s.threadId,
      connected: s.connected,
      busy: s.busy,
      turnId: s.turnId,
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
    if (!s.rpc && chat.threadId) await this.recoverOutput(s, chat.threadId);
    const snapshot = this.snapshot(project, id);
    snapshot.contextError =
      chat.phase === "draft" &&
      ((chat.project === null && !chat.scratch) || (chat.worktree && !chat.worktree.reservation))
        ? chat.availabilityError
        : await this.store.validateDirectory(chat);
    return snapshot;
  }
  private async recoverOutput(s: Session, threadId: string) {
    if (s.recovering) return s.recovering;
    if (s.recovered) return;
    s.recovered = true;
    s.threadId = threadId;
    s.recovering = (async () => {
      try {
        const saved = await this.spool.read(s.chatId, threadId);
        if (saved) { s.items = [...saved.items]; s.error = "Recovered live output; Retry to inspect provider history. Work was not resumed."; }
      } catch { s.error = "Live output unavailable: incomplete spool. Provider identity retained; Retry explicitly."; }
    })();
    try { await s.recovering; } finally { s.recovering = undefined; }
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
    return this.inContext(project, id, async () => {
      const chat = await this.store.context(project, id, target, checkout, worktree);
      const previous = this.sessions.get(id);
      if (previous) {
        previous.epoch = randomUUID();
        previous.rpc?.close();
      }
      this.sessions.delete(id);
      return chat;
    });
  }
  open(project: string | null, id: string) {
    return this.inContext(project, id, () => this.connectSession(project, id));
  }
  private async connectSession(
    project: string | null,
    id: string,
    authorizedDraft?: Readonly<SavedChat>,
  ) {
    const s = this.session(project, id);
    if (s.opening) {
      await s.opening;
      return this.snapshot(project, id);
    }
    if (s.connected) {
      const error = await this.store.validateDirectory(await this.store.get(project, id), true);
      if (error) throw Error(error);
      return this.snapshot(project, id);
    }
    s.opening = (async () => {
      const epoch = randomUUID();
      s.epoch = epoch;
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
        if (s.epoch !== epoch) throw Error("Project closed while loading saved chat.");
        if (chat.phase === "draft" && !authorizedDraft) {
          if (chat.project !== null && !chat.worktree) this.validateCheckout(s, chat.checkout);
          else if (chat.worktree?.reservation) this.store.validateWorktree(chat);
          else if (chat.scratch) this.store.validateScratch(chat);
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
            if (s.epoch === epoch) this.event(s, event);
          },
          (error) => {
            if (s.epoch !== epoch) return;
            s.epoch = randomUUID();
            s.connected = false;
            s.busy = false;
            s.turnId = null;
            s.requests = [];
            s.requestIds.clear();
            s.error = error.message;
          },
        );
        if (s.epoch !== epoch) {
          rpc.close();
          throw Error("Project closed during connection.");
        }
        s.rpc = rpc;
        const account = await rpc.request("account/read", { refreshToken: false });
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
        );
        // Retain returned identity even if later response validation or persistence fails.
        if (
          typeof result.thread?.id === "string" &&
          (!resume || result.thread.id === chat.threadId)
        ) {
          s.threadId = result.thread.id;
          await this.store.update(project, id, { threadId: s.threadId });
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
          await s.writing;
          const page = await this.readHistory(s, null);
          await s.writing;
          const retained = s.items.filter(item => !page.items.some(saved => saved.id === item.id && saved.turnId === item.turnId && saved.text.startsWith(item.text)));
          s.items = [...page.items.filter(item => !retained.some(value => value.id === item.id && value.turnId === item.turnId)), ...retained];
          if (!retained.length) s.error = null;
          s.outputFailed = false;
          s.history = { nextCursor: page.nextCursor, revision: page.revision };
        }
        if (s.epoch !== epoch) throw Error("Codex disconnected during setup. Retry connection.");
        this.store.validateWorktree(chat);
        this.store.validateScratch(chat);
        this.validateCheckout(s, chat.checkout);
        s.connected = true;
      } catch (error) {
        if (!chat && !s.threadId && !s.rpc && this.sessions.get(id) === s) this.sessions.delete(id);
        if ((error as { rejected?: boolean }).rejected) {
          const saved = await this.store.get(project, id);
          if (saved.initialSend === "creating" && !saved.threadId)
            await this.store.update(project, id, { phase: "draft", initialSend: "unaccepted" });
        }
        rpc?.close();
        await rpc?.finished;
        s.connected = false;
        const message = error instanceof Error ? error.message : String(error);
        s.error = rpc?.installation
          ? codexDiagnostic(rpc.installation.path, rpc.installation.version, message)
          : message;
        throw Error(s.error);
      }
    })();
    try {
      await s.opening;
    } finally {
      s.opening = undefined;
    }
    return this.snapshot(project, id);
  }
  async history(project: string | null, id: string, cursor: string | null): Promise<HistoryPage> {
    await this.store.get(project, id);
    return this.inContext(project, id, async () => {
      await this.connectSession(project, id);
      const s = this.session(project, id);
      const chat = await this.store.get(project, id);
      const error = await this.store.validateDirectory(chat);
      if (error) throw Error(error);
      if (!chat.threadId) return { items: [], nextCursor: null, revision: "empty" };
      if (s.threadId !== chat.threadId) throw Error("History provider binding changed");
      return this.readHistory(s, cursor);
    });
  }
  private async readHistory(s: Session, cursor: string | null): Promise<HistoryPage> {
    if (!s.rpc) throw Error("History unavailable. Retry connection.");
    const page = await s.rpc.request("thread/turns/list", {
      threadId: s.threadId, cursor, limit: 20, sortDirection: "asc", itemsView: "full",
    });
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
  private item(turnId: string, item: any): ChatItem {
    const text =
      item.text ??
      (item.type === "userMessage"
        ? item.content.map((c: any) => c.text ?? "").join("\n")
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
    if (message.method === "model/rerouted" && p.turnId === s.turnId && s.settings) {
      s.settings.model = p.toModel;
      return;
    }
    if (message.method === "turn/started") {
      s.turnId = p.turn.id;
      s.busy = true;
      return;
    }
    if (message.id !== undefined) {
      const standalone = message.method === "mcpServer/elicitation/request" && p.turnId == null;
      if (!standalone && (!s.busy || s.stopping || p.turnId !== s.turnId)) return;
      const allowed = [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "item/tool/requestUserInput",
        "item/permissions/requestApproval",
        "mcpServer/elicitation/request",
      ];
      if (!allowed.includes(message.method!)) {
        s.error = `Unsupported Codex request: ${message.method}. Stop and update escode before retrying.`;
        s.rpc?.close();
        return;
      }
      if (s.requests.length >= 32 || Buffer.byteLength(JSON.stringify([...s.requests, { params: p }])) > 64 * 1024) {
        s.error = "Provider request capacity exhausted. Request details unavailable; provider work continues and Stop remains available.";
        return;
      }
      const token = randomUUID();
      s.requestIds.set(token, message.id);
      s.requests.push({ token, method: message.method!, params: p });
      return;
    }
    if (message.method === "turn/completed" && p.turn.id === s.turnId) {
      s.busy = false;
      s.turnId = null;
      s.stopping = false;
      s.requests = s.requests.filter((r) => r.params.turnId == null);
      for (const token of s.requestIds.keys())
        if (!s.requests.some((r) => r.token === token)) s.requestIds.delete(token);
      if (p.turn.error) s.error = p.turn.error.message;
      return;
    }
    if (p.turnId !== s.turnId) return;
    if (s.outputFailed && (p.item || typeof p.delta === "string")) return;
    const items = [...(s.outputItems ?? s.items)];
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
        s.outputItems = items;
        this.persistOutput(s);
      } catch (error) {
        s.outputFailed = true;
        s.error = `Live output partial/unavailable: ${String(error)}. Provider work continues; Stop remains available. Reload saved history after completion.`;
      }
    }
  }
  send(
    project: string | null,
    id: string,
    text: string,
    authorize: (chat: Readonly<SavedChat>) => Promise<void> = async () => {},
    prepare: (chat: Readonly<SavedChat>) => Promise<Readonly<SavedChat>> = async (chat) => chat,
  ) {
    return this.inContext(project, id, () =>
      this.sendInContext(project, id, text, authorize, prepare),
    );
  }
  private async sendInContext(
    project: string | null,
    id: string,
    text: string,
    authorize: (chat: Readonly<SavedChat>) => Promise<void>,
    prepare: (chat: Readonly<SavedChat>) => Promise<Readonly<SavedChat>>,
  ) {
    const s = this.session(project, id);
    if (s.sending || s.busy) throw Error("This chat already has an active turn.");
    if (!text.trim() || text.length > 100000)
      throw Error("Enter a message under 100,000 characters.");
    s.sending = true;
    let launched = false;
    let sendIntent = false;
    let chat: Readonly<SavedChat> | undefined;
    try {
      const epoch = s.epoch;
      chat = Object.freeze(await this.store.get(project, id));
      if (chat.removed) throw Error("Checkout was removed. This chat cannot run.");
      await this.store.draft(project, id, text);
      await authorize(chat);
      if (this.sessions.get(id) !== s || s.epoch !== epoch)
        throw Error("Chat disconnected during authorization. Work was not submitted.");
      if (chat.project === null) chat = await this.store.prepareScratch(chat);
      else chat = await prepare(chat);
      if (this.sessions.get(id) !== s || s.epoch !== epoch)
        throw Error("Chat disconnected during authorization. Work was not submitted.");
      if (chat.phase === "draft") {
        await this.store.update(project, id, { initialSend: "preparing" });
        if (this.sessions.get(id) !== s || s.epoch !== epoch)
          throw Error("Chat disconnected during preparation. Work was not submitted.");
        await this.connectSession(project, id, chat);
      }
      if (!s.connected || !s.rpc)
        throw Error("Retry connection before sending. Work was not resent.");
      this.store.validateWorktree(chat);
      this.store.validateScratch(chat);
      this.validateCheckout(s, chat.checkout);
      const directoryError = await this.store.validateDirectory(
        await this.store.get(project, id),
        true,
      );
      if (directoryError) throw Error(directoryError);
      s.busy = true;
      s.stopping = false;
      s.error = null;
      await this.store.update(project, id, {
        hasSent: true,
        ...(chat.phase ? { initialSend: "uncertain" as const } : {}),
      });
      sendIntent = true;
      this.store.validateWorktree(chat);
      this.store.validateScratch(chat);
      this.validateCheckout(s, chat.checkout);
      launched = true;
      const result = await s.rpc.request("turn/start", {
        threadId: s.threadId,
        input: [{ type: "text", text, text_elements: [] }],
      });
      if (s.busy && !s.turnId) s.turnId = result.turn.id;
      await this.store.update(project, id, {
        draft: "",
        ...(chat.phase ? { initialSend: "accepted" as const } : {}),
      });
    } catch (error) {
      if (!chat) {
        if (!s.threadId && !s.rpc && this.sessions.get(id) === s) this.sessions.delete(id);
        throw error;
      }
      s.rpc?.close();
      s.connected = false;
      s.busy = false;
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
    }
    return this.snapshot(project, id);
  }
  async stop(project: string | null, id: string) {
    await this.store.get(project, id);
    const s = this.session(project, id, false);
    if (!s.connected || !s.busy || !s.turnId) throw Error("No interruptible active turn.");
    s.stopping = true;
    s.requests = [];
    s.requestIds.clear();
    await s.rpc!.request("turn/interrupt", { threadId: s.threadId, turnId: s.turnId });
  }
  async answer(project: string | null, id: string, token: string, answer: unknown) {
    const chat = await this.store.get(project, id);
    const s = this.session(project, id, false);
    const request = s.requests.find((r) => r.token === token),
      wireId = s.requestIds.get(token);
    if (
      !request ||
      wireId === undefined ||
      !s.connected ||
      (request.params.turnId != null && (!s.busy || request.params.turnId !== s.turnId))
    )
      throw Error("Stale or mismatched live request. Reopen the originating chat.");
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
    this.store.validateWorktree(chat);
    this.store.validateScratch(chat);
    this.validateCheckout(s, chat.checkout);
    s.rpc!.respond(wireId, result);
    s.requestIds.delete(token);
    s.requests = s.requests.filter((r) => r.token !== token);
  }
  disconnect(project: string | null, id: string) {
    const s = this.session(project, id, false);
    if (this.transitions.has(id) || s.busy || s.opening || s.sending)
      throw Error("Stop active work before reconnecting.");
    s.rpc?.close();
  }
  checkoutActive(project: string | null, id: string) {
    const s = this.sessions.get(id);
    return (
      this.transitions.has(id) ||
      (!!s && s.project === project && !!(s.busy || s.opening || s.sending || s.requests.length))
    );
  }
  async markUnavailable(project: string | null, id: string) {
    return this.inContext(project, id, async () => {
      await this.store.get(project, id);
      const s = this.session(project, id);
      s.rpc?.close();
      s.connected = false;
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
          (s.busy || s.opening || s.sending || s.requests.length),
      )
    );
  }
  async shutdown(project?: string | null) {
    const sessions = [...this.sessions.values()].filter(
      (s) => project === undefined || s.project === project,
    );
    await Promise.all(
      sessions.map(async (s) => {
        if (s.busy && s.turnId && s.rpc) {
          await Promise.race([
            s.rpc
              .request("turn/interrupt", { threadId: s.threadId, turnId: s.turnId })
              .catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 500)),
          ]);
        }
        // Invalidate setup before waiting: an in-flight connector must close its eventual RPC.
        s.epoch = randomUUID();
        s.rpc?.close();
        await s.opening?.catch(() => {});
        s.rpc?.close();
        await s.rpc?.finished;
        await s.writing;
        s.connected = false;
        s.busy = false;
        s.turnId = null;
        s.requests = [];
        s.requestIds.clear();
      }),
    );
  }
  close() {
    for (const s of this.sessions.values()) s.rpc?.close();
  }
}
