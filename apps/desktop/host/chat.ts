import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export type SavedChat = {
  id: string;
  project: string;
  checkout: string;
  threadId: string | null;
  hasSent?: boolean;
  draft: string;
};
export class Chats {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}
  private async read(): Promise<SavedChat[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
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
  create(project: string) {
    return this.change((chats) => {
      const chat: SavedChat = {
        id: randomUUID(),
        project,
        checkout: project,
        threadId: null,
        hasSent: false,
        draft: "",
      };
      chats.push(chat);
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
    fields: Partial<Pick<SavedChat, "threadId" | "draft" | "hasSent">>,
  ) {
    return this.change((chats) => {
      const chat = chats.find((c) => c.id === id && c.project === project);
      if (!chat) throw Error("Unknown chat in this project.");
      Object.assign(chat, fields);
    });
  }
}
