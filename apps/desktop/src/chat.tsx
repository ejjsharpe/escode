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
  (operation: "composer", project: string | null, id: string): Promise<string>;
  (operation: "targets"): Promise<{ project: string | null; checkout: string }[]>;
  (operation: "createDraft", project: string | null): Promise<SavedChat>;
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
  (operation: "open" | "snapshot", project: string | null, id: string): Promise<ChatSnapshot>;
  (operation: "send" | "draft", project: string | null, id: string, text: string): Promise<unknown>;
  (operation: "stop" | "disconnect", project: string | null, id: string): Promise<void>;
  (
    operation: "answer",
    project: string | null,
    id: string,
    token: string,
    answer: unknown,
  ): Promise<void>;
}
function Request({
  request,
  answer,
  busy,
}: {
  request: LiveRequest;
  busy: boolean;
  answer: (value: unknown) => Promise<void>;
}) {
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
          {questions.map((q: any) => (
            <label key={q.id}>
              {q.question}
              {q.options && (
                <p>{q.options.map((o: any) => `${o.label}: ${o.description}`).join("\n")}</p>
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
  const [store, { chats, snapshots, history, drafts, pending, responding, errors }] =
    useProjectChats(project);
  const [targets, setTargets] = useState<{ project: string | null; checkout: string }[]>([]);
  useEffect(() => {
    void window.escode.chat("targets").then(setTargets);
  }, []);
  const record = chats.find((c) => c.id === selected);
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
  const changeContext = (target: string | null) =>
    run(async () => {
      const moved = await window.escode.chat("context", project, selected, target);
      await store.load();
      if (target !== project) {
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
              {[...chats].sort(compareChats).map((c) => (
                <li key={c.id}>
                  <Button aria-pressed={selected === c.id} onClick={() => void select(c.id)}>
                    Chat {chats.findIndex((chat) => chat.id === c.id) + 1}
                    {c.needsInput
                      ? " · Needs input"
                      : c.busy
                        ? " · Running"
                        : ""}
                  </Button>
                </li>
              ))}
            </ul>
          </div>,
          document.getElementById(sidebarId)!,
        )}
      <>
        {!selected ? (
          <p>Create or select a saved chat to begin. Choose the current checkout or a worktree.</p>
        ) : (
          <>
            {chats.find((c) => c.id === selected)?.removed && (
              <p role="status">
                Checkout removed. History and drafts are retained; this chat cannot run.
              </p>
            )}
            <div className="conversation-heading">
              <h2>Chat {chats.findIndex((c) => c.id === selected) + 1}</h2>
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
              (!record.worktree || record.worktree.reservation) && (
                <CheckoutBranch root={record.checkout} />
              )}
            <div className="chat-actions">
              <Button
                disabled={working || snapshot?.busy}
                onClick={() =>
                  void run(async () => {
                    const id = selected;
                    await window.escode.chat("disconnect", project, id);
                    await window.escode.chat("open", project, id);
                  })
                }
              >
                Retry connection / reload history
              </Button>
              <Button
                disabled={!snapshot?.busy || !snapshot.turnId}
                onClick={() => void store.stop(selected)}
              >
                Stop
              </Button>
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
            {(snapshot?.contextError || error || snapshot?.error) && (
              <p role="alert">{snapshot?.contextError || error || snapshot?.error}</p>
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
              {snapshot?.settings && (
                <details>
                  <summary>Effective Codex settings · {snapshot.settings.model}</summary>
                  <pre>{JSON.stringify(snapshot.settings, null, 2)}</pre>
                </details>
              )}
              {(history[selected] || snapshot?.history) && (
                <nav aria-label="History pages">
                  <Button disabled={working} onClick={() => store.history(selected, null)}>First history page</Button>
                  <Button disabled={working || !(history[selected] ?? snapshot?.history)?.nextCursor}
                    onClick={() => store.history(selected, (history[selected] ?? snapshot?.history)?.nextCursor ?? null)}>Next history page</Button>
                  <p role="status">Showing one history page. Other portions are not loaded.</p>
                </nav>
              )}
              {(history[selected] ? [...history[selected].items, ...(snapshot?.items ?? []).filter(i => !i.revision && !history[selected].items.some(saved => saved.id === i.id && saved.turnId === i.turnId))] : snapshot?.items ?? []).map((item) => (
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
                void store.send(selected);
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
                      await window.escode.chat("execution", project, selected, mode, value, commit);
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
              <Button
                type="submit"
                disabled={
                  working ||
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
