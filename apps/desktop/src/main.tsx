import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@base-ui/react/button";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import type { Change, Document, SaveResult, ProjectBridge } from "../host/project";
import { ChatView } from "./chat";
import type { ChatBridge } from "./chat";
import "./style.css";
type Status = { root: string; branch: string; changes: Change[] };
type BufferState = { model: monaco.editor.ITextModel; disk: Document };
declare global {
  interface Window {
    escode: { chat: ChatBridge; toolStatus(): Promise<unknown>; project: ProjectBridge };
    MonacoEnvironment: { getWorker(_: string, label: string): Worker };
  }
}
window.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const styles = stylex.create({
  page: {
    color: "#e5e7eb",
    backgroundColor: "#18202b",
    minHeight: "100vh",
    fontFamily: "system-ui",
  },
});
function App() {
  const container = useRef<HTMLDivElement>(null);
  const buffers = useRef(new Map<string, BufferState>());
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [files, setFiles] = useState<{ path: string; directory: boolean }[]>([]);
  const [directory, setDirectory] = useState("");
  const [mode, setMode] = useState("Files");
  const [chatActivity, setChatActivity] = useState("");
  const [path, setPath] = useState("");
  const [message, setMessage] = useState("Open a local Git checkout to begin.");
  const [conflict, setConflict] = useState<{ path: string; disk: Document } | null>(null);
  const selectedChange = useRef<Change | null>(null);
  const presentation = useRef(0);
  const [diff, setDiff] = useState<{ original: string; modified: string; title: string } | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const saveAction = useRef<() => void>(() => {});
  const report = (error: unknown) =>
    setMessage(error instanceof Error ? error.message : String(error));
  const refresh = async () => {
    const value = await window.escode.project("status");
    setStatus(value);
    if (selectedChange.current && mode === "Source Control") {
      await showDiff(selectedChange.current);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveAction.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      for (const b of buffers.current.values()) b.model.dispose();
    };
  }, []);
  useEffect(() => {
    if (!status) return;
    const id = setInterval(() => void refresh().catch(report), 2000);
    return () => clearInterval(id);
  }, [status?.root, mode]);
  useEffect(() => {
    if (!container.current || !path || diff || mode !== "Files") return;
    const b = buffers.current.get(path)!;
    const instance = monaco.editor.create(container.current, {
      model: b.model,
      automaticLayout: true,
      theme: "vs-dark",
    });
    editor.current = instance;
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveAction.current());
    const update = () => setDirty(b.model.getValue() !== b.disk.text);
    update();
    const listener = b.model.onDidChangeContent(update);
    return () => {
      listener.dispose();
      instance.dispose();
      editor.current = null;
    };
  }, [path, diff, mode]);
  useEffect(() => {
    if (!diff || !container.current) return;
    const original = monaco.editor.createModel(diff.original, "plaintext");
    const modified = monaco.editor.createModel(diff.modified, "plaintext");
    const instance = monaco.editor.createDiffEditor(container.current, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      theme: "vs-dark",
      renderSideBySide: false,
    });
    instance.setModel({ original, modified });
    return () => {
      instance.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [diff]);
  async function browse(dir: string) {
    try {
      setFiles(await window.escode.project("files", dir));
      setDirectory(dir);
    } catch (e) {
      report(e);
    }
  }
  async function open() {
    try {
      const value = await window.escode.project("open");
      if (!value) return;
      setStatus(value);
      await browse("");
      setMessage("Select a file to edit.");
    } catch (e) {
      report(e);
    }
  }
  async function select(file: string) {
    try {
      if (!buffers.current.has(file)) {
        const disk: Document = await window.escode.project("read", file);
        buffers.current.set(file, {
          disk,
          model: monaco.editor.createModel(
            disk.text,
            undefined,
            monaco.Uri.file(status!.root + "/" + file),
          ),
        });
      }
      presentation.current++;
      setPath(file);
      setDiff(null);
      setMessage("Cmd+S to save.");
    } catch (e) {
      report(e);
    }
  }
  async function save(version?: string) {
    if (!path || saveInFlight.current || mode !== "Files") return;
    const target = path;
    const b = buffers.current.get(target)!;
    const text = b.model.getValue();
    saveInFlight.current = true;
    setSaving(true);
    try {
      const result: SaveResult = await window.escode.project(
        "save",
        target,
        text,
        version ?? b.disk.version,
      );
      if (result.kind === "conflict") {
        setConflict({ path: target, disk: result.disk });
        setMessage("Disk changed. Compare, overwrite this disk version, or reload.");
      } else {
        b.disk = result.disk;
        setDirty(b.model.getValue() !== b.disk.text);
        setConflict(null);
        setDiff(null);
        setMessage("Saved " + target);
        await refresh();
      }
    } catch (e) {
      report(e);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }
  saveAction.current = () => void save();
  async function reload() {
    if (!conflict) return;
    try {
      const disk: Document = await window.escode.project("read", conflict.path);
      const b = buffers.current.get(conflict.path)!;
      b.disk = disk;
      b.model.setValue(disk.text);
      setConflict(null);
      setDiff(null);
      setDirty(false);
      setMessage("Reloaded from disk.");
    } catch (e) {
      report(e);
    }
  }
  async function showDiff(change: Change) {
    const generation = ++presentation.current;
    try {
      selectedChange.current = change;
      const value = await window.escode.project("diff", change.path, change.area);
      if (generation !== presentation.current) return;
      setDiff({ ...value, title: change.area + " · " + change.path });
      setMessage("Read-only Git diff · unsaved edits excluded.");
    } catch (e) {
      if (generation !== presentation.current) return;
      setDiff(null);
      report(e);
    }
  }
  return (
    <main {...stylex.props(styles.page)}>
      <header>
        <strong>escode</strong>
        <Button onClick={() => void open()} disabled={!!status}>
          Open project…
        </Button>
        {status && (
          <span>
            {status.branch} · {status.root}
          </span>
        )}
      </header>
      <div className="workspace">
        <aside>
          <nav aria-label="Project views">
            {["Files", "Source Control", "Chats"].map((view) => (
              <Button
                key={view}
                disabled={!!conflict || saving}
                aria-pressed={mode === view}
                onClick={() => {
                  presentation.current++;
                  setMode(view);
                  setDiff(null);
                  if (view === "Source Control" && selectedChange.current)
                    void showDiff(selectedChange.current);
                }}
              >
                {view}
                {view === "Chats" && chatActivity ? ` · ${chatActivity}` : ""}
              </Button>
            ))}
          </nav>
          {status && mode === "Files" && (
            <>
              <p className="directory">{directory || "Project files"}</p>
              {directory && (
                <Button onClick={() => void browse(directory.split("/").slice(0, -1).join("/"))}>
                  ↑ Parent folder
                </Button>
              )}
              <ul>
                {files.map((file) => (
                  <li key={file.path}>
                    <Button
                      disabled={!!conflict || saving}
                      onClick={() => void (file.directory ? browse(file.path) : select(file.path))}
                    >
                      {file.directory ? "▸ " : ""}
                      {file.path.split("/").at(-1)}
                      {buffers.current.get(file.path)?.model.getValue() !==
                      buffers.current.get(file.path)?.disk.text
                        ? " •"
                        : ""}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {status && mode === "Source Control" && (
            <>
              {(["unstaged", "staged", "untracked"] as const).map((area) => (
                <section key={area}>
                  <h2>{area}</h2>
                  <ul>
                    {status.changes
                      .filter((c) => c.area === area)
                      .map((c) => (
                        <li key={c.path}>
                          <Button onClick={() => void showDiff(c)}>{c.path}</Button>
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </>
          )}
          <div id="chat-sidebar" hidden={mode !== "Chats"} />
        </aside>
        <section className="content" aria-label="Main editor">
          {status && (
            <div hidden={mode !== "Chats"} className="chat-panel">
              <ChatView project={status.root} onActivity={setChatActivity} />
            </div>
          )}
          {mode !== "Chats" && (
            <>
              <div className="toolbar">
                <span>
                  {diff?.title || path || "No file selected"}
                  {dirty && path ? " • Unsaved" : ""}
                </span>
                {path && mode === "Files" && (
                  <Button disabled={saving} onClick={() => void save()}>
                    Save ⌘S
                  </Button>
                )}
              </div>
              {conflict && (
                <div role="alert" className="conflict">
                  <p>{conflict.path} changed on disk. Your edits are retained.</p>
                  <Button
                    onClick={() =>
                      setDiff({
                        original: conflict.disk.text,
                        modified: buffers.current.get(conflict.path)!.model.getValue(),
                        title: "Disk versus your edits",
                      })
                    }
                  >
                    Compare
                  </Button>
                  <Button disabled={saving} onClick={() => void save(conflict.disk.version)}>
                    Overwrite
                  </Button>
                  <Button disabled={saving} onClick={() => void reload()}>
                    Reload
                  </Button>
                  <Button
                    disabled={saving}
                    onClick={() => {
                      setConflict(null);
                      setDiff(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
              <div className="editor" ref={container} />
              <p role="status">{message}</p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
