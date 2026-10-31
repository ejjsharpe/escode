import { Worker } from "node:worker_threads";
import { join } from "node:path";
import type { SavedChat } from "./chat";
export type DurableIdentity = { hostId: string; clientId: string; revision: number; settings: { journalMode: string; synchronous: number; checkpointFullfsync: number } };
export class DurableState {
  private worker: Worker;
  private next = 0;
  private failure?: Error;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  readonly ready: Promise<DurableIdentity>;
  constructor(directory: string) {
    this.worker = new Worker(join(typeof __dirname === "string" ? __dirname : import.meta.dirname, "sqlite-worker.cjs"), { workerData: directory });
    this.ready = new Promise((resolve, reject) => this.pending.set(0, { resolve, reject }));
    this.worker.on("message", ({ id, value, error }) => {
      const request = this.pending.get(id);
      this.pending.delete(id);
      if (error) request?.reject(Error(error)); else request?.resolve(value);
      if (!this.pending.size) this.worker.unref();
    });
    const fail = (error: Error) => { this.failure = error; for (const request of this.pending.values()) request.reject(error); this.pending.clear(); };
    this.worker.on("error", fail);
    this.worker.on("exit", code => fail(Error(`SQLite worker exited (${code}); storage unavailable`)));
  }
  private async request(operation: string, fields = {}): Promise<any> {
    await this.ready;
    if (this.failure) throw this.failure;
    if (this.pending.size >= 64) throw Error("SQLite queue capacity exhausted");
    this.worker.ref();
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, operation, ...fields });
    });
  }
  read(): Promise<{ chats: SavedChat[]; revision: number }> { return this.request("read"); }
  write(chats: SavedChat[], revision: number): Promise<void> { return this.request("write", { chats, revision }); }
  recoveryRead(clientId: string, kind: "workspace" | "intent" | "fileFacts"): Promise<{ body: unknown; revision: number }> { return this.request("recoveryRead", { clientId, kind }); }
  recoveryWrite(clientId: string, kind: "workspace" | "intent" | "fileFacts", body: unknown, revision: number): Promise<void> { return this.request("recoveryWrite", { clientId, kind, body, revision }); }
  command(operation: string, fields: object): Promise<any> { return this.request(operation, fields); }
  async close() { await this.worker.terminate(); }
}
