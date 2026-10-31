import { useEffect, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import { memory, openFile } from "./workspace";

function highlightedPath(path: string, positions: readonly number[]) {
  const parts = [];
  let start = 0;
  for (const position of positions) {
    parts.push(path.slice(start, position), <mark key={position}>{path[position]}</mark>);
    start = position + 1;
  }
  parts.push(path.slice(start));
  return parts;
}

export function FileLookup({ root, project, onClose }: {
  root: string; project: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef(document.activeElement);
  const generation = useRef(0);
  const busy = useRef(false);
  const activated = useRef(false);
  const [results, setResults] = useState<import("@escode/contracts").LookupResult["results"]>([]);
  const [selected, setSelected] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Type a filename or path. Exact paths can also be opened.");
  useEffect(() => {
    const popup = dialog.current!;
    popup.showModal();
    return () => {
      generation.current++;
      popup.close();
      if (!activated.current && origin.current instanceof HTMLElement && origin.current.isConnected) origin.current.focus();
    };
  }, []);
  useEffect(() => {
    setResults([]); setSelected(0);
    const request = generation.current;
    setMessage(query.trim() ? "Searching checkout…" : "Loading recent files…");
    let stop: (() => void) | undefined;
    const timer = setTimeout(() => {
      stop = window.escode.searchFiles(root, query, result => {
        if (request !== generation.current || !dialog.current?.open) return;
        setResults(result.results);
        setMessage(result.partial ? (result.message || "Partial coverage. Refine the query or Refresh.") : result.results.length ? `${result.results.length} matches` : query.trim() ? "No eligible matches. You can still open an exact path." : "No recent files in this checkout. Type a filename or path.");
      }, error => { if (request === generation.current) setMessage(`Search unavailable: ${error}. Refresh to retry or open an exact path.`); }, (memory.recentFiles ?? []).filter(f => f.root === root).map(f => f.path));
    }, 120);
    return () => { clearTimeout(timer); stop?.(); };
  }, [root, query, refresh]);
  useEffect(() => { document.getElementById(`lookup-result-${selected}`)?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const activate = async (target = query) => {
    if (!target || busy.current) return;
    const request = ++generation.current;
    const current = () => request === generation.current && !!dialog.current?.open;
    busy.current = true;
    setMessage("Opening file…");
    try {
      const path = await window.escode.lookupFile(root, target);
      if (!current()) return;
      const opened = await openFile({ root, path, view: "file", intent: "keep", current });
      if (!current()) return;
      if (!opened) throw Error("File could not be opened. Check the path and retry.");
      activated.current = true;
      onClose();
      window.dispatchEvent(new CustomEvent("reveal-file", { detail: { project, root } }));
    } catch (error) {
      if (current()) setMessage(String(error) + " Edit the path or press Enter to retry.");
    } finally { busy.current = false; }
  };
  return (
    <dialog ref={dialog} className="project-picker file-lookup" aria-labelledby="file-lookup-title"
      aria-describedby="file-lookup-scope"
      onCancel={event => { event.preventDefault(); generation.current++; onClose(); }}
      onKeyDown={event => event.stopPropagation()}>
      <h2 id="file-lookup-title">Find file</h2>
      <p id="file-lookup-scope">Active checkout: {root}</p>
      <input autoFocus aria-label="Exact file path" maxLength={4096} value={query}
        placeholder="Filename, path, or quoted contiguous piece"
        role="combobox" aria-controls="lookup-results" aria-expanded={results.length > 0}
        aria-activedescendant={results.length ? `lookup-result-${selected}` : undefined}
        onChange={event => { generation.current++; setQuery(event.target.value); setMessage("Press Enter or choose Open file."); }}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void activate(results[selected]?.path ?? query); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelected(index => results.length ? (index + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length : 0); }
        }} />
      <div id="lookup-results" role="listbox" aria-label="Matching files" className="lookup-results">
        {[true, false].map(recent => {
          const rows = results.map((result, index) => ({ result, index })).filter(({ result }) => !!result.recent === recent);
          return rows.length > 0 && <div key={String(recent)} role="group" aria-label={recent ? "Recent files" : "File results"}>
            <h3>{recent ? "Recent files" : "File results"}</h3>
            {rows.map(({ result, index }) => <div key={result.path} id={`lookup-result-${index}`} role="option" aria-selected={index === selected}
              onMouseDown={event => event.preventDefault()} onClick={() => void activate(result.path)}>
              {highlightedPath(result.path, result.positions)}
            </div>)}
          </div>;
        })}
      </div>
      <p role="status">{message}</p>
      <Button onClick={() => { generation.current++; setRefresh(value => value + 1); }}>Refresh</Button>
      <Button disabled={!query} onClick={() => void activate()}>Open file</Button>
      <Button onClick={() => { generation.current++; onClose(); }}>Cancel</Button>
    </dialog>
  );
}
