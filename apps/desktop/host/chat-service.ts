import { randomUUID } from "node:crypto";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { Chats } from "./chat";
import { codexDiagnostic, connectCodex, type CodexConnection, type WireMessage } from "./tools";
export type ChatItem = { id: string; turnId: string; type: string; text: string };
export type LiveRequest = { token: string; method: string; params: any };
export type ChatSnapshot = {
  project: string;
  chatId: string;
  threadId: string | null;
  connected: boolean;
  busy: boolean;
  turnId: string | null;
  settings: any;
  items: ChatItem[];
  requests: LiveRequest[];
  error: string | null;
};
type Session = ChatSnapshot & {
  rpc?: CodexConnection;
  epoch: string;
  opening?: Promise<void>;
  requestIds: Map<string, string | number>;
  stopping: boolean;
  checkoutIdentity?: { path: string; dev: number; ino: number };
};
export class ChatService {
  private sessions = new Map<string, Session>();
  constructor(
    private store: Chats,
    private connect = connectCodex,
  ) {}
  list(project: string) {
    return this.store.list(project);
  }
  create(project: string, checkout = project) {
    return this.store.create(project, checkout);
  }
  draft(project: string, id: string, text: string) {
    return this.store.draft(project, id, text);
  }
  private session(project: string, id: string) {
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
      this.sessions.set(id, s);
    }
    return s;
  }
  snapshot(project: string, id: string): ChatSnapshot {
    const s = this.session(project, id);
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
    });
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
      s.rpc?.close();
      s.error =
        "Checkout unavailable or changed. Restore access to the original directory, then Retry connection. History and drafts are retained; work was not resent.";
      throw Error(s.error);
    }
  }
  async open(project: string, id: string) {
    const s = this.session(project, id);
    if (s.opening) {
      await s.opening;
      return this.snapshot(project, id);
    }
    if (s.connected) return this.snapshot(project, id);
    s.opening = (async () => {
      const epoch = randomUUID();
      s.epoch = epoch;
      s.error = null;
      let rpc: CodexConnection | undefined;
      try {
        const chat = await this.store.get(project, id);
        if (chat.removed)
          throw Error(
            "Checkout was removed. History and drafts are retained; this chat cannot run.",
          );
        if (s.epoch !== epoch) throw Error("Project closed while loading saved chat.");
        this.validateCheckout(s, chat.checkout);
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
        // Codex does not persist an empty thread until its first turn.
        const resume = Boolean(chat.threadId && chat.hasSent !== false);
        this.validateCheckout(s, chat.checkout);
        const result = await rpc.request(
          resume ? "thread/resume" : "thread/start",
          resume
            ? { threadId: chat.threadId, cwd: chat.checkout, excludeTurns: true }
            : { cwd: chat.checkout },
        );
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
        await this.store.update(project, id, { threadId: s.threadId });
        s.settings = {
          model: result.model,
          reasoning: result.reasoningEffort,
          approval: result.approvalPolicy,
          sandbox: result.sandbox,
        };
        if (resume) {
          const items: ChatItem[] = [];
          let cursor: string | null = null;
          const seen = new Set<string>();
          do {
            const page = await rpc.request("thread/turns/list", {
              threadId: s.threadId,
              cursor,
              sortDirection: "asc",
              itemsView: "full",
            });
            for (const turn of page.data)
              for (const item of turn.items) items.push(this.item(turn.id, item));
            cursor = page.nextCursor;
            if (cursor && seen.has(cursor))
              throw Error("Codex repeated a history cursor. Retry connection.");
            if (cursor) seen.add(cursor);
          } while (cursor);
          s.items = items;
        }
        if (s.epoch !== epoch) throw Error("Codex disconnected during setup. Retry connection.");
        this.validateCheckout(s, chat.checkout);
        s.connected = true;
      } catch (error) {
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
  private item(turnId: string, item: any): ChatItem {
    const text =
      item.text ??
      (item.type === "userMessage"
        ? item.content.map((c: any) => c.text ?? "").join("\n")
        : item.type === "commandExecution"
          ? `${item.command}\n${item.aggregatedOutput ?? ""}`
          : JSON.stringify(item, null, 2));
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
        reasoning: settings.effort,
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
    if (message.method === "item/started" || message.method === "item/completed") {
      const value = this.item(p.turnId, p.item);
      const index = s.items.findIndex((i) => i.id === value.id && i.turnId === value.turnId);
      if (index < 0) s.items.push(value);
      else s.items[index] = value;
    } else if (typeof p.delta === "string" && p.itemId) {
      let item = s.items.find((i) => i.id === p.itemId && i.turnId === p.turnId);
      if (!item) {
        item = {
          id: p.itemId,
          turnId: p.turnId,
          type: message.method?.includes("agentMessage") ? "agentMessage" : "activity",
          text: "",
        };
        s.items.push(item);
      }
      item.text += p.delta;
    } else if (message.method === "error")
      s.error = p.error?.message ?? "Codex turn failed. Send a new message to continue.";
  }
  async send(project: string, id: string, text: string) {
    const chat = await this.store.get(project, id);
    if (chat.removed) throw Error("Checkout was removed. This chat cannot run.");
    const s = this.session(project, id);
    if (!s.connected || !s.rpc)
      throw Error("Retry connection before sending. Work was not resent.");
    if (s.busy) throw Error("This chat already has an active turn.");
    if (!text.trim() || text.length > 100000)
      throw Error("Enter a message under 100,000 characters.");
    this.validateCheckout(s, chat.checkout);
    s.busy = true;
    s.stopping = false;
    s.error = null;
    try {
      await this.store.update(project, id, { hasSent: true });
      this.validateCheckout(s, chat.checkout);
      const result = await s.rpc.request("turn/start", {
        threadId: s.threadId,
        input: [{ type: "text", text, text_elements: [] }],
      });
      // turn/started and even turn/completed may arrive before the RPC response.
      if (s.busy && !s.turnId) s.turnId = result.turn.id;
      await this.store.draft(project, id, "");
    } catch (error) {
      s.rpc.close();
      throw error;
    }
    return this.snapshot(project, id);
  }
  async stop(project: string, id: string) {
    await this.store.get(project, id);
    const s = this.session(project, id);
    if (!s.connected || !s.busy || !s.turnId) throw Error("No interruptible active turn.");
    s.stopping = true;
    s.requests = [];
    s.requestIds.clear();
    await s.rpc!.request("turn/interrupt", { threadId: s.threadId, turnId: s.turnId });
  }
  async answer(project: string, id: string, token: string, answer: unknown) {
    const chat = await this.store.get(project, id);
    const s = this.session(project, id);
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
    this.validateCheckout(s, chat.checkout);
    s.rpc!.respond(wireId, result);
    s.requestIds.delete(token);
    s.requests = s.requests.filter((r) => r.token !== token);
  }
  disconnect(project: string, id: string) {
    const s = this.session(project, id);
    if (s.busy || s.opening) throw Error("Stop active work before reconnecting.");
    s.rpc?.close();
  }
  checkoutActive(project: string, id: string) {
    const s = this.sessions.get(id);
    return !!s && s.project === project && !!(s.busy || s.opening || s.requests.length);
  }
  async markUnavailable(project: string, id: string) {
    const s = this.session(project, id);
    s.rpc?.close();
    s.connected = false;
    s.error = "Checkout removal requested. History and drafts are retained; this chat cannot run.";
    await this.store.update(project, id, { removed: true });
  }
  active(project?: string) {
    return [...this.sessions.values()].some(
      (s) => (!project || s.project === project) && (s.busy || s.opening || s.requests.length),
    );
  }
  async shutdown(project?: string) {
    const sessions = [...this.sessions.values()].filter((s) => !project || s.project === project);
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
