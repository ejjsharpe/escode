import { useSyncExternalStore } from "react";
import type { ChatSummary } from "@escode/contracts";
import type { ChatSnapshot } from "../host/chat-service";

// All visible summary consumers share one socket; the last consumer releases it.
let catalogue: ChatSummary[] = [];
let summaryError = "";
const consumers = new Set<() => void>();
let release: (() => void) | undefined;
function subscribe(listener: () => void) {
  consumers.add(listener);
  release ??= window.escode.chatSummaries(value => {
    catalogue = [...value.chats];
    summaryError = "";
    for (const consumer of consumers) consumer();
  }, error => {
    summaryError = error;
    for (const consumer of consumers) consumer();
  });
  return () => { consumers.delete(listener); if (!consumers.size) { release?.(); release = undefined; } };
}
export function useChatSummaries() {
  const chats = useSyncExternalStore(subscribe, () => catalogue);
  const error = useSyncExternalStore(subscribe, () => summaryError);
  return { chats, error };
}
// Renderer lifetime, independent of any conversation view. Sessions remain host-owned.
class ProjectChats {
  private listeners = new Set<() => void>();
  private state = {
    chats: [] as ChatSummary[],
    drafts: {} as Record<string, string>,
    history: {} as Record<string, import("@escode/contracts").HistoryPage>,
    snapshots: {} as Record<string, ChatSnapshot>,
    pending: {} as Record<string, boolean>,
    responding: {} as Record<string, boolean>,
    errors: {} as Record<string, string>,
  };
  private opening = new Map<string, Promise<void>>();
  private polling = false;
  private observed = new Map<string, number>();
  private release?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private project: string | null) {}
  subscribe = (listener: () => void) => {
    if (!this.listeners.size) {
      const apply = () => {
        const chats = catalogue.filter(c => c.project === this.project);
        const drafts = Object.fromEntries(Object.entries(this.state.drafts).filter(([id]) => chats.some(c => c.id === id)));
        this.update({ chats, drafts, errors: { ...this.state.errors, "": summaryError } });
      };
      this.release = subscribe(apply);
      apply();
    }
    this.listeners.add(listener);
    this.timer ??= setInterval(() => void this.refresh(), 300);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearInterval(this.timer);
        this.timer = undefined;
        this.release?.();
      }
    };
  };
  snapshot = () => this.state;
  private update(next: Partial<typeof this.state>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  private report(id: string, error: unknown) {
    this.update({
      errors: {
        ...this.state.errors,
        [id]: error instanceof Error ? error.message : String(error),
      },
    });
  }
  async load() {
    // Mutations converge on the next complete host projection.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { stop(); reject(Error("Chat summaries unavailable. Retry connection.")); }, 10000);
      const stop = subscribe(() => { clearTimeout(timer); stop(); resolve(); });
    });
  }
  observe(id: string) {
    this.observed.set(id, (this.observed.get(id) ?? 0) + 1);
    this.update({ snapshots: Object.fromEntries(Object.entries(this.state.snapshots).filter(([key]) => this.observed.has(key))) });
    void this.refresh();
    return () => {
      const count = (this.observed.get(id) ?? 1) - 1;
      if (count) this.observed.set(id, count);
      else {
        this.observed.delete(id);
        const snapshots = { ...this.state.snapshots }, history = { ...this.state.history };
        delete snapshots[id]; delete history[id];
        this.update({ snapshots, history });
      }
    };
  }
  async refresh() {
    if (this.polling) return;
    this.polling = true;
    try {
      await Promise.all(
        [...this.observed.keys()].map(async (id) => {
          const chat = { id };
          const snapshot = await window.escode.chat("snapshot", this.project, chat.id);
          if (!this.observed.has(chat.id)) return;
          const responding = { ...this.state.responding };
          for (const request of this.state.snapshots[chat.id]?.requests ?? [])
            if (!snapshot.requests.some((r) => r.token === request.token))
              delete responding[request.token];
          this.update({ snapshots: { ...this.state.snapshots, [chat.id]: snapshot }, responding });
        }),
      );
    } catch (e) {
      this.report("", e);
    } finally {
      this.polling = false;
    }
  }
  history(id: string, cursor: string | null) {
    return this.run(id, async () => {
      const page = await window.escode.chatHistory(this.project, id, cursor);
      if (this.observed.has(id)) this.update({ history: { ...this.state.history, [id]: page } });
    });
  }
  open(id: string) {
    const existing = this.opening.get(id);
    if (existing) return existing;
    const operation = this.run(id, async () => {
      if (!(id in this.state.drafts)) {
        const text = await window.escode.chat("composer", this.project, id);
        if (!(id in this.state.drafts)) this.update({ drafts: { ...this.state.drafts, [id]: text } });
      }
      await window.escode.chat("open", this.project, id);
    }).finally(() => this.opening.delete(id));
    this.opening.set(id, operation);
    return operation;
  }
  async run(id: string, action: () => Promise<unknown>) {
    if (this.state.pending[id]) return;
    this.update({
      pending: { ...this.state.pending, [id]: true },
      errors: { ...this.state.errors, [id]: "" },
    });
    try {
      await action();
    } catch (e) {
      this.report(id, e);
    } finally {
      this.update({ pending: { ...this.state.pending, [id]: false } });
      void this.load()
        .then(() => this.refresh())
        .catch((e) => this.report(id, e));
    }
  }
  async answer(id: string, token: string, value: unknown) {
    if (this.state.responding[token]) return;
    this.update({
      responding: { ...this.state.responding, [token]: true },
      errors: { ...this.state.errors, [id]: "" },
    });
    try {
      await window.escode.chat("answer", this.project, id, token, value);
      // Keep the response locked until a snapshot removes its request.
    } catch (e) {
      this.update({ responding: { ...this.state.responding, [token]: false } });
      this.report(id, e);
    } finally {
      void this.refresh();
    }
  }
  async stop(id: string) {
    try {
      await window.escode.chat("stop", this.project, id);
    } catch (e) {
      this.report(id, e);
    } finally {
      void this.refresh();
    }
  }
  edit(id: string, text: string) {
    this.update({ drafts: { ...this.state.drafts, [id]: text } });
    void window.escode.chat("draft", this.project, id, text).catch((e) => this.report(id, e));
  }
  send(id: string) {
    const text = this.state.drafts[id] ?? "";
    return this.run(id, async () => {
      await window.escode.chat("draft", this.project, id, text);
      await window.escode.chat("send", this.project, id, text);
      this.update({ drafts: { ...this.state.drafts, [id]: "" } });
    });
  }
}
const projects = new Map<string | null, ProjectChats>();
export function useProjectChats(project: string | null) {
  let store = projects.get(project);
  if (!store) {
    store = new ProjectChats(project);
    projects.set(project, store);
  }
  return [store, useSyncExternalStore(store.subscribe, store.snapshot)] as const;
}
