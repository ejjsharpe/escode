import React, { useEffect, useState } from "react";
import { Button } from "@base-ui/react/button";
import type { ChatSummary } from "@escode/contracts";
import { chatRecency } from "./chat-order";

const stateIcons = {
  "Needs input": <><circle cx="12" cy="12" r="9" /><path d="M12 6v8m0 3v1" /></>,
  Running: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
  Preparing: <><circle cx="12" cy="12" r="9" /><path d="M8 8h8l-8 8h8" /></>,
  Unavailable: <><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></>,
  Uncertain: <><circle cx="12" cy="12" r="9" /><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3v1" /></>,
  Archived: <path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6" />,
  Draft: <path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z" />,
  Idle: <path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z" />,
};

export function ChatRow({ chat, selected, select, fallbackTitle }: { fallbackTitle: string; chat: ChatSummary; selected: boolean; select: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const status = chat.needsInput ? "Needs input" : chat.initialSend === "preparing" ? "Preparing" : chat.busy ? "Running" : chat.unavailable ? "Unavailable" : chat.initialSend === "uncertain" || chat.initialSend === "creating" ? "Uncertain" : chat.archived ? "Archived" : chat.phase === "draft" ? "Draft" : "Idle";
  const title = chat.title || fallbackTitle;
  const context = chat.project
    ? `${chat.project.split("/").at(-1)}${chat.checkout === chat.project ? "" : ` / ${chat.checkout.split("/").at(-1)}`}${chat.worktree ? ` / ${chat.worktree.reservation?.branch ?? chat.worktree.ref}` : ""}`
    : `No project / ${chat.scratch ? `Scratch folder · ${chat.scratch.path}` : "Scratch folder on first Send"}`;
  const timestamp = chatRecency(chat);
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  const relative = !timestamp ? "" : minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
  const label = [title, context, chat.project, chat.checkout, status, timestamp ? `Last user message or draft: ${new Date(timestamp).toLocaleString()}` : ""].filter(Boolean).join(" · ");
  return <li><Button className="agent-row" aria-pressed={selected} aria-label={label} title={label} onClick={select}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{stateIcons[status]}</svg>
    <span className="chat-row-heading">
      <strong>{title}</strong><time dateTime={timestamp ? new Date(timestamp).toISOString() : undefined}>{relative}</time>
    </span>
    <span className="chat-row-context">{context}</span>
  </Button></li>;
}
