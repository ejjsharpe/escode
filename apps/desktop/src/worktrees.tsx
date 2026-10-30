import React, { useEffect, useState, useRef } from "react";
import { Button } from "@base-ui/react/button";
import { persist, flush } from "./workspace";
import type { Project } from "../host/project";
type Options = ReturnType<Project["worktreeOptions"]>;
export function WorktreeChoices({
  createChat,
  project,
  onRemoved,
}: {
  project: string;
  onRemoved: () => Promise<unknown>;
  createChat: (root: string) => Promise<void>;
}) {
  const [managed, setManaged] = useState<ReturnType<Project["managedWorktrees"]>>([]);
  const [options, setOptions] = useState<Options>();
  const [reuse, setReuse] = useState("");
  const observation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const request = ++observation.current;
    const value = await window.escode.project("worktree-options", project);
    if (request !== observation.current) return;
    setOptions(value);
    setManaged(await window.escode.project("worktree-managed", project));
    setReuse("");
  };
  useEffect(() => {
    if (!options) return;
    let active = true;
    const timer = setInterval(() => {
      const request = ++observation.current;
      void window.escode.project("worktree-options", project).then(value => {
        if (active && request === observation.current) setOptions(value);
      }, error => { if (active) setError(String(error)); });
    }, 2000);
    return () => { active = false; clearInterval(timer); observation.current++; };
  }, [project, !!options]);
  return (
    <section className="worktree-choices" aria-label="Worktree chat choices">
      <Button disabled={busy} onClick={() => void run(refresh)}>
        Choose worktree…
      </Button>
      {options && (
        <fieldset disabled={busy}>
          <legend>Checkout for a new chat</legend>
          <p>
            New worktrees start from the committed state only. Staged, unstaged, untracked, ignored
            and unsaved edits stay in the original checkout. No fetch, setup or integration runs.
          </p>
          <p>Create a chat draft and choose its managed worktree before first Send.</p>
          <Button onClick={() => void run(refresh)}>Refresh bases and worktrees</Button>
          <label>
            Existing project worktree
            <select
              aria-label="Existing project worktree"
              value={reuse}
              onChange={(e) => setReuse(e.target.value)}
            >
              <option value="">Choose explicitly…</option>
              {options.checkouts.map((root) => (
                <option key={root} value={root}>
                  {root}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={!reuse} onClick={() => void run(() => createChat(reuse))}>
            Reuse worktree for chat
          </Button>
          <p>
            Chats on the same checkout share files; their edits can interact. Worktrees and branches
            are retained after work ends. Commit and integrate with external Git tools.
          </p>
        </fieldset>
      )}
      {managed.map((item) => (
        <section key={item.root} aria-label="Managed worktree removal">
          <p>
            Managed worktree: <code>{item.root}</code>
          </p>
          <p>
            Retained branch: <code>{item.branch}</code>
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await persist();
                await flush();
                if (await window.escode.project("worktree-remove", project, item.root)) {
                  await onRemoved();
                  setManaged(await window.escode.project("worktree-managed", project));
                }
              })
            }
          >
            Remove managed worktree…
          </Button>
        </section>
      ))}
      {busy && <p role="status">Preparing checkout…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function DraftWorktreeChoices({
  chat,
  busy,
  choose,
}: {
  chat: import("@escode/contracts").ChatSummary;
  busy: boolean;
  choose: (mode: "new" | "reuse", value: string, commit: string) => Promise<unknown>;
}) {
  const [options, setOptions] = useState<Options>();
  const [ref, setRef] = useState(chat.worktree?.ref ?? "");
  const [reuse, setReuse] = useState("");
  const observation = useRef(0);
  const [error, setError] = useState("");
  const refresh = async () => {
    const request = ++observation.current;
    try {
      const value = await window.escode.project(
        "worktree-options",
        chat.worktree?.source ?? chat.checkout,
      );
      if (request !== observation.current) return;
      setOptions(value);
      setRef((previous) => previous || value.defaultRef);
      setError("");
    } catch (e) {
      if (request === observation.current) setError(String(e));
    }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => { clearInterval(timer); observation.current++; };
  }, [chat.id, chat.checkout, chat.worktree?.source]);
  return (
    <details className="worktree-choices">
      <summary>Execution checkout choices</summary>
      <fieldset disabled={busy}>
        <legend>
          {chat.worktree ? "New managed worktree selected" : "Existing checkout selected"}
        </legend>
        <p>
          New worktrees use committed files only. Staged, unstaged, untracked, ignored and unsaved
          edits stay in the original checkout. No fetch or setup runs.
        </p>
        {options && (
          <>
            <label>
              Local base
              <select
                aria-label="Draft local base"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              >
                {!options.bases.some((b) => b.ref === ref) && (
                  <option value={ref}>{ref || "No committed base available"}</option>
                )}
                {options.bases.map((b) => (
                  <option key={b.ref} value={b.ref}>
                    {b.ref}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Resolved commit:{" "}
              <code>
                {options.bases.find((b) => b.ref === ref)?.commit ??
                  "Unavailable; choose another base"}
              </code>
            </p>
            <Button
              type="button"
              disabled={!options.bases.some((b) => b.ref === ref)}
              onClick={() =>
                void choose("new", ref, options.bases.find((b) => b.ref === ref)!.commit)
              }
            >
              Use new managed worktree on first Send
            </Button>
            <label>
              Existing project worktree
              <select
                aria-label="Draft existing worktree"
                value={reuse}
                onChange={(e) => setReuse(e.target.value)}
              >
                <option value="">Choose explicitly…</option>
                {options.checkouts.map((root) => (
                  <option key={root} value={root}>
                    {root}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" disabled={!reuse} onClick={() => void choose("reuse", reuse, "")}>
              Use discovered worktree
            </Button>
            <p>
              Chats sharing a checkout share files; their edits can interact. Branches and worktrees
              are retained.
            </p>
          </>
        )}
        <Button type="button" onClick={() => void refresh()}>
          Refresh available bases and worktrees
        </Button>
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </details>
  );
}

export function CheckoutBranch({ root }: { root: string }) {
  const [branch, setBranch] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = () =>
      window.escode.project("status", root).then(
        (status) => {
          if (live) {
            setBranch(status.branch);
            setError("");
          }
        },
        (e) => {
          if (live) {
            setBranch("");
            setError(String(e));
          }
        },
      );
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [root]);
  return (
    <details className="checkout-branch">
      <summary>
        {branch ? (
          <>
            Branch: <code>{branch}</code>
          </>
        ) : (
          "Branch unavailable"
        )}
      </summary>
      {branch && (
        <Button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(branch).catch((e) => setError(String(e)));
          }}
        >
          Copy checkout branch
        </Button>
      )}
      <Button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(root).catch((e) => setError(String(e)));
        }}
      >
        Copy execution path
      </Button>
      {error && <p role="status">{error}</p>}
    </details>
  );
}
