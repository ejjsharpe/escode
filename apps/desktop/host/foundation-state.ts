import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";

export type FoundationRecord = {
  id: string;
  hostId: string;
  clientId: string;
  path: string;
  filesystemIdentity: { dev: string; ino: string };
  providerId: string | null;
  ownership: "external" | "managed-worktree" | "scratch";
};
type State = { version: 1; hostId: string; clientId: string; records: FoundationRecord[] };
const maximumBytes = 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function validate(value: unknown): asserts value is State {
  const state = value as State;
  if (!state || state.version !== 1) throw Error("Unsupported foundation storage version");
  if (!uuid.test(state.hostId) || !uuid.test(state.clientId) || !Array.isArray(state.records))
    throw Error("Invalid foundation identities or records");
  const ids = new Set<string>();
  for (const record of state.records) {
    if (
      !record ||
      typeof record.id !== "string" ||
      !record.id ||
      ids.has(record.id) ||
      record.hostId !== state.hostId ||
      record.clientId !== state.clientId ||
      typeof record.path !== "string" ||
      !isAbsolute(record.path) ||
      record.path.includes("\0") ||
      typeof record.filesystemIdentity?.dev !== "string" ||
      !/^\d+$/.test(record.filesystemIdentity.dev) ||
      typeof record.filesystemIdentity.ino !== "string" ||
      !/^\d+$/.test(record.filesystemIdentity.ino) ||
      !(
        record.providerId === null ||
        (typeof record.providerId === "string" && record.providerId.length > 0)
      ) ||
      !["external", "managed-worktree", "scratch"].includes(record.ownership)
    )
      throw Error("Invalid foundation record or owner");
    ids.add(record.id);
  }
}
function syncDirectory(directory: string) {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// Desktop main owns this store; clients never write its files directly.
export class FoundationState {
  private closed = false;
  private failed = false;
  private constructor(
    private directory: string,
    private state: State,
  ) {}

  static open(directory: string): FoundationState {
    let fresh = false;
    try {
      mkdirSync(directory, { mode: 0o700 });
      fresh = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
      throw Error("Foundation storage must be a real directory");
    if (fresh) syncDirectory(dirname(directory));
    const lock = join(directory, "owner.lock");
    const fd = openSync(lock, "wx", 0o600);
    closeSync(fd);
    try {
      syncDirectory(directory);
      const file = join(directory, "state.json");
      if (existsSync(join(directory, "state.json.tmp")))
        throw Error("Incomplete foundation write; explicit recovery required");
      if (readdirSync(directory).some((name) => !["owner.lock", "state.json"].includes(name)))
        throw Error("Ambiguous foundation storage; explicit recovery required");
      let state: State;
      if (fresh) {
        state = { version: 1, hostId: randomUUID(), clientId: randomUUID(), records: [] };
        const store = new FoundationState(directory, state);
        store.persist(state);
        return store;
      }
      const input = openSync(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const info = fstatSync(input);
        if (!info.isFile() || info.size > maximumBytes)
          throw Error("Invalid foundation state file or size");
        state = JSON.parse(readFileSync(input, "utf8"));
        validate(state);
      } finally {
        closeSync(input);
      }
      return new FoundationState(directory, state);
    } catch (error) {
      unlinkSync(lock);
      throw error;
    }
  }

  read(): State {
    this.requireAvailable();
    return structuredClone(this.state);
  }

  put(record: FoundationRecord): void {
    this.requireAvailable();
    const state = structuredClone(this.state);
    const index = state.records.findIndex((entry) => entry.id === record.id);
    if (index < 0) state.records.push(structuredClone(record));
    else state.records[index] = structuredClone(record);
    validate(state);
    this.persist(state);
    this.state = state;
  }

  private requireAvailable() {
    if (this.closed || this.failed)
      throw Error("Foundation state unavailable; explicit recovery required");
  }

  private persist(state: State) {
    const bytes = Buffer.from(JSON.stringify(state));
    if (bytes.length > maximumBytes) throw Error("Foundation storage limit exceeded");
    const temporary = join(this.directory, "state.json.tmp");
    try {
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      syncDirectory(this.directory);
      renameSync(temporary, join(this.directory, "state.json"));
      syncDirectory(this.directory);
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    unlinkSync(join(this.directory, "owner.lock"));
    syncDirectory(this.directory);
  }
}
