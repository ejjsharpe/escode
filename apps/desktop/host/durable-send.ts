import { Schema } from "effect";
import { SendCommand, SendReceipt } from "@escode/contracts";
import { randomUUID } from "node:crypto";
import type { DurableState } from "./durable-state";

// Provider work is deliberately outside each committed storage transition.
export class DurableSend {
  private emergencyTargets = new Set<string>();
  constructor(private database: DurableState, readonly admissionEpoch = randomUUID()) {}
  async receipt(commandId: string): Promise<SendReceipt | null> {
    const receipt = await this.database.command("status", { commandId });
    return receipt === null ? null : Schema.decodeUnknownSync(SendReceipt)(receipt);
  }
  async execute(input: SendCommand, dispatch: () => Promise<void>): Promise<SendReceipt> {
    const command = Schema.decodeUnknownSync(SendCommand)(input);
    const { hostId, clientId } = await this.database.ready;
    const target = JSON.stringify([command.project, command.id, command.control?.target]);
    if (command.control?.emergency) {
      if (command.control.operation !== "stop" || !command.control.target ||
          command.admissionEpoch !== this.admissionEpoch || !this.emergencyTargets.delete(target))
        throw Error("Emergency Stop unavailable for this captured target.");
      let message = "Cancellation requested.";
      let rejected = false;
      try { await dispatch(); }
      catch (error) { message = String(error); rejected = !!(error as { rejected?: boolean }).rejected; }
      // No storage write gates cancellation or replaces the original uncertain evidence.
      return { hostId, clientId, command, status: rejected ? "rejected" : "uncertain",
        message: message + " Emergency Stop result is not durable; cancellation may be uncertain. External effects may remain. Reserved resources and prior command evidence are retained." };
    }
    let admission;
    try {
      admission = await this.database.command("admit", { command, epoch: this.admissionEpoch, hostId, clientId });
    } catch (error) {
      if (command.control?.operation === "stop" && command.control.target && command.admissionEpoch === this.admissionEpoch) {
        this.emergencyTargets.add(target);
        throw Error("Stop receipt persistence failed. Emergency Stop is available for the captured target. " + String(error));
      }
      throw error;
    }
    if (!admission.fresh) return Schema.decodeUnknownSync(SendReceipt)(admission.receipt);
    const receipt = admission.receipt as SendReceipt;
    try { await this.database.command("outcome", { receipt: { ...receipt, status: "dispatching" } }); }
    catch (error) {
      if (command.control?.operation === "stop") {
        this.emergencyTargets.add(target);
        throw Error("Stop receipt persistence failed. Emergency Stop is available for the captured target. " + String(error));
      }
      throw error;
    }
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
