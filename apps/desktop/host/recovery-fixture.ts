import { afterAll } from "vite-plus/test";
import { dirname, join } from "node:path";
import { DurableState } from "./durable-state";
import { Workspace as StoredWorkspace } from "./workspace";
import { FileOperationJournal as StoredJournal } from "./file-operation-journal";
const databases = new Map<string, DurableState>();
export function recoveryDatabase(file: string) {
  const directory = join(dirname(file), "recovery-sqlite");
  let database = databases.get(directory);
  if (!database) { database = new DurableState(directory); databases.set(directory, database); }
  return database;
}
afterAll(async () => { for (const database of databases.values()) await database.close(); });
const client = { hostId: "fixture-host", clientId: "fixture-client" };
export class Workspace extends StoredWorkspace {
  constructor(file: string, owner = client) { super(file, owner, recoveryDatabase(file)); }
}
export class FileOperationJournal extends StoredJournal {
  constructor(file: string, owner = client) { super(file, owner, recoveryDatabase(file)); }
}
