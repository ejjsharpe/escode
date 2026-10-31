import React from "react";
import { RetentionSettings } from "./retention-settings";

export function ArchiveFooter({ archived, toggle }: { archived: boolean; toggle: () => void }) {
  const label = archived ? "Show recent chats" : "Show archived chats";
  return <footer className="chat-sidebar-footer">
    <RetentionSettings />
    <button aria-label={label} title={label} aria-pressed={archived} onClick={toggle}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3h18v5H3zM5 8v13h14V8M9 12h6" /></svg>
    </button>
  </footer>;
}
