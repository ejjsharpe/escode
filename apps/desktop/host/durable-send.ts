import { Schema } from "effect";
import { SendCommand, SendReceipt } from "@escode/contracts";
import { randomUUID } from "node:crypto";
import type { DurableState } from "./durable-state";

// Provider work is deliberately outside each committed storage transition.
export class DurableSend {
  constructor(private database: DurableState, readonly admissionEpoch = randomUUID()) {}
  async receipt(commandId: string): Promise<SendReceipt | null> {
    const receipt = await this.database.command("status", { commandId });
    return receipt === null ? null : Schema.decodeUnknownSync(SendReceipt)(receipt);
  }
  async execute(input: SendCommand, dispatch: () => Promise<void>): Promise<SendReceipt> {
    const command = Schema.decodeUnknownSync(SendCommand)(input);
    const { hostId, clientId } = await this.database.ready;
    const admission = await this.database.command("admit", { command, epoch: this.admissionEpoch, hostId, clientId });
    if (!admission.fresh) return Schema.decodeUnknownSync(SendReceipt)(admission.receipt);
    const receipt = admission.receipt as SendReceipt;
    await this.database.command("outcome", { receipt: { ...receipt, status: "dispatching" } });
    let outcome: SendReceipt;
    try {
      await dispatch();
      outcome = { ...receipt, status: "accepted" };
    } catch (error) {
      outcome = { ...receipt, status: (error as { rejected?: boolean }).rejected ? "rejected" : "uncertain", message: String(error) };
    }
    try { await this.database.command("outcome", { receipt: outcome }); }
    catch (error) {
      await this.database.command("outcome", { receipt: { ...receipt, status: "uncertain", message: `Outcome persistence failed; inspect provider history. ${String(error)}` } });
      throw error;
    }
    return outcome;
  }
}
