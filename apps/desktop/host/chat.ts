import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export type SavedChat = {
  id: string;
  project: string;
  checkout: string;
  threadId: string | null;
  hasSent?: boolean;
  phase?: "draft" | "bound";
  initialSend?: "preparing" | "creating" | "unaccepted" | "uncertain" | "accepted";
  removed?: boolean;
  draft: string;
  createdAt?: number;
  legacyOrder?: number;
};
export class Chats {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  private async read(): Promise<SavedChat[]> {
    try {
      const chats: SavedChat[] = JSON.parse(await readFile(this.file, "utf8"));
      return chats.map((chat, index) => ({
        ...chat,
        ...(chat.createdAt === undefined ? { legacyOrder: chat.legacyOrder ?? index } : {}),
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async all() {
    await this.queue;
    return this.read();
  }
  async list(project: string) {
    await this.queue;
    return (await this.read()).filter((c) => c.project === project);
  }
  private change<T>(edit: (chats: SavedChat[]) => T) {
    const task = this.queue.then(async () => {
      const chats = await this.read();
      const result = edit(chats);
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = this.file + ".tmp";
      await writeFile(temporary, JSON.stringify(chats), { mode: 0o600 });
      await rename(temporary, this.file);
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  migrate(project: string, checkouts: string[]) {
    return this.change((chats) => {
      for (const chat of chats) if (checkouts.includes(chat.project)) chat.project = project;
    });
  }
  create(project: string, checkout = project) {
    return this.change((chats) => {
      const chat: SavedChat = {
        id: randomUUID(),
        project,
        checkout,
        threadId: null,
        hasSent: false,
        draft: "",
        createdAt: Date.now(),
      };
      chats.push(chat);
      return chat;
    });
  }
  createDraft(project: string, checkout: string) {
    return this.change((chats) => {
      const empty = chats.find(
        (c) =>
          c.phase === "draft" &&
          c.project === project &&
          c.checkout === checkout &&
          !c.draft &&
          !c.initialSend,
      );
      if (empty) return empty;
      const chat: SavedChat = {
        id: randomUUID(),
        project,
        checkout,
        threadId: null,
        hasSent: false,
        phase: "draft",
        draft: "",
        createdAt: Date.now(),
      };
      chats.push(chat);
      return chat;
    });
  }
  context(project: string, id: string, target: string, checkout: string) {
    return this.change((chats) => {
      const chat = chats.find((c) => c.id === id && c.project === project);
      if (!chat || chat.phase !== "draft") throw Error("Only an unsent draft can change context.");
      Object.assign(chat, { project: target, checkout, initialSend: undefined });
      return chat;
    });
  }
  async get(project: string, id: string) {
    const chat = (await this.list(project)).find((c) => c.id === id);
    if (!chat) throw Error("Unknown chat in this project.");
    return chat;
  }
  draft(project: string, id: string, text: string) {
    return this.update(project, id, { draft: text });
  }
  update(
    project: string,
    id: string,
    fields: Partial<
      Pick<SavedChat, "threadId" | "draft" | "hasSent" | "removed" | "phase" | "initialSend">
    >,
  ) {
    return this.change((chats) => {
      const chat = chats.find((c) => c.id === id && c.project === project);
      if (!chat) throw Error("Unknown chat in this project.");
      Object.assign(chat, fields);
    });
  }
}
