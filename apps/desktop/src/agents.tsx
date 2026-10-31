import { ArchiveFooter } from "./archive-footer";
import { SidebarResize } from "./sidebar";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import { ChatRow } from "./chat-row";
import { compareChats } from "./chat-order";
import { ChatView } from "./chat";
import { useChatSummaries } from "./chat-state";
import { memory, persist, flush } from "./workspace";

export function AgentsView() {
  const { chats: catalogue, error: summaryError } = useChatSummaries();
  const [archived, setArchived] = useState(false);
  const chats = [...catalogue].filter(c => !!c.archived === archived).sort(compareChats);
  const [selected, setSelected] = useState(memory.agentsChat ?? "");
  const [error, setError] = useState("");
  const [targets, setTargets] = useState<{ project: string | null; checkout: string }[]>([]);
  const creating = useRef(false);
  const [busy, setBusy] = useState(false);
  const [targetError, setTargetError] = useState("");

  const create = async (project?: string | null) => {
    if (creating.current) return;
    creating.current = true;
    setBusy(true);
    try {
      await flush();
      if (project === undefined) {
        const available = await window.escode.chat("targets");
        const editor = memory.projectUse?.find(use => use.checkout && available.some(t => t.project === use.project));
        project = editor?.project ?? available.find(t => t.project !== null)?.project ?? null;
      }
      const draft = await window.escode.chat("createDraft", project);
      memory.agentsChat = draft.id;
      await persist();
      setTargets(await window.escode.chat("targets"));
      setSelected(draft.id);
    } catch (e) {
      setError(String(e));
    } finally { creating.current = false; setBusy(false); }
  };
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        await flush();
        const available = await window.escode.chat("targets");
        if (live) setTargets(available);
        if (live) setTargetError("");
      } catch (e) {
        if (live) setTargetError(String(e));
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
  const chat = catalogue.find((c) => c.id === selected);
  return (
    <section className="agents" aria-label="Agents">
      <div className="agents-heading">
        <h1>Agents</h1>
        <span>Conversations across saved projects</span>
      </div>
      <div className="workspace">
        <SidebarResize />
        <aside aria-label="Agents chats">
          <Button disabled={busy} onClick={() => {
            setError("");
            void create();
          }}>New chat</Button>
          <Button onClick={() => void create(null)}>No project</Button>
          {!targets.length && (
            <Button onClick={() => void create(null)}>Start without a project</Button>
          )}
          {chats === null && <p role="status">Loading chats…</p>}
          {chats?.length === 0 && <p>No saved chats. Start without a project or open a project.</p>}
          <ul>
            {chats?.map((c) => (
              <ChatRow
                key={c.id}
                chat={c}
                fallbackTitle={`Chat ${catalogue.filter(chat => chat.project === c.project).findIndex(chat => chat.id === c.id) + 1}`}
                selected={selected === c.id}
                select={() => {
                  memory.agentsChat = c.id;
                  void persist();
                  setSelected(c.id);
                }}
              />
            ))}
          </ul>
          <ArchiveFooter archived={archived} toggle={() => setArchived(!archived)} />
          {(error || targetError || summaryError) && <p role="alert">{error || targetError || summaryError}</p>}
        </aside>
        <section className="content" aria-label="Agent conversation">
          <div className="chat-conversation">
            {chat && !!chat.archived !== archived && <p role="status">This conversation belongs to the {chat.archived ? "Archived" : "Recent"} list.</p>}
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
