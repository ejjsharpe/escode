import type { ChatSummary } from "@escode/contracts";
type Recency = Pick<ChatSummary, "createdAt" | "updatedAt" | "latestUserMessageAt" | "latestUserMessageCreatedAt">;
export function chatRecency(chat: Recency) {
  return chat.latestUserMessageAt ?? chat.latestUserMessageCreatedAt ?? chat.updatedAt ?? chat.createdAt ?? 0;
}
export function compareChats(a: Recency & { id: string }, b: Recency & { id: string }) {
  return chatRecency(b) - chatRecency(a) || b.id.localeCompare(a.id);
}
