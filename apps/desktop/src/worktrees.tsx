import { Popover } from "@base-ui/react/popover";
import { ContextPicker } from "./context-picker";
import React, { useEffect, useState, useRef } from "react";
import { Button } from "@base-ui/react/button";
import { persist, flush } from "./workspace";
import type { Checkout } from "../host/project";
type Options = ReturnType<Checkout["repositoryGit"]["worktreeOptions"]>;
export function WorktreeChoices({
  createChat,
  project,
  onRemoved,
}: {
  project: string;
  onRemoved: () => Promise<unknown>;
  createChat: (root: string) => Promise<void>;
}) {
  const [managed, setManaged] = useState<ReturnType<Checkout["repositoryGit"]["managedWorktrees"]>>([]);
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
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      const request = ++observation.current;
      void window.escode.project("worktree-options", project).then(value => {
        if (active && request === observation.current) setOptions(value);
      }, error => { if (active) setError(String(error)); }).finally(() => { pending = false; });
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
  const observation = useRef(0);
  const refreshing = useRef(false);
  const [error, setError] = useState("");
  const refresh = async () => {
    if (refreshing.current) return;
    refreshing.current = true;
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
    } finally { refreshing.current = false; }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => { clearInterval(timer); observation.current++; };
  }, [chat.id, chat.checkout, chat.worktree?.source]);
  return (
    <>
      <ContextPicker label="Worktree" disabled={busy || !options} value={chat.worktree ? "new" : chat.checkout}
        options={[{ value: "new", label: "New worktree", detail: "Created on first Send from committed files" }, ...Array.from(new Set([chat.checkout, ...(options?.checkouts ?? [])])).map(root => ({ value: root, label: root.split("/").at(-1)!, detail: root }))]}
        onChange={value => {
          if (value === "new") {
            const base = options?.bases.find(base => base.ref === ref);
            if (base) void choose("new", base.ref, base.commit);
            else setError("No committed base available. Commit a change before creating a worktree.");
          } else void choose("reuse", value, "");
        }} />
      {chat.worktree ? <ContextPicker label="Branch" disabled={busy || !options} value={chat.worktree.ref}
        options={(options?.bases ?? []).map(base => ({ value: base.ref, label: base.ref, detail: base.commit }))}
        onChange={value => { const base = options?.bases.find(base => base.ref === value); if (base) void choose("new", value, base.commit); }} /> : <CheckoutBranch root={chat.checkout} />}
      {error && <p role="alert">{error}</p>}
    </>
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
    <Popover.Root>
      <Popover.Trigger className="context-picker-trigger" aria-label="Branch">
        {branch ? (
          <>
            <span>{branch}</span><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m6 9 6 6 6-6" /></svg>
          </>
        ) : (
          "Branch unavailable"
        )}
      </Popover.Trigger>
      <Popover.Portal><Popover.Positioner sideOffset={8} className="context-picker-positioner"><Popover.Popup className="context-picker-popup">
      <Popover.Title className="context-picker-title">Current branch</Popover.Title><div className="context-picker-options"><p>Existing checkout branches are managed with Git.</p>
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
      </div></Popover.Popup></Popover.Positioner></Popover.Portal>
    </Popover.Root>
  );
}
