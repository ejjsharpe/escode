import { Schema } from "effect";
import { SendReceipt, type SendCommand } from "@escode/contracts";
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
type State = { version: 1; hostId: string; clientId: string; records: FoundationRecord[]; receipts?: SendReceipt[] };
const maximumBytes = 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function validate(value: unknown): asserts value is State {
  const state = value as State;
  if (!state || state.version !== 1) throw Error("Unsupported foundation storage version");
  if (
    typeof state.hostId !== "string" ||
    typeof state.clientId !== "string" ||
    !uuid.test(state.hostId) ||
    !uuid.test(state.clientId) ||
    !Array.isArray(state.records)
  )
    throw Error("Invalid foundation identities or records");
  if (state.receipts !== undefined) {
    Schema.decodeUnknownSync(Schema.Array(SendReceipt))(state.receipts);
    if (state.receipts.some(r => r.hostId !== state.hostId || r.clientId !== state.clientId)) throw Error("Invalid receipt owner");
  }
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
      const store = new FoundationState(directory, state);
      for (const receipt of state.receipts ?? []) {
        if (receipt.status === "admitted" || receipt.status === "dispatching")
          store.record({ ...receipt, status: "uncertain", message: "Host restarted; inspect provider history. Work was not resent." });
      }
      return store;
    } catch (error) {
      if (!fresh) unlinkSync(lock);
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

  readonly admissionEpoch = randomUUID();

  receipt(commandId: string): SendReceipt | null {
    return this.read().receipts?.find(r => r.command.commandId === commandId) ?? null;
  }

  record(receipt: SendReceipt): void {
    this.requireAvailable();
    Schema.decodeUnknownSync(SendReceipt)(receipt);
    const state = this.read();
    state.receipts ??= [];
    const index = state.receipts.findIndex(r => r.command.commandId === receipt.command.commandId);
    if (index < 0) state.receipts.push(receipt); else state.receipts[index] = receipt;
    validate(state);
    this.persist(state);
    this.state = state;
  }

  admit(command: SendCommand): SendReceipt {
    command = { commandId: command.commandId, admissionEpoch: command.admissionEpoch,
      project: command.project, id: command.id, expected: command.expected, text: command.text, ...(command.control ? { control: command.control } : {}) };
    const previous = this.receipt(command.commandId);
    if (previous) {
      if (JSON.stringify(previous.command) !== JSON.stringify(command)) throw Error("Command identity conflict");
      return previous;
    }
    if (command.admissionEpoch !== this.admissionEpoch) throw Error("Expired admission epoch; inspect status. Work was not resent.");
    const receipt: SendReceipt = { hostId: this.state.hostId, clientId: this.state.clientId, command, status: "admitted", message: "" };
    this.record(receipt);
    return receipt;
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
    if (this.failed) return;
    unlinkSync(join(this.directory, "owner.lock"));
    syncDirectory(this.directory);
  }
}
