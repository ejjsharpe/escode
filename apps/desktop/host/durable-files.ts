import type { DurableState } from "./durable-state";

// Retain admission even when an effect or its result write is interrupted.
export class DurableFiles {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private database: DurableState, private clientId: string, private epoch: string) {}
  run<T>(command: { commandId: string; admissionEpoch: string; checkoutIdentity?: string; parentIdentity?: string }, uncertain: T, effect: () => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      const stored = await this.database.recoveryRead(this.clientId, "fileCommands");
      const records = (stored.body ?? []) as { command: unknown; result?: T }[];
      const prior = records.find(r => (r.command as typeof command).commandId === command.commandId);
      if (prior) {
        if (JSON.stringify(prior.command) !== JSON.stringify(command)) throw Error("Command identity conflict");
        return prior.result ?? uncertain;
      }
      if (command.admissionEpoch !== this.epoch) throw Error("Expired file operation epoch; inspect exact targets. Operation was not repeated.");
      if (!command.commandId || records.length >= 1000) throw Error("File command capacity exhausted; retained evidence was not pruned");
      const record: { command: unknown; result?: T } = { command };
      records.push(record);
      await this.database.recoveryWrite(this.clientId, "fileCommands", records, stored.revision);
      record.result = await effect();
      await this.database.recoveryWrite(this.clientId, "fileCommands", records, stored.revision + 1);
      return record.result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
