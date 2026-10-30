import type { SendCommand } from "@escode/contracts";
import { FoundationState } from "./foundation-state";

// A socket cancellation never owns this promise or repeats its provider effect.
export async function executeSend(store: FoundationState, command: SendCommand, dispatch: () => Promise<void>) {
  const previous = store.receipt(command.commandId);
  const receipt = store.admit(command);
  if (previous) return receipt;
  try {
    store.record({ ...receipt, status: "dispatching" });
    await dispatch();
    store.record({ ...receipt, status: "accepted" });
  } catch (error) {
    store.record({ ...receipt, status: (error as { rejected?: boolean }).rejected ? "rejected" : "uncertain", message: String(error) });
  }
  return store.receipt(command.commandId)!;
}
