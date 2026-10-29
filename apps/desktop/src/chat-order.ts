import type { SavedChat } from "../host/chat";
export function compareChats(a: SavedChat, b: SavedChat) {
  return (
    (b.createdAt ?? -1) - (a.createdAt ?? -1) ||
    (b.legacyOrder ?? -1) - (a.legacyOrder ?? -1) ||
    a.id.localeCompare(b.id)
  );
}
