import type { ChatSummary } from "@escode/contracts";
export function compareChats(a: Pick<ChatSummary, "id" | "createdAt" | "legacyOrder">, b: Pick<ChatSummary, "id" | "createdAt" | "legacyOrder">) {
  return (
    (b.createdAt ?? -1) - (a.createdAt ?? -1) ||
    (b.legacyOrder ?? -1) - (a.legacyOrder ?? -1) ||
    a.id.localeCompare(b.id)
  );
}
