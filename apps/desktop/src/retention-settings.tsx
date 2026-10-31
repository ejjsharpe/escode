import React, { useState } from "react";

export function RetentionSettings() {
  const [days, setDays] = useState("30");
  const [never, setNever] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <details className="retention-settings" onToggle={event => {
    if (!event.currentTarget.open) return;
    setReady(false); setMessage("");
    void window.escode.checkpointRetention().then(value => {
      setNever(value === null); setDays(String(value ?? 30)); setReady(true);
    }).catch(error => setMessage(String(error)));
  }}>
    <summary>Settings</summary>
    <form onSubmit={event => {
      event.preventDefault(); if (busy) return; setBusy(true); setMessage("");
      void window.escode.checkpointRetention(never ? null : Number(days)).then(() => {
        setMessage("Checkpoint retention saved.");
      }).catch(error => setMessage(String(error))).finally(() => setBusy(false));
    }}>
      <h2>Checkpoint retention</h2>
      <p id="retention-effects">Eligible file checkpoints expire after chat inactivity. Opening a chat, messages and agent work extend remaining coverage; background polling does not.</p>
      <label><input type="checkbox" checked={never} disabled={!ready || busy} onChange={event => setNever(event.target.checked)} /> Never expire</label>
      <label>Inactivity period (days) <input type="number" min="1" max="36500" step="1" required value={days} disabled={!ready || busy || never} aria-describedby="retention-effects retention-consequences" onChange={event => setDays(event.target.value)} /></label>
      <p id="retention-consequences">Shortening the period can expire remaining historical files on the next cleanup. Extending it or choosing Never cannot recover expired contents. Elapsed coverage is checked under the previous policy before saving. Expired files cannot be restored or used for historical branching.</p>
      <p>Branch dependencies, active operations, recovery and uncertain evidence remain protected. Conversations and worktrees are retained. Never can increase storage use; retention is not a storage-size limit and expiry does not promise immediate disk space recovery.</p>
      <button type="submit" disabled={!ready} aria-disabled={busy}>{busy ? "Saving…" : "Save retention"}</button>
      <p role="status">{message}</p>
    </form>
  </details>;
}
