import React, { useEffect, useState } from "react";
import { Button } from "@base-ui/react/button";
import type { SavedChat } from "../host/chat";
import { compareChats } from "./chat-order";
import { ChatView } from "./chat";
import { useProjectChats } from "./chat-state";
import { memory, persist } from "./workspace";

function ChatRow({
  chat,
  selected,
  select,
}: {
  chat: SavedChat;
  selected: boolean;
  select: () => void;
}) {
  const [, { chats, snapshots, errors }] = useProjectChats(chat.project);
  const snapshot = snapshots[chat.id];
  const status = snapshot?.requests.length
    ? "Needs input"
    : snapshot?.busy
      ? "Running"
      : chat.removed || snapshot?.error || errors[chat.id] || errors[""]
        ? "Unavailable"
        : "Stopped";
  return (
    <li>
      <Button className="agent-row" aria-pressed={selected} onClick={select}>
        <strong>
          Chat{" "}
          {Math.max(
            0,
            chats.findIndex((c) => c.id === chat.id),
          ) + 1}
        </strong>
        <span>{chat.project.split("/").at(-1)}</span>
        <small>{status}</small>
      </Button>
    </li>
  );
}
export function AgentsView() {
  const [chats, setChats] = useState<SavedChat[] | null>(null);
  const [selected, setSelected] = useState(memory.agentsChat ?? "");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const list = await window.escode.chat("catalogue");
        if (live) {
          setChats(list.sort(compareChats));
          setError("");
        }
      } catch (e) {
        if (live) setError(String(e));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const chat = chats?.find((c) => c.id === selected);
  return (
    <section className="agents" aria-label="Agents">
      <div className="agents-heading">
        <h1>Agents</h1>
        <span>Conversations across saved projects</span>
      </div>
      <div className="workspace">
        <aside aria-label="Agents chats">
          <h2>Saved chats</h2>
          {chats === null && <p role="status">Loading chats…</p>}
          {chats?.length === 0 && (
            <p>No saved chats. Open a project and use Chats to start a conversation.</p>
          )}
          <ul>
            {chats?.map((c) => (
              <ChatRow
                key={c.id}
                chat={c}
                selected={selected === c.id}
                select={() => {
                  memory.agentsChat = c.id;
                  void persist();
                  setSelected(c.id);
                }}
              />
            ))}
          </ul>
          {error && <p role="alert">{error}</p>}
        </aside>
        <section className="content" aria-label="Agent conversation">
          <div className="chat-conversation">
            {chat ? (
              <ChatView
                key={chat.project}
                global
                project={chat.project}
                checkout={chat.checkout}
                sidebarId="agents"
                selected={chat.id}
                select={async () => {}}
              />
            ) : (
              <p>
                {selected
                  ? `Saved conversation ${selected} is unavailable. Its selection is retained.`
                  : "Select a chat to continue its conversation."}
              </p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
