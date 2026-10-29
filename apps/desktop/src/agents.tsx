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
      : chat.removed || snapshot?.contextError || snapshot?.error || errors[chat.id] || errors[""]
        ? "Unavailable"
        : chat.phase === "draft"
          ? "Draft"
          : chat.initialSend === "uncertain" || chat.initialSend === "creating"
            ? "Uncertain"
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
        <span>{chat.project?.split("/").at(-1) ?? "No project"}</span>
        <small>{status}</small>
      </Button>
    </li>
  );
}
export function AgentsView() {
  const [chats, setChats] = useState<SavedChat[] | null>(null);
  const [selected, setSelected] = useState(memory.agentsChat ?? "");
  const [error, setError] = useState("");
  const [targets, setTargets] = useState<{ project: string | null; checkout: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const create = async (project: string | null) => {
    try {
      const draft = await window.escode.chat("createDraft", project);
      setChats((await window.escode.chat("catalogue")).sort(compareChats));
      memory.agentsChat = draft.id;
      await persist();
      setTargets(await window.escode.chat("targets"));
      setSelected(draft.id);
      setPicking(false);
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const list = await window.escode.chat("catalogue");
        const available = await window.escode.chat("targets");
        if (live) setTargets(available);
        if (live) {
          setChats(list.sort(compareChats));
          setError("");
        }
      } catch (e) {
        if (live) setError(String(e));
      }
    };
    void load();
    const moved = () => {
      setSelected(memory.agentsChat ?? "");
      void load();
    };
    window.addEventListener("draft-context-changed", moved);
    const timer = setInterval(() => void load(), 1000);
    return () => {
      window.removeEventListener("draft-context-changed", moved);
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
          <Button
            disabled={!targets.length}
            onClick={() => {
              if (targets.length === 1) void create(chat ? chat.project : targets[0].project);
              else setPicking(!picking);
            }}
          >
            New chat
          </Button>
          <Button onClick={() => void create(null)}>No project</Button>
          {!targets.length && (
            <Button onClick={() => void create(null)}>Start without a project</Button>
          )}
          {targets.length > 1 && chat && (
            <Button onClick={() => void create(chat.project)}>
              New chat in {chat.project?.split("/").at(-1) ?? "No project"}
            </Button>
          )}
          {picking && (
            <label>
              Choose project
              <select
                aria-label="New chat project"
                defaultValue=""
                onChange={(e) => {
                  void create(e.target.value === "no-project" ? null : e.target.value);
                }}
              >
                <option value="" disabled>
                  Select a saved project
                </option>
                <option value="no-project">No project</option>
                {targets
                  .filter((t) => t.project !== null)
                  .map((t) => (
                    <option key={t.project!} value={t.project!}>
                      {t.project?.split("/").at(-1)} · {t.project}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <h2>Saved chats</h2>
          {chats === null && <p role="status">Loading chats…</p>}
          {chats?.length === 0 && <p>No saved chats. Start without a project or open a project.</p>}
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
                key={chat.project ?? "no-project"}
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
