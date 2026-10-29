import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@base-ui/react/button";
import type { SavedChat } from "../host/chat";
import type { ChatSnapshot, LiveRequest } from "../host/chat-service";
export interface ChatBridge {
  (operation: "list"): Promise<SavedChat[]>;
  (operation: "create"): Promise<SavedChat>;
  (operation: "open" | "snapshot", id: string): Promise<ChatSnapshot>;
  (operation: "send" | "draft", id: string, text: string): Promise<unknown>;
  (operation: "stop" | "disconnect", id: string): Promise<void>;
  (operation: "answer", id: string, token: string, answer: unknown): Promise<void>;
}
function Request({
  request,
  answer,
}: {
  request: LiveRequest;
  answer: (value: unknown) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (value: unknown) => {
    setBusy(true);
    try {
      await answer(value);
    } finally {
      setBusy(false);
    }
  };
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
// Keep this view mounted while navigating so drafts and the selected chat survive.
export function ChatView({
  project,
  onActivity,
}: {
  project: string;
  onActivity: (activity: string) => void;
}) {
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [selected, setSelected] = useState("");
  const [snapshots, setSnapshots] = useState<Record<string, ChatSnapshot>>({});
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const drafts = useRef<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const all = Object.values(snapshots);
    onActivity(
      all.some((s) => s.requests.length) ? "Needs input" : all.some((s) => s.busy) ? "Running" : "",
    );
  }, [snapshots, onActivity]);
  const selectedRef = useRef("");
  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const load = async () => {
    const list = await window.escode.chat("list");
    setChats(list);
    for (const c of list) if (!(c.id in drafts.current)) drafts.current[c.id] = c.draft;
    return list;
  };
  useEffect(() => {
    void load().catch(report);
  }, [project]);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const updates = await Promise.all(chats.map((c) => window.escode.chat("snapshot", c.id)));
        if (alive) setSnapshots(Object.fromEntries(updates.map((s) => [s.chatId, s])));
      } catch (e) {
        if (alive) report(e);
      }
    };
    const timer = setInterval(() => void poll(), 300);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [chats]);
  const select = async (id: string) => {
    selectedRef.current = id;
    setSelected(id);
    setDraft(drafts.current[id] ?? "");
    setError("");
    try {
      const value = await window.escode.chat("open", id);
      setSnapshots((old) => ({ ...old, [id]: value }));
    } catch (e) {
      if (selectedRef.current === id) report(e);
    }
  };
  const run = async (action: () => Promise<unknown>) => {
    setWorking(true);
    setError("");
    try {
      await action();
    } catch (e) {
      report(e);
    } finally {
      setWorking(false);
    }
  };
  const snapshot = snapshots[selected];
  return (
    <div className="chat-view">
      {createPortal(
        <div className="chat-list" aria-label="Saved chats">
          <Button
            disabled={working}
            onClick={() =>
              void run(async () => {
                const c = await window.escode.chat("create");
                await load();
                await select(c.id);
              })
            }
          >
            New chat on current checkout
          </Button>
          <ul>
            {chats.map((c, index) => (
              <li key={c.id}>
                <Button aria-pressed={selected === c.id} onClick={() => void select(c.id)}>
                  Chat {index + 1}
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
        document.getElementById("chat-sidebar")!,
      )}
      <div className="chat-conversation">
        {!selected ? (
          <p>Create or select a saved chat to begin. Chats use the current checkout.</p>
        ) : (
          <>
            <p className="directory">Checkout: {chats.find((c) => c.id === selected)?.checkout}</p>
            {chats.length > 1 && (
              <p>These chats share files in this checkout. Their edits can interact.</p>
            )}
            {snapshot?.settings && (
              <details>
                <summary>Effective Codex settings · {snapshot.settings.model}</summary>
                <pre>{JSON.stringify(snapshot.settings, null, 2)}</pre>
              </details>
            )}
            <div className="chat-actions">
              <Button
                disabled={working || snapshot?.busy}
                onClick={() =>
                  void run(async () => {
                    await window.escode.chat("disconnect", selected);
                    await select(selected);
                  })
                }
              >
                Retry connection / reload history
              </Button>
              <Button
                disabled={working || !snapshot?.busy || !snapshot.turnId}
                onClick={() => void run(() => window.escode.chat("stop", selected))}
              >
                Stop
              </Button>
              <span role="status">
                {snapshot?.requests.length
                  ? "Needs input"
                  : snapshot?.busy
                    ? "Running"
                    : snapshot?.connected
                      ? "Ready"
                      : "Disconnected"}
              </span>
            </div>
            <div className="transcript" aria-label="Conversation history">
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
            </div>
            {snapshot?.requests.map((request) => (
              <Request
                key={request.token}
                request={request}
                answer={async (value) => {
                  try {
                    await window.escode.chat("answer", selected, request.token, value);
                  } catch (e) {
                    report(e);
                  }
                }}
              />
            ))}
            {(error || snapshot?.error) && <p role="alert">{error || snapshot?.error}</p>}
            <form
              className="chat-compose"
              onSubmit={(e) => {
                e.preventDefault();
                const id = selected,
                  text = draft;
                void run(async () => {
                  await window.escode.chat("draft", id, text);
                  await window.escode.chat("send", id, text);
                  drafts.current[id] = "";
                  if (selectedRef.current === id) setDraft("");
                });
              }}
            >
              <label htmlFor="chat-message">Message Codex</label>
              <textarea
                disabled={working}
                id="chat-message"
                maxLength={100000}
                value={draft}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft(value);
                  drafts.current[selected] = value;
                  void window.escode.chat("draft", selected, value).catch(report);
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
      </div>
    </div>
  );
}
