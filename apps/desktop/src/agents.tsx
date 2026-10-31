import { SidebarResize } from "./sidebar";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import type { ChatSummary } from "@escode/contracts";
import { compareChats } from "./chat-order";
import { ChatView } from "./chat";
import { useChatSummaries } from "./chat-state";
import { memory, persist, flush, rememberProjectUse } from "./workspace";

function ChatRow({
  chat,
  selected,
  select,
}: {
  chat: ChatSummary;
  selected: boolean;
  select: () => void;
}) {
  const { chats } = useChatSummaries();
  const status = chat.needsInput ? "Needs input" : chat.busy ? "Running" : chat.unavailable ? "Unavailable" : chat.phase === "draft" ? "Draft" : chat.initialSend === "uncertain" || chat.initialSend === "creating" ? "Uncertain" : "Stopped";
  return (
    <li>
      <Button className="agent-row" aria-pressed={selected} onClick={select}>
        <strong>
          Chat{" "}
          {Math.max(
            0,
            chats.filter(c => c.project === chat.project).findIndex((c) => c.id === chat.id),
          ) + 1}
        </strong>
        <span>{chat.project?.split("/").at(-1) ?? "No project"}</span>
        <small>{status}</small>
      </Button>
    </li>
  );
}
function ProjectPicker({ targets, create, dismiss, error }: {
  targets: { project: string | null; checkout: string }[];
  create: (project: string | null) => Promise<void>;
  dismiss: () => void;
  error: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const choices = [...targets.filter(t => t.project !== null), { project: null, checkout: "" }]
    .filter(t => {
      const label = (t.project?.split("/").at(-1) ?? "No project").toLowerCase();
      let position = 0;
      for (const character of query.trim().toLowerCase()) {
        const found = label.indexOf(character, position);
        if (found < 0) return false;
        position = found + 1;
      }
      return true;
    });
  const active = Math.min(selected, choices.length - 1);
  useEffect(() => {
    const origin = document.activeElement;
    const popup = dialog.current!;
    popup.showModal();
    return () => { popup.close(); if (origin instanceof HTMLElement) origin.focus(); };
  }, []);
  useEffect(() => {
    dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, query]);
  const choose = async (project: string | null) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try { await create(project); }
    finally { submitting.current = false; setBusy(false); }
  };
  return (
    <dialog ref={dialog} className="project-picker" aria-labelledby="project-picker-title"
      onCancel={event => { event.preventDefault(); if (!busy) dismiss(); }}
      onClick={event => {
        if (event.target !== event.currentTarget || busy) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dismiss();
      }}>
      <h2 id="project-picker-title">Choose project</h2>
      <input role="combobox" aria-label="New chat project" aria-expanded="true"
        aria-controls="project-picker-results" aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `project-choice-${active}` : undefined}
        autoFocus value={query} disabled={busy} placeholder="Search saved projects…"
        onChange={event => { setQuery(event.target.value); setSelected(0); }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setSelected(Math.max(0, Math.min(choices.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (active >= 0) void choose(choices[active].project);
          }
        }} />
      <ul id="project-picker-results" role="listbox" aria-label="Saved projects">
        {choices.map((target, index) => (
          <li role="option" id={`project-choice-${index}`} key={target.project ?? "no-project"}
            aria-selected={index === active} aria-disabled={busy}
            onMouseDown={event => event.preventDefault()}
            onClick={() => void choose(target.project)}>
            <strong>{target.project?.split("/").at(-1) ?? "No project"}</strong>
            {target.project && <small>{target.project}</small>}
          </li>
        ))}
      </ul>
      <p role="status">{busy ? "Creating draft…" : choices.length ? `${choices.length} choices · All saved projects` : "No matching projects"}</p>
      {error && <p role="alert">{error}</p>}
      <Button disabled={busy} onClick={dismiss}>Cancel</Button>
    </dialog>
  );
}

export function AgentsView() {
  const { chats: catalogue, error: summaryError } = useChatSummaries();
  const chats = [...catalogue].sort(compareChats);
  const [selected, setSelected] = useState(memory.agentsChat ?? "");
  const [error, setError] = useState("");
  const [targets, setTargets] = useState<{ project: string | null; checkout: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [targetError, setTargetError] = useState("");
  const dismissPicker = () => { setPicking(false); };
  const create = async (project: string | null) => {
    try {
      await flush();
      const draft = await window.escode.chat("createDraft", project);
      if (project) rememberProjectUse(project);
      memory.agentsChat = draft.id;
      await persist();
      setTargets(await window.escode.chat("targets"));
      setSelected(draft.id);
      dismissPicker();
    } catch (e) {
      setError(String(e));
    }
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
  const chat = chats?.find((c) => c.id === selected);
  return (
    <section className="agents" aria-label="Agents">
      <div className="agents-heading">
        <h1>Agents</h1>
        <span>Conversations across saved projects</span>
      </div>
      <div className="workspace">
        <SidebarResize />
        <aside aria-label="Agents chats">
          <Button onClick={() => { setError(""); setPicking(true); }}>New chat</Button>
          <Button onClick={() => void create(null)}>No project</Button>
          {!targets.length && (
            <Button onClick={() => void create(null)}>Start without a project</Button>
          )}
          {picking && <ProjectPicker targets={targets} create={create} dismiss={dismissPicker} error={error || targetError} />}
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
                  if (c.project) rememberProjectUse(c.project);
                  memory.agentsChat = c.id;
                  void persist();
                  setSelected(c.id);
                }}
              />
            ))}
          </ul>
          {(error || targetError || summaryError) && <p role="alert">{error || targetError || summaryError}</p>}
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
