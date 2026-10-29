import { useProjectChats } from "./chat-state";
import { compareChats } from "./chat-order";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@base-ui/react/button";
import type { SavedChat } from "../host/chat";
import type { ChatSnapshot, LiveRequest } from "../host/chat-service";
export interface ChatBridge {
  (operation: "catalogue"): Promise<SavedChat[]>;
  (operation: "list", project: string): Promise<SavedChat[]>;
  (operation: "create", project: string, checkout: string): Promise<SavedChat>;
  (operation: "open" | "snapshot", project: string, id: string): Promise<ChatSnapshot>;
  (operation: "send" | "draft", project: string, id: string, text: string): Promise<unknown>;
  (operation: "stop" | "disconnect", project: string, id: string): Promise<void>;
  (operation: "answer", project: string, id: string, token: string, answer: unknown): Promise<void>;
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
  project: string;
  checkout: string;
  sidebarId: string;
  selected: string;
  select: (id: string) => Promise<void>;
  createChat?: (root: string) => Promise<void>;
  global?: boolean;
}) {
  const [store, { chats, snapshots, drafts, pending, responding, errors }] =
    useProjectChats(project);
  const error = errors[selected] || errors[""] || "";
  const working = !!pending[selected];
  const draft = drafts[selected] ?? "";
  useEffect(() => {
    if (selected) void store.open(selected);
  }, [store, selected]);
  const run = (action: () => Promise<unknown>) => store.run(selected, action);
  const snapshot = snapshots[selected];
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
                    {snapshots[c.id]?.requests.length
                      ? " · Needs input"
                      : snapshots[c.id]?.busy
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
              <p>{project.split("/").at(-1)}</p>
            </div>
            <p className="directory">Checkout: {chats.find((c) => c.id === selected)?.checkout}</p>
            {chats.filter((c) => c.checkout === chats.find((c) => c.id === selected)?.checkout)
              .length > 1 && (
              <p>These chats share files in this checkout. Their edits can interact.</p>
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
                disabled={working || !snapshot?.busy || !snapshot.turnId}
                onClick={() => void run(() => window.escode.chat("stop", project, selected))}
              >
                Stop
              </Button>
              <span role="status">
                {working && !snapshot
                  ? "Loading conversation…"
                  : snapshot?.requests.length
                    ? "Needs input"
                    : snapshot?.busy
                      ? "Running"
                      : snapshot?.connected
                        ? "Ready"
                        : "Disconnected"}
              </span>
            </div>
            <div className="transcript" role="region" aria-label="Conversation history">
              {snapshot?.settings && (
                <details>
                  <summary>Effective Codex settings · {snapshot.settings.model}</summary>
                  <pre>{JSON.stringify(snapshot.settings, null, 2)}</pre>
                </details>
              )}
              {snapshot?.items.map((item) => (
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
              {(error || snapshot?.error) && <p role="alert">{error || snapshot?.error}</p>}
            </div>
            <form
              className="chat-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void store.send(selected);
              }}
            >
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
                disabled={working || !snapshot?.connected || snapshot.busy || !draft.trim()}
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
