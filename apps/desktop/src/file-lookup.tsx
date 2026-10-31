import { useEffect, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import { openFile } from "./workspace";

export function FileLookup({ root, project, onClose }: {
  root: string; project: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef(document.activeElement);
  const generation = useRef(0);
  const busy = useRef(false);
  const activated = useRef(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Enter an exact relative or absolute file path.");
  useEffect(() => {
    const popup = dialog.current!;
    popup.showModal();
    return () => {
      generation.current++;
      popup.close();
      if (!activated.current && origin.current instanceof HTMLElement && origin.current.isConnected) origin.current.focus();
    };
  }, []);
  const activate = async () => {
    if (!query || busy.current) return;
    const request = ++generation.current;
    const current = () => request === generation.current && !!dialog.current?.open;
    busy.current = true;
    setMessage("Opening exact path…");
    try {
      const path = await window.escode.lookupFile(root, query);
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
        placeholder="Relative or absolute file path"
        onChange={event => { generation.current++; setQuery(event.target.value); setMessage("Press Enter or choose Open file."); }}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void activate(); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") event.preventDefault();
        }} />
      <p role="status">{message}</p>
      <Button disabled={!query} onClick={() => void activate()}>Open file</Button>
      <Button onClick={() => { generation.current++; onClose(); }}>Cancel</Button>
    </dialog>
  );
}
