import { useSyncExternalStore } from "react";
import type { SavedChat } from "../host/chat";
import type { ChatSnapshot } from "../host/chat-service";

// Renderer lifetime, independent of any conversation view. Sessions remain host-owned.
class ProjectChats {
  private listeners = new Set<() => void>();
  private state = {
    chats: [] as SavedChat[],
    drafts: {} as Record<string, string>,
    snapshots: {} as Record<string, ChatSnapshot>,
    pending: {} as Record<string, boolean>,
    responding: {} as Record<string, boolean>,
    errors: {} as Record<string, string>,
  };
  private opening = new Map<string, Promise<void>>();
  private polling = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private project: string) {}
  subscribe = (listener: () => void) => {
    if (!this.listeners.size) void this.load().catch((e) => this.report("", e));
    this.listeners.add(listener);
    this.timer ??= setInterval(() => void this.refresh(), 300);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearInterval(this.timer);
        this.timer = undefined;
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
    const chats = await window.escode.chat("list", this.project);
    const drafts = Object.fromEntries(
      Object.entries(this.state.drafts).filter(([id]) => chats.some((c) => c.id === id)),
    );
    for (const chat of chats) if (!(chat.id in drafts)) drafts[chat.id] = chat.draft;
    this.update({ chats, drafts, errors: { ...this.state.errors, "": "" } });
  }
  async refresh() {
    if (this.polling) return;
    this.polling = true;
    try {
      await Promise.all(
        this.state.chats.map(async (chat) => {
          const snapshot = await window.escode.chat("snapshot", this.project, chat.id);
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
  open(id: string) {
    const existing = this.opening.get(id);
    if (existing) return existing;
    const operation = this.run(id, async () => {
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
const projects = new Map<string, ProjectChats>();
export function useProjectChats(project: string) {
  let store = projects.get(project);
  if (!store) {
    store = new ProjectChats(project);
    projects.set(project, store);
  }
  return [store, useSyncExternalStore(store.subscribe, store.snapshot)] as const;
}
