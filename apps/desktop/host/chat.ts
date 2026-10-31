import { mkdir, open } from "node:fs/promises";
import { DurableState } from "./durable-state";
import { accessSync, constants, lstatSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Checkout } from "./project";
import { randomUUID } from "node:crypto";
export type SavedChat = {
  id: string;
  project: string | null;
  checkout: string;
  worktree?: {
    ref: string;
    commit: string;
    source: string;
    reservation?: {
      root: string;
      branch: string;
      commit: string;
      dev?: number;
      ino?: number;
      error?: string | null;
    };
  };
  scratch?: { path: string; dev?: number; ino?: number };
  directoryIdentity?: { path: string; dev: number; ino: number };
  availabilityError?: string | null;
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
  private failed = false;
  private sqlite?: DurableState;
  get database() { return this.sqlite ??= new DurableState(this.file + ".sqlite-state-v1"); }
  constructor(private file: string) {}
  get spoolDirectory() { return join(dirname(this.file), "live-spool-v1"); }
  private async read(): Promise<SavedChat[]> { return (await this.database.read()).chats; }
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
      if (this.failed) throw Error("Chat storage unavailable; explicit recovery required.");
      const { chats, revision } = await this.database.read();
      const result = edit(chats);
      try { await this.database.write(chats, revision); }
      catch (error) { this.failed = true; throw error; }
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
  createDraft(project: string | null, checkout: string, fresh = false) {
    return this.change((chats) => {
      const empty = chats.find(
        (c) =>
          c.phase === "draft" &&
          c.project === project &&
          c.checkout === checkout &&
          !c.draft &&
          !c.worktree &&
          !c.initialSend,
      );
      if (empty && !fresh) return empty;
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
  context(
    project: string | null,
    id: string,
    target: string | null,
    checkout: string,
    worktree?: SavedChat["worktree"],
  ) {
    return this.change((chats) => {
      const chat = chats.find((c) => c.id === id && c.project === project);
      if (!chat || chat.phase !== "draft" || chat.scratch || chat.worktree?.reservation)
        throw Error("Only an unsent draft without prepared resources can change context.");
      Object.assign(chat, {
        project: target,
        checkout,
        worktree,
        initialSend: undefined,
        directoryIdentity: undefined,
        availabilityError: undefined,
      });
      return chat;
    });
  }
  async prepareWorktree(chat: Readonly<SavedChat>, project: Checkout, managedRoot: string) {
    const choice = chat.worktree;
    if (!choice || choice.reservation) {
      this.validateWorktree(chat);
      return chat;
    }
    const reservation = project.repositoryGit.reserveWorktree(managedRoot, choice.ref, choice.commit);
    try {
      // Persist before Git mutation: an interrupted preparation is never silently repeated.
      await this.update(chat.project, chat.id, {
        checkout: reservation.root,
        worktree: { ...choice, reservation },
      });
      const result = project.repositoryGit.createWorktree(managedRoot, choice.ref, choice.commit, reservation);
      const identity = result.error
        ? undefined
        : project
            .repositoryGit.managedWorktrees(managedRoot)
            .find((record) => record.root === result.root && record.branch === result.branch);
      if (!result.error && !identity) throw Error("Managed ownership record is missing.");
      await this.update(chat.project, chat.id, {
        worktree: {
          ...choice,
          reservation: {
            ...result,
            dev: identity?.dev,
            ino: identity?.ino,
          },
        },
      });
    } catch (error) {
      throw Error(
        `Worktree preparation incomplete at ${reservation.root}; possible retained branch ${reservation.branch}. Resources were not replaced. ${String(error)}`,
      );
    }
    const prepared = await this.get(chat.project, chat.id);
    this.validateWorktree(prepared);
    return Object.freeze(prepared);
  }
  validateWorktree(chat: Readonly<SavedChat>) {
    const reserved = chat.worktree?.reservation;
    if (!reserved) {
      if (chat.worktree)
        throw Error(
          "The selected managed worktree has not been prepared. No provider can start in its source checkout.",
        );
      return;
    }
    try {
      const identity = lstatSync(reserved.root);
      if (
        reserved.error ||
        chat.checkout !== reserved.root ||
        !identity.isDirectory() ||
        identity.dev !== reserved.dev ||
        identity.ino !== reserved.ino ||
        realpathSync(reserved.root) !== reserved.root
      )
        throw Error("Incomplete or changed directory");
    } catch {
      throw Error(
        `Worktree preparation unavailable at ${reserved.root}; retained branch ${reserved.branch}. ${reserved.error ?? "Preparation or directory identity is uncertain."} Restore and inspect the original resources externally; Retry never replaces or reconstructs them.`,
      );
    }
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
    // Reserve before any allocation, including creation of the scratch parent.
    await this.update(null, chat.id, { checkout: path, scratch: { path } });
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    if (realpathSync(dirname(path)) !== dirname(path))
      throw Error(`Scratch storage is unavailable or changed: ${dirname(path)}`);
    try {
      await mkdir(path, { mode: 0o700 });
      const parent = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
      try { await parent.sync(); } finally { await parent.close(); }
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
  async validateDirectory(chat: Readonly<SavedChat>, remember = false) {
    try {
      this.validateWorktree(chat);
      this.validateScratch(chat);
      accessSync(chat.checkout, constants.R_OK | constants.X_OK);
      const actual = lstatSync(chat.checkout);
      const previous = chat.directoryIdentity;
      const path = realpathSync(chat.checkout);
      if (
        !actual.isDirectory() ||
        (previous &&
          (previous.path !== path || previous.dev !== actual.dev || previous.ino !== actual.ino))
      )
        throw Error("Directory identity changed");
      if (remember && !previous)
        await this.update(chat.project, chat.id, {
          directoryIdentity: { path, dev: actual.dev, ino: actual.ino },
        });
      if (chat.availabilityError)
        await this.update(chat.project, chat.id, { availabilityError: null });
      return null;
    } catch (error) {
      const message = `Checkout unavailable or changed: ${chat.checkout}. Restore access to the original directory, then Retry connection. History and drafts are retained; work was not resent. ${String(error)}`;
      if (chat.availabilityError !== message)
        await this.update(chat.project, chat.id, { availabilityError: message });
      return message;
    }
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
        | "directoryIdentity"
        | "availabilityError"
        | "threadId"
        | "draft"
        | "hasSent"
        | "removed"
        | "phase"
        | "initialSend"
        | "checkout"
        | "scratch"
        | "worktree"
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
