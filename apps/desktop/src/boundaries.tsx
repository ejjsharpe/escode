import React, { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import type { CheckpointPage, BoundaryInspection, FileInspection } from "@escode/contracts";

export function Boundaries({ project, id }: { project: string | null; id: string }) {
  const [points, setPoints] = useState<CheckpointPage>();
  const [point, setPoint] = useState<CheckpointPage["points"][number]>();
  const [inspection, setInspection] = useState<BoundaryInspection>();
  const [action, setAction] = useState<import("@escode/contracts").HistoricalAction>("rewind");
  const summarized = action === "summarized", branching = action === "branch" || summarized, restoreFiles = action === "restore";
  const summaryButton = useRef<HTMLButtonElement>(null);
  const [rewind, setRewind] = useState<import("@escode/contracts").RewindResult>();
  const restoreButton = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLDivElement>(null);
  const branchButton = useRef<HTMLButtonElement>(null);
  const rewindButton = useRef<HTMLButtonElement>(null);
  const [files, setFiles] = useState<FileInspection>();
  const [file, setFile] = useState<FileInspection>();
  const [filePath, setFilePath] = useState("");
  const fileDetail = useRef<HTMLDivElement>(null);
  const fileOutput = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const output = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (inspection) output.current?.focus(); }, [inspection]);
  useLayoutEffect(() => { if (rewind) confirm.current?.focus(); }, [rewind]);
  useLayoutEffect(() => { if (files) fileOutput.current?.focus(); }, [files]);
  useLayoutEffect(() => { if (file) fileDetail.current?.focus(); }, [file]);
  async function load(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  async function inspect(target: NonNullable<typeof point>, cursor: string | null) {
    setPoint(target); setInspection(undefined); setRewind(undefined); setFiles(undefined); setFile(undefined);
    await load(async () => {
      setInspection(await window.escode.inspectBoundary(project, id, target.id, cursor));
    });
  }
  return <details onKeyDown={event => {
    if (event.key === "Escape") {
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
      event.stopPropagation();
    }
  }}>
    <summary>Historical boundaries</summary>
    <p>Read-only inspection. Your current conversation and draft stay in place.</p>
    <Button disabled={busy} onClick={() => load(async () => setPoints(await window.escode.checkpointPoints(project, id, null)))}>Load boundaries</Button>
    {points?.points.length === 0 && <p>No recorded boundaries.</p>}
    <ul>{points?.points.map(p => <li key={p.id}>
      <Button disabled={busy} aria-pressed={point?.id === p.id} onClick={() => inspect(p, null)}>
        {p.kind === "before-message" ? "Before message" : "After turn"} · {new Date(p.createdAt).toLocaleString()} · {p.id.slice(0, 8)}
      </Button>
    </li>)}</ul>
    {points?.nextCursor && <Button disabled={busy} onClick={() => load(async () => setPoints(await window.escode.checkpointPoints(project, id, points.nextCursor)))}>More boundaries</Button>}
    <p role="status">{busy ? "Loading historical boundary…" : error}</p>
    {point && <div ref={output} tabIndex={-1} role="region" aria-label="Boundary inspection" aria-busy={busy}>
      <p>{point.kind === "before-message" ? "Before message" : "After turn"} · {point.id}</p>
      <p>Provider thread: {point.threadId ?? "unavailable"} · turn: {point.turnId ?? "unavailable"}</p>
      <p>Saved files: {point.availability}{point.reason ? ` · ${point.reason}` : ""}. This does not include unsaved editor text.</p>
      <Button ref={rewindButton} disabled={busy} onClick={() => load(async () => {
        setAction("rewind"); setRewind(await window.escode.rewind(project, id, point.id, null, null));
      })}>Rewind conversation only…</Button>
      <Button ref={branchButton} disabled={busy} onClick={() => load(async () => {
        setAction("branch"); setRewind(await window.escode.branchHistory(project, id, point.id, null, null));
      })}>Branch historical chat…</Button>
      <Button ref={restoreButton} disabled={busy} onClick={() => load(async () => {
        setAction("restore"); setRewind(await window.escode.rewind(project, id, point.id, null, null, true));
      })}>Rewind and restore saved files…</Button>
      <Button ref={summaryButton} disabled={busy} onClick={() => load(async () => {
        setAction("summarized");
        setRewind(await window.escode.branchHistory(project, id, point.id, null, null, true));
      })}>Create summarized continuation…</Button>
      <p>Summarized continuation copies available historical text into an unsent draft in a separate historical worktree. It does not recreate native historical provider context. Missing history remains unavailable.</p>
      {rewind && <div ref={confirm} tabIndex={-1} role="region" aria-label={branching ? "Historical branch" : "Conversation rewind"}>
        <p role="status">{rewind.message}</p>
        {restoreFiles && rewind.status === "unavailable" && <p>Choose conversation-only rewind to keep current files, or Branch historical chat for a separate worktree when available.</p>}
        {rewind.status === "ready" && <>
          <Button disabled={busy} onClick={() => { setRewind(undefined); (summarized ? summaryButton : branching ? branchButton : restoreFiles ? restoreButton : rewindButton).current?.focus(); }}>{branching ? "Cancel branch" : "Cancel rewind"}</Button>
          <Button disabled={busy} onClick={() => load(async () => {
            setRewind(await (branching ? window.escode.branchHistory(project, id, point.id, rewind.token, crypto.randomUUID(), summarized) : window.escode.rewind(project, id, point.id, rewind.token, crypto.randomUUID(), restoreFiles)));
            setInspection(undefined);
          })}>{summarized ? "Create summarized draft and worktree" : branching ? "Create historical chat and worktree" : restoreFiles ? "Confirm restoration and retain unsaved edits" : "Confirm rewind and keep current files"}</Button>
        </>}
      </div>}
      <Button disabled={busy} onClick={() => load(async () => {
        setFile(undefined); setFiles(await window.escode.inspectFiles(project, id, point.id, null, null));
      })}>Inspect saved files</Button>
      {files && <div ref={fileOutput} tabIndex={-1} role="region" aria-label="Saved-file inspection">
        <p role="status">{files.message}</p>
        {files.availability === "available" && <>
          <p>Choose a captured file. Unchanged files are included.</p>
          <ul>{files.paths.map(path => <li key={path}><Button disabled={busy} onClick={() => load(async () => {
            setFilePath(path);
            setFile(await window.escode.inspectFiles(project, id, point.id, path, null));
          })}>{path}</Button></li>)}</ul>
          {files.nextCursor && <Button disabled={busy} onClick={() => load(async () => setFiles(await window.escode.inspectFiles(project, id, point.id, null, files.nextCursor)))}>More captured files</Button>}
        </>}
        {file && <div ref={fileDetail} tabIndex={-1} role="region" aria-label="Historical file comparison"><h2>{filePath}</h2><p role="status">{file.message}</p>{file.availability === "available" && <>
          <h2>Recorded Git base · mode {file.beforeMode?.toString(8) ?? "absent"}</h2><pre>{file.before ?? "File absent"}</pre>
          <h2>Saved boundary · mode {file.afterMode?.toString(8) ?? "absent"}</h2><pre>{file.after ?? "File absent"}</pre>
        </>}</div>}
      </div>}
      {inspection && <><p role="status">{inspection.message}</p>
        {inspection.page.items.map(item => <article key={item.turnId + item.id}><h2>{item.type}</h2><pre>{item.text}</pre></article>)}
        <Button disabled={busy || !inspection.page.nextCursor} onClick={() => inspect(point, inspection.page.nextCursor)}>Next boundary history page</Button>
      </>}
    </div>}
  </details>;
}
