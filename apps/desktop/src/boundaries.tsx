import React, { useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import type { CheckpointPage, BoundaryInspection } from "@escode/contracts";

export function Boundaries({ project, id }: { project: string | null; id: string }) {
  const [points, setPoints] = useState<CheckpointPage>();
  const [point, setPoint] = useState<CheckpointPage["points"][number]>();
  const [inspection, setInspection] = useState<BoundaryInspection>();
  const [rewind, setRewind] = useState<import("@escode/contracts").RewindResult>();
  const confirm = useRef<HTMLDivElement>(null);
  const rewindButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const output = useRef<HTMLDivElement>(null);
  async function load(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  async function inspect(target: NonNullable<typeof point>, cursor: string | null) {
    setPoint(target); setInspection(undefined); setRewind(undefined);
    await load(async () => {
      setInspection(await window.escode.inspectBoundary(project, id, target.id, cursor));
      requestAnimationFrame(() => output.current?.focus());
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
        setRewind(await window.escode.rewind(project, id, point.id, null, null));
        requestAnimationFrame(() => confirm.current?.focus());
      })}>Rewind conversation only…</Button>
      {rewind && <div ref={confirm} tabIndex={-1} role="region" aria-label="Conversation rewind">
        <p role="status">{rewind.message}</p>
        {rewind.status === "ready" && <>
          <Button disabled={busy} onClick={() => { setRewind(undefined); rewindButton.current?.focus(); }}>Cancel rewind</Button>
          <Button disabled={busy} onClick={() => load(async () => {
            setRewind(await window.escode.rewind(project, id, point.id, rewind.token, crypto.randomUUID()));
            setInspection(undefined);
            requestAnimationFrame(() => confirm.current?.focus());
          })}>Confirm rewind and keep current files</Button>
        </>}
      </div>}
      {inspection && <><p role="status">{inspection.message}</p>
        {inspection.page.items.map(item => <article key={item.turnId + item.id}><h2>{item.type}</h2><pre>{item.text}</pre></article>)}
        <Button disabled={busy || !inspection.page.nextCursor} onClick={() => inspect(point, inspection.page.nextCursor)}>Next boundary history page</Button>
      </>}
    </div>}
  </details>;
}
