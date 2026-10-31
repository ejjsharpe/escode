import { ArchiveFooter } from "./archive-footer";
import { ChatRow } from "./chat-row";
import { Boundaries } from "./boundaries";
import { DraftWorktreeChoices, CheckoutBranch } from "./worktrees";
import { useProjectChats } from "./chat-state";
import { memory, persist } from "./workspace";
import { compareChats } from "./chat-order";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@base-ui/react/button";
import type { SavedChat } from "../host/chat";
import type { ChatSnapshot, LiveRequest } from "../host/chat-service";
export interface ChatBridge {
  (operation: "permissions", project: string | null, id: string, choice?: "supervised" | "edits" | "full"): Promise<import("@escode/contracts").PermissionChoices>;
  (operation: "archive", project: string | null, id: string, archived: boolean): Promise<unknown>;
  (operation: "renameTitle", project: string | null, id: string, title: string): Promise<void>;
  (operation: "regenerateTitle", project: string | null, id: string): Promise<void>;
  (operation: "models", project: string | null, id: string, model?: string, effort?: string): Promise<import("@escode/contracts").ModelChoices>;
  (operation: "composer", project: string | null, id: string): Promise<string>;
  (operation: "targets"): Promise<{ project: string | null; checkout: string }[]>;
  (operation: "createDraft", project: string | null, checkout?: string): Promise<SavedChat>;
  (
    operation: "context",
    project: string | null,
    id: string,
    target: string | null,
  ): Promise<SavedChat>;
  (
    operation: "execution",
    project: string,
    id: string,
    mode: "new" | "reuse",
    value: string,
    commit: string,
  ): Promise<SavedChat>;

  (operation: "create", project: string, checkout: string): Promise<SavedChat>;
  (operation: "open", project: string | null, id: string): Promise<ChatSnapshot>;
  (operation: "send", project: string | null, id: string, text: string): Promise<string>;
  (operation: "draft", project: string | null, id: string, text: string): Promise<void>;
  (operation: "stop" | "emergencyStop", project: string | null, id: string, target?: string): Promise<void | { reason: "emergency-stop-available"; message: string }>;
  (operation: "disconnect" | "resolveSend", project: string | null, id: string): Promise<void>;
  (
    operation: "answer",
    project: string | null,
    id: string,
    token: string,
    answer: unknown,
  ): Promise<void>;
}
function ModelControls({ project, id, onSaving, existingError }: { project: string | null; id: string; onSaving: (saving: boolean) => void; existingError?: string | null }) {
  const [permissions, setPermissions] = useState<import("@escode/contracts").PermissionChoices | null>(null);
  const [catalog, setCatalog] = useState<import("@escode/contracts").ModelChoices | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let current = true;
    void window.escode.chat("permissions", project, id).then(value => { if (current) setPermissions(value); }).catch(e => { if (current) setError(String(e)); });
    void window.escode.chat("models", project, id).then(value => { if (current) setCatalog(value); }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [project, id]);
  const choose = async (model: string, effort?: string) => {
    setSaving(true); onSaving(true);
    try { setCatalog(await window.escode.chat("models", project, id, model, effort)); setError(""); }
    catch (e) { setError(String(e)); }
    finally { setSaving(false); onSaving(false); }
  };
  const model = catalog?.models.find(m => m.model === catalog.choice?.model);
  return <div className="chat-model-controls" aria-label="Next message settings" title="Applies only to your next explicit Send">
    <span>Next message</span>
    <label>Model <select aria-label="Next message model" disabled={saving || !catalog} value={catalog?.choice?.model ?? ""} onChange={e => void choose(e.target.value)}>
      <option value="" disabled>Codex configured default</option>
      {catalog?.choice && !model && <option value={catalog.choice.model}>{catalog.choice.model} (unavailable)</option>}
      {catalog?.models.map(m => <option key={m.model} value={m.model}>{m.name}</option>)}
    </select></label>
    {catalog?.choice && <label>Effort <select aria-label="Next message effort" disabled={saving || !model} value={catalog.choice.effort} onChange={e => void choose(catalog.choice!.model, e.target.value)}>
      {!model?.efforts.includes(catalog.choice.effort) && <option value={catalog.choice.effort}>{catalog.choice.effort} (unavailable)</option>}
      {model?.efforts.map(e => <option key={e} value={e}>{e}</option>)}
    </select></label>}
    <label title="Supervised: read-only with approval. Auto-accept edits: workspace and temporary-directory writes, network blocked; broader access needs approval. Full access: no sandbox or command approval.">Permissions <select aria-label="Next message permissions" disabled={saving || !permissions || permissions.blocked} value={permissions?.blocked ? "" : permissions?.choice ?? ""} onChange={async e => {
      setSaving(true); onSaving(true);
      try { setPermissions(await window.escode.chat("permissions", project, id, e.target.value as "supervised" | "edits" | "full")); setError(""); }
      catch (e) { setError(String(e)); } finally { setSaving(false); onSaving(false); }
    }}><option value="" disabled>{permissions?.blocked ? "Custom / managed Codex policy" : "Inherited Codex policy"}</option><option value="supervised">Supervised</option><option value="edits">Auto-accept edits</option><option value="full">Full access</option></select></label>
    {permissions?.message && <span role="status">{permissions.message}</span>}
    {error && !existingError && <span role="alert">{error}</span>}
  </div>;
}
function Request({
  request: wireRequest,
  answer,
  busy,
}: {
  request: import("@escode/contracts").ChatDetail["requests"][number];
  busy: boolean;
  answer: (value: unknown) => Promise<void>;
}) {
  const request = wireRequest as LiveRequest;
  const [values, setValues] = useState<Record<string, string>>({});
  const submit = answer;
  const [content, setContent] = useState("{}");
  const [inputError, setInputError] = useState("");
  if (request.method === "mcpServer/elicitation/request")
    return (
      <section className="live-request" aria-label="MCP server needs input">
        <h2>{request.params.serverName} requests information</h2>
        <p>{request.params.message}</p>
        {request.params.mode === "url" ? (
          <label>
            Open this address in your browser, complete the step, then confirm.
            <input aria-label="Authorization URL" readOnly value={request.params.url} />
          </label>
        ) : (
          <>
            <details>
              <summary>Requested information format</summary>
              <pre>{JSON.stringify(request.params.requestedSchema, null, 2)}</pre>
            </details>
            <label>
              Response (JSON object)
              <textarea
                aria-label="MCP response"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </label>
          </>
        )}
        {inputError && <p role="alert">{inputError}</p>}
        <Button
          disabled={busy}
          onClick={() => {
            try {
              const value = request.params.mode === "url" ? null : JSON.parse(content);
              setInputError("");
              void submit({ action: "accept", content: value });
            } catch {
              setInputError("Enter a valid JSON object in the requested format.");
            }
          }}
        >
          {request.params.mode === "url" ? "I completed this step" : "Send information"}
        </Button>{" "}
        <Button disabled={busy} onClick={() => void submit({ action: "decline" })}>
          Decline
        </Button>{" "}
        <Button disabled={busy} onClick={() => void submit({ action: "cancel" })}>
          Cancel request
        </Button>
      </section>
    );
  const questions =
    request.method === "item/tool/requestUserInput" ? request.params.questions : null;
  return (
    <section className="live-request" aria-label="Codex needs input">
      <h2>{questions ? "Codex needs your input" : "Codex requests permission"}</h2>
      {questions ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(values);
          }}
        >
          {questions.map((q) => (
            <label key={q.id}>
              {q.question}
              {q.options && (
                <p>{q.options.map((o) => `${o.label}: ${o.description}`).join("\n")}</p>
              )}
              <input
                required
                type={q.isSecret ? "password" : "text"}
                value={values[q.id] ?? ""}
                onChange={(e) => setValues({ ...values, [q.id]: e.target.value })}
              />
            </label>
          ))}
          <Button type="submit" disabled={busy}>
            Send answers
          </Button>
        </form>
      ) : (
        <>
          <pre>{JSON.stringify(request.params, null, 2)}</pre>
          <Button disabled={busy} onClick={() => void submit("accept")}>
            {request.method === "item/permissions/requestApproval"
              ? "Allow for this turn"
              : "Allow once"}
          </Button>{" "}
          <Button disabled={busy} onClick={() => void submit("decline")}>
            Decline
          </Button>{" "}
          <Button disabled={busy} onClick={() => void submit("cancel")}>
            Cancel request
          </Button>
        </>
      )}
    </section>
  );
}
export function ChatView({
  project,
  checkout,
  sidebarId,
  selected,
  select,
  createChat,
  global = false,
}: {
  project: string | null;
  checkout: string;
  sidebarId: string;
  selected: string;
  select: (id: string) => Promise<void>;
  createChat?: (root: string) => Promise<void>;
  global?: boolean;
}) {
  const [store, { chats, snapshots, history, drafts, pending, responding, errors, emergencyTargets }] =
    useProjectChats(project);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [targets, setTargets] = useState<{ project: string | null; checkout: string }[]>([]);
  useEffect(() => {
    void window.escode.chat("targets").then(setTargets);
  }, []);
  const [archived, setArchived] = useState(false);
  const scopedChats = global ? chats : chats.filter(c => c.checkout === checkout && (c.phase !== "draft" || !c.worktree));
  const record = scopedChats.find((c) => c.id === selected);
  const unsent = record?.phase === "draft";
  const error = errors[selected] || errors[""] || "";
  const working = !!pending[selected];
  const draft = drafts[selected] ?? "";
  useEffect(() => {
    if (!selected) return;
    const release = store.observe(selected);
    void store.open(selected);
    return release;
  }, [store, selected]);
  const run = (action: () => Promise<unknown>) => store.run(selected, action);
  const snapshot = snapshots[selected];
  const page = history[selected];
  const liveItems = (snapshot?.items ?? []).filter(item => !item.revision);
  const items = page
    ? [...page.items.filter(saved => !liveItems.some(item => saved.id === item.id && saved.turnId === item.turnId)), ...liveItems]
    : snapshot?.items ?? [];
  const changeContext = (target: string | null) =>
    run(async () => {
      const moved = await window.escode.chat("context", project, selected, target);
      await store.load();
      if (target !== project || !global && moved.checkout !== checkout) {
        memory.agentsChat = moved.id;
        memory.selected = "agents";
        await persist();
        window.dispatchEvent(new Event("draft-context-changed"));
      }
    });
  return (
    <>
      {!global &&
        document.getElementById(sidebarId) &&
        createPortal(
          <div className="chat-list" aria-label="Saved chats">
            <Button
              disabled={working}
              onClick={() =>
                void run(async () => {
                  await createChat?.(checkout);
                })
              }
            >
              New chat on current checkout
            </Button>
            <ul>
              {[...scopedChats].filter(c => !!c.archived === archived).sort(compareChats).map((c) => (
                <ChatRow key={c.id} fallbackTitle={`Chat ${chats.findIndex(chat => chat.id === c.id) + 1}`} chat={c} selected={selected === c.id} select={() => void select(c.id)} />
              ))}
            </ul>
            <ArchiveFooter archived={archived} toggle={() => setArchived(!archived)} />
          </div>,
          document.getElementById(sidebarId)!,
        )}
      <>
        {!record ? (
          <p>Create or select a saved chat to begin. Choose the current checkout or a worktree.</p>
        ) : (
          <>
            {!global && !!record.archived !== archived && <p role="status">This conversation belongs to the {record.archived ? "Archived" : "Recent"} list.</p>}

            {!record.archived && ["uncertain", "creating", "preparing"].includes(record.initialSend ?? "") && <p role="status">Archive is blocked until the pending or uncertain operation is resolved.</p>}
            {record.archived && <p role="status">Archived conversation. Restore to send another message.</p>}
            {chats.find((c) => c.id === selected)?.removed && (
              <p role="status">
                Checkout removed. History and drafts are retained; this chat cannot run.
              </p>
            )}
            <div className="conversation-heading">
              <h2 title={record.title}>{record.title || `Chat ${chats.findIndex((c) => c.id === selected) + 1}`}</h2>
              <TitleActions project={project} id={selected} title={record.title ?? ""}>
              <Button disabled={!record.archived && (working || snapshot?.busy || !!snapshot?.requests.length || record.initialSend === "uncertain" || record.initialSend === "creating" || record.initialSend === "preparing")}
                onClick={() => void run(() => window.escode.chat("archive", project, selected, !record.archived))}>{record.archived ? "Restore chat" : "Archive chat"}</Button>
              {!record.archived && (working || snapshot?.busy || !!snapshot?.requests.length) && <p>Archive requires an idle chat without unresolved work.</p>}
              </TitleActions>
              <p>{project?.split("/").at(-1) ?? "No project"}</p>
            </div>
            <p className="directory">
              {project === null
                ? "Scratch folder: "
                : record?.worktree && !record.worktree.reservation
                  ? "Source checkout: "
                  : "Checkout: "}
              {record?.checkout || "Allocated on first Send"}
            </p>
            {record?.checkout && chats.filter((c) => c.checkout === record.checkout).length > 1 && (
              <p>These chats share files in this checkout. Their edits can interact.</p>
            )}
            {project !== null &&
              record?.checkout &&
              (record.phase !== "draft" || !record.worktree) && (
                <CheckoutBranch root={record.checkout} />
              )}
            <div className="chat-actions">
              {global && project && record?.checkout && !record.removed && (record.phase !== "draft" || !record.worktree) && (
                <Button onClick={() => window.dispatchEvent(new CustomEvent("open-checkout", { detail: { project, id: record.id } }))}>
                  Open checkout
                </Button>
              )}
              <Button
                disabled={working}
                onClick={() => void store.reconnect(selected)}
              >
                Retry connection / reload history
              </Button>
              <Button disabled={working || snapshot?.busy} onClick={() => void window.escode.chat("resolveSend", project, selected).then(() => store.reconnect(selected))}>
                Resolve previous Send…
              </Button>
              <Button
                disabled={!(snapshot?.busy || snapshot?.preparing) || !snapshot?.controlTarget}
                onClick={() => void store.stop(selected)}
              >
                Stop
              </Button>
              {emergencyTargets[selected] && <><Button onClick={() => void store.emergencyStop(selected)}>Emergency Stop</Button><span>Emergency Stop may not be recorded. External effects may remain; reserved resources are retained.</span></>}
              <span role="status">
                {working && (!snapshot || (unsent && !snapshot.busy && !snapshot.requests.length))
                  ? unsent
                    ? "Preparing…"
                    : "Loading conversation…"
                  : snapshot?.requests.length
                    ? "Needs input"
                    : snapshot?.busy
                      ? "Running"
                      : snapshot?.contextError
                        ? "Unavailable"
                        : snapshot?.connected
                          ? "Ready"
                          : unsent
                            ? "Draft"
                            : record?.initialSend === "uncertain"
                              ? "Acceptance uncertain · Retry to inspect history"
                              : record?.phase === "bound"
                                ? "Bound · Disconnected"
                                : "Disconnected"}
              </span>
            </div>
            {error && <p role="alert">{error}</p>}
            {(snapshot?.contextError || snapshot?.error) && (
              <p role="alert">{snapshot?.contextError || snapshot?.error}</p>
            )}
            {record?.initialSend === "uncertain" && (
              <p role="status">
                Message acceptance is uncertain. Prompt and provider identity are retained. Retry
                reloads history without resending; inspect history before explicitly sending another
                message.
              </p>
            )}
            {record?.initialSend === "creating" && (
              <p role="status">
                Provider creation may be incomplete. Known identity and the chosen checkout are
                retained; Retry never creates a replacement for an uncertain conversation.
              </p>
            )}
            <div className="transcript" role="region" aria-label="Conversation history">
              <Boundaries key={selected} project={project} id={selected} />
              {Boolean(snapshot?.settings) && (
                <details>
                  <summary>Effective Codex settings · {(snapshot!.settings as { model?: string }).model}</summary>
                  <pre>{JSON.stringify(snapshot.settings, null, 2)}</pre>
                </details>
              )}
              {(history[selected] || snapshot?.history) && (
                <nav aria-label="History pages">
                  <Button disabled={working} onClick={() => store.history(selected, null)}>First history page</Button>
                  <Button disabled={working || !(history[selected] ?? snapshot?.history)?.nextCursor}
                    onClick={() => store.history(selected, (history[selected] ?? snapshot?.history)?.nextCursor ?? null)}>Next history page</Button>
                  <p aria-live="polite">Showing one history page. Other portions are not loaded.</p>
                </nav>
              )}
              {items.map((item) => (
                <article key={item.turnId + item.id}>
                  <h2>
                    {item.type === "userMessage"
                      ? "You"
                      : item.type === "agentMessage"
                        ? "Codex"
                        : item.type}
                  </h2>
                  <pre>{item.text}</pre>
                </article>
              ))}
              {snapshot?.requests.map((request) => (
                <Request
                  key={request.token}
                  request={request}
                  busy={!!responding[request.token]}
                  answer={(value) => store.answer(snapshot.chatId, request.token, value)}
                />
              ))}
            </div>
            <form
              className="chat-compose"
              onSubmit={(e) => {
                e.preventDefault();
                if (!record.archived && !settingsSaving) void store.send(selected);
              }}
            >
              {unsent && !record?.scratch && !record?.worktree?.reservation && (
                <label>
                  Project context
                  <select
                    aria-label="Project context"
                    value={project ?? ""}
                    disabled={working}
                    onChange={(e) => void changeContext(e.target.value || null)}
                  >
                    <option value="">No project</option>
                    {targets
                      .filter((t) => t.project !== null)
                      .map((t) => (
                        <option key={t.project!} value={t.project!}>
                          {t.project?.split("/").at(-1) ?? "No project"} · {t.project}
                        </option>
                      ))}
                  </select>
                  {project !== null && (
                    <Button
                      type="button"
                      disabled={working}
                      onClick={() => void changeContext(project)}
                    >
                      Use current checkout
                    </Button>
                  )}
                </label>
              )}
              {record && project !== null && unsent && !record.worktree?.reservation && (
                <DraftWorktreeChoices
                  key={record.id + record.checkout}
                  chat={record}
                  busy={working}
                  choose={(mode, value, commit) =>
                    run(async () => {
                      const moved = await window.escode.chat("execution", project, selected, mode, value, commit);
                      if (!global && (moved.checkout !== checkout || moved.worktree)) {
                        memory.agentsChat = moved.id;
                        await persist();
                        window.dispatchEvent(new Event("draft-context-changed"));
                      }
                      await store.load();
                    })
                  }
                />
              )}
              {record?.worktree && !record.worktree.reservation && (
                <p>
                  Local base: {record.worktree.ref} · <code>{record.worktree.commit}</code>
                  {!record.worktree.reservation &&
                    " · New managed branch and path allocated on first Send"}
                </p>
              )}
              {record?.worktree?.reservation && (
                <details open={!!record.worktree.reservation.error}>
                  <summary>Prepared worktree details</summary>
                  <p>
                    Local base: {record.worktree.ref} · <code>{record.worktree.commit}</code>
                  </p>
                  <p>
                    Retained branch: <code>{record.worktree.reservation.branch}</code>
                    <Button
                      type="button"
                      onClick={() =>
                        void run(() =>
                          navigator.clipboard.writeText(record.worktree!.reservation!.branch),
                        )
                      }
                    >
                      Copy branch
                    </Button>
                  </p>
                  {record.worktree.reservation.error && (
                    <p role="alert">{record.worktree.reservation.error}</p>
                  )}
                </details>
              )}
              {record?.checkout && record.worktree && !record.worktree.reservation && (
                <Button
                  type="button"
                  onClick={() => void run(() => navigator.clipboard.writeText(record.checkout))}
                >
                  {record.worktree && !record.worktree.reservation
                    ? "Copy source checkout path"
                    : "Copy execution path"}
                </Button>
              )}
              <label htmlFor={sidebarId + "-message"}>Message Codex</label>
              <textarea
                disabled={working}
                id={sidebarId + "-message"}
                maxLength={100000}
                value={draft}
                onChange={(e) => {
                  store.edit(selected, e.target.value);
                }}
              />
              <ModelControls key={selected} project={project} id={selected} onSaving={setSettingsSaving} existingError={error || snapshot?.contextError} />
              <Button
                type="submit"
                disabled={
                  record.archived || working || settingsSaving ||
                  !!snapshot?.contextError ||
                  (!!record?.scratch && !!(error || snapshot?.error)) ||
                  (!unsent && !snapshot?.connected) ||
                  snapshot?.busy ||
                  !draft.trim()
                }
              >
                Send message
              </Button>
              <p>Stop retains completed file changes. Send a new message to continue.</p>
            </form>
          </>
        )}
        {!selected && error && <p role="alert">{error}</p>}
      </>
    </>
  );
}

function TitleActions({ project, id, title, children }: { project: string | null; id: string; title: string; children: React.ReactNode }) {
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setError("");
    try { await action(); } catch (failure) { setError(String(failure)); }
  };
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  useEffect(() => { setEditing(false); setValue(title); }, [id, title]);
  return <details className="title-actions"><summary>Chat actions</summary>
    {children}
    {error && <p role="alert">{error}</p>}
    <Button onClick={() => { setValue(title); setEditing(true); }}>Rename</Button>
    <Button onClick={() => void run(() => window.escode.chat("regenerateTitle", project, id))}>Regenerate title</Button>
    {editing && <form onSubmit={event => { event.preventDefault(); void run(async () => {
      await window.escode.chat("renameTitle", project, id, value); setEditing(false);
    }); }}>
      <label>Chat title<input autoFocus maxLength={256} value={value} onChange={event => setValue(event.target.value)} /></label>
      <Button type="submit">Save title</Button><Button type="button" onClick={() => setEditing(false)}>Cancel</Button>
    </form>}
  </details>;
}
