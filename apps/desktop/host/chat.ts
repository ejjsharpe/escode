import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { accessSync, constants, lstatSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
export type SavedChat = {
  id: string;
  project: string | null;
  checkout: string;
  scratch?: { path: string; dev?: number; ino?: number };
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
  async list(project: string | null) {
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
      for (const chat of chats)
        if (chat.project !== null && checkouts.includes(chat.project)) chat.project = project;
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
        legacyOrder: chats.length,
      };
      chats.push(chat);
      return chat;
    });
  }
  createDraft(project: string | null, checkout: string) {
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
        legacyOrder: chats.length,
      };
      chats.push(chat);
      return chat;
    });
  }
  context(project: string | null, id: string, target: string | null, checkout: string) {
    return this.change((chats) => {
      const chat = chats.find((c) => c.id === id && c.project === project);
      if (!chat || chat.phase !== "draft" || chat.scratch)
        throw Error("Only an unsent draft without prepared resources can change context.");
      Object.assign(chat, { project: target, checkout, initialSend: undefined });
      return chat;
    });
  }
  validateScratch(chat: Readonly<SavedChat>) {
    if (chat.project !== null) return;
    const expected = join(dirname(this.file), "scratch", chat.id);
    try {
      const owner = chat.scratch;
      if (!owner || owner.path !== expected || chat.checkout !== expected)
        throw Error("Missing ownership");
      const identity = lstatSync(expected);
      if (
        !identity.isDirectory() ||
        identity.dev !== owner.dev ||
        identity.ino !== owner.ino ||
        realpathSync(expected) !== expected
      )
        throw Error("Changed directory");
      accessSync(expected, constants.R_OK | constants.W_OK | constants.X_OK);
    } catch {
      throw Error(
        `Scratch folder unavailable or changed: ${chat.checkout || expected}. Restore the original directory and Retry; retained resources are never reconstructed or rebound.`,
      );
    }
  }
  async prepareScratch(chat: Readonly<SavedChat>) {
    if (chat.project !== null) return chat;
    if (chat.scratch) {
      this.validateScratch(chat);
      return chat;
    }
    if (chat.phase !== "draft") throw Error("Bound scratch ownership is missing.");
    const path = join(dirname(this.file), "scratch", chat.id);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    if (realpathSync(dirname(path)) !== dirname(path))
      throw Error(`Scratch storage is unavailable or changed: ${dirname(path)}`);
    // Persist the reservation before allocation; a partial handoff never permits reconstruction.
    await this.update(null, chat.id, { checkout: path, scratch: { path } });
    try {
      await mkdir(path, { mode: 0o700 });
      const identity = lstatSync(path);
      await this.update(null, chat.id, {
        scratch: { path, dev: identity.dev, ino: identity.ino },
      });
    } catch (error) {
      throw Error(
        `Scratch preparation incomplete at ${path}. Any files are retained; Retry never replaces this reservation. ${String(error)}`,
      );
    }
    const prepared = await this.get(null, chat.id);
    this.validateScratch(prepared);
    return Object.freeze(prepared);
  }
  async get(project: string | null, id: string) {
    const chat = (await this.list(project)).find((c) => c.id === id);
    if (!chat) throw Error("Unknown chat in this project.");
    return chat;
  }
  draft(project: string | null, id: string, text: string) {
    return this.update(project, id, { draft: text });
  }
  update(
    project: string | null,
    id: string,
    fields: Partial<
      Pick<
        SavedChat,
        | "threadId"
        | "draft"
        | "hasSent"
        | "removed"
        | "phase"
        | "initialSend"
        | "checkout"
        | "scratch"
      >
    >,
  ) {
    return this.change((chats) => {
      const chat = chats.find((c) => c.id === id && c.project === project);
      if (!chat) throw Error("Unknown chat in this project.");
      Object.assign(chat, fields);
    });
  }
}
