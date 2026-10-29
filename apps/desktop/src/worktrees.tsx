import React, { useState } from "react";
import { Button } from "@base-ui/react/button";
import type { Project } from "../host/project";
type Options = ReturnType<Project["worktreeOptions"]>;
type Created = ReturnType<Project["createWorktree"]>;
export function WorktreeChoices({
  checkout,
  createChat,
}: {
  checkout: string;
  createChat: (root: string) => Promise<void>;
}) {
  const [options, setOptions] = useState<Options>();
  const [ref, setRef] = useState("");
  const [reuse, setReuse] = useState("");
  const [created, setCreated] = useState<Created[]>([]);
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
    const value = await window.escode.project("worktree-options", checkout);
    setOptions(value);
    setRef(value.defaultRef);
    setReuse("");
  };
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
          {options.bases.length ? (
            <>
              <label>
                Local base
                <select
                  aria-label="Local base"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                >
                  {options.bases.map((b) => (
                    <option key={b.ref} value={b.ref}>
                      {b.ref}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Resolved commit: <code>{options.bases.find((b) => b.ref === ref)?.commit}</code>
              </p>
              <Button
                onClick={() =>
                  void run(async () => {
                    const commit = options.bases.find((b) => b.ref === ref)!.commit;
                    const result = await window.escode.project(
                      "worktree-create",
                      checkout,
                      ref,
                      commit,
                    );
                    setCreated((previous) => [...previous, result]);
                    if (result.error) throw Error(result.error);
                    await refresh();
                    await createChat(result.root);
                  })
                }
              >
                Create worktree and chat
              </Button>
            </>
          ) : (
            <p>Create a first commit externally, then refresh bases.</p>
          )}
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
      {created.map((result) => (
        <div key={result.root}>
          <p>{result.error ? "Possible leftovers" : "Created worktree"}</p>
          {result.error && <p role="alert">{result.error}</p>}
          <Button
            onClick={() =>
              setCreated((previous) => previous.filter((item) => item.root !== result.root))
            }
          >
            Dismiss result
          </Button>
          <label>
            Worktree branch
            <input readOnly value={result.branch} />
          </label>
          <Button onClick={() => void run(() => navigator.clipboard.writeText(result.branch))}>
            Copy branch
          </Button>
          <label>
            Worktree path
            <input readOnly value={result.root} />
          </label>
          <Button onClick={() => void run(() => navigator.clipboard.writeText(result.root))}>
            Copy path
          </Button>
        </div>
      ))}
      {busy && <p role="status">Preparing checkout…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
