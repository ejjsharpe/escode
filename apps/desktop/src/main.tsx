import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@base-ui/react/button";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import type { Change, Document, SaveResult, ProjectBridge } from "../host/project";
import { ChatView } from "./chat";
import type { ChatBridge } from "./chat";
import "./style.css";
type Status = { project: string; root: string; branch: string; changes: Change[] };
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
function CheckoutView({
  root,
  active,
  mode,
  onStatus,
  onBlocked,
}: {
  root: string;
  active: boolean;
  mode: string;
  onStatus: (status: Status) => void;
  onBlocked: (root: string, blocked: boolean) => void;
}) {
  const projectCall = window.escode.project;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const container = useRef<HTMLDivElement>(null);
  const buffers = useRef(new Map<string, BufferState>());
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [files, setFiles] = useState<{ path: string; directory: boolean }[]>([]);
  const [directory, setDirectory] = useState("");
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
  useEffect(() => onBlocked(root, !!conflict || saving), [conflict, saving, root, onBlocked]);
  const saveInFlight = useRef(false);
  const saveAction = useRef<() => void>(() => {});
  const report = (error: unknown) =>
    setMessage(error instanceof Error ? error.message : String(error));
  const refresh = async () => {
    const value = await projectCall("status", root);
    setStatus(value);
    onStatus(value);
    if (selectedChange.current && modeRef.current === "Source Control") {
      await showDiff(selectedChange.current);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (active && (e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveAction.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
    };
  }, [active]);
  useEffect(
    () => () => {
      for (const b of buffers.current.values()) b.model.dispose();
    },
    [],
  );
  useEffect(() => {
    void refresh().catch(report);
    void browse("");
  }, []);
  useLayoutEffect(() => {
    presentation.current++;
    setDiff(null);
    if (mode === "Source Control" && selectedChange.current) void showDiff(selectedChange.current);
  }, [mode]);
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
      setFiles(await projectCall("files", root, dir));
      setDirectory(dir);
    } catch (e) {
      report(e);
    }
  }
  async function select(file: string) {
    const generation = ++presentation.current;
    try {
      if (!buffers.current.has(file)) {
        const disk: Document = await projectCall("read", root, file);
        if (!buffers.current.has(file))
          buffers.current.set(file, {
            disk,
            model: monaco.editor.createModel(
              disk.text,
              undefined,
              monaco.Uri.file(status!.root + "/" + file),
            ),
          });
      }
      if (generation !== presentation.current) return;
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
      const result: SaveResult = await projectCall(
        "save",
        root,
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
      const disk: Document = await projectCall("read", root, conflict.path);
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
    if (modeRef.current !== "Source Control") return;
    const generation = ++presentation.current;
    try {
      selectedChange.current = change;
      const value = await projectCall("diff", root, change.path, change.area);
      if (generation !== presentation.current || modeRef.current !== "Source Control") return;
      setDiff({ ...value, title: change.area + " · " + change.path });
      setMessage("Read-only Git diff · unsaved edits excluded.");
    } catch (e) {
      if (generation !== presentation.current) return;
      setDiff(null);
      report(e);
    }
  }
  return (
    <div className="workspace" hidden={!active || mode === "Chats"}>
      <aside>
        <p className="directory">
          {status?.branch} · {root}
        </p>
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
      </aside>
      <section className="content" aria-label="Main editor">
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
  );
}
function ProjectView({
  initial,
  active,
  onActivity,
}: {
  initial: Status;
  active: boolean;
  onActivity: (activity: string) => void;
}) {
  const [mode, setMode] = useState("Files");
  const [checkout, setCheckout] = useState(initial.root);
  const [roots, setRoots] = useState([initial.root]);
  const [branches, setBranches] = useState<Record<string, string>>({
    [initial.root]: initial.branch,
  });
  const onStatus = React.useCallback(
    (value: Status) =>
      setBranches((old) =>
        old[value.root] === value.branch ? old : { ...old, [value.root]: value.branch },
      ),
    [],
  );
  const [activity, setActivity] = useState("");
  const [blocked, setBlocked] = useState<Record<string, boolean>>({});
  const onBlocked = React.useCallback(
    (root: string, value: boolean) =>
      setBlocked((old) => (old[root] === value ? old : { ...old, [root]: value })),
    [],
  );
  const sidebarId = "chats-" + encodeURIComponent(initial.project);
  const selectCheckout = (root: string) => {
    setRoots((old) => (old.includes(root) ? old : [...old, root]));
    setCheckout(root);
  };
  const activityChanged = React.useCallback(
    (value: string) => {
      setActivity(value);
      onActivity(value);
    },
    [onActivity],
  );
  return (
    <section hidden={!active} aria-label={initial.project}>
      <nav className="view-nav" aria-label="Project views">
        {["Files", "Source Control", "Chats"].map((view) => (
          <Button
            key={view}
            disabled={blocked[checkout]}
            aria-pressed={mode === view}
            onClick={() => setMode(view)}
          >
            {view}
            {view === "Chats" && activity ? " · " + activity : ""}
          </Button>
        ))}
        <span className="directory">
          Checkout: {branches[checkout] ?? "Loading branch…"} · {checkout}
        </span>
      </nav>
      {roots.map((root) => (
        <CheckoutView
          key={root}
          root={root}
          mode={mode}
          active={active && root === checkout}
          onBlocked={onBlocked}
          onStatus={onStatus}
        />
      ))}
      <div className="workspace" hidden={mode !== "Chats"}>
        <aside id={sidebarId} />
        <section className="content">
          <div className="chat-panel">
            <ChatView
              project={initial.project}
              checkout={checkout}
              sidebarId={sidebarId}
              onCheckout={selectCheckout}
              onActivity={activityChanged}
            />
          </div>
        </section>
      </div>
    </section>
  );
}
function App() {
  const [projects, setProjects] = useState<Status[]>([]);
  const [selected, setSelected] = useState("");
  const [activity, setActivity] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const callbacks = useRef(new Map<string, (value: string) => void>());
  async function open() {
    try {
      const value = await window.escode.project("open");
      if (!value) return;
      setProjects((old) => (old.some((p) => p.project === value.project) ? old : [...old, value]));
      setSelected(value.project);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <main {...stylex.props(styles.page)}>
      <header>
        <strong>escode</strong>
        <Button onClick={() => void open()}>Open project…</Button>
        <span>{selected}</span>
      </header>
      <nav className="project-tabs" aria-label="Projects">
        {projects.map((p) => (
          <Button
            key={p.project}
            aria-pressed={selected === p.project}
            title={p.project}
            onClick={() => setSelected(p.project)}
          >
            {p.project.split("/").at(-1)}
            {activity[p.project] ? " · " + activity[p.project] : ""}
          </Button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {!projects.length && <p>Open a local Git checkout to begin.</p>}
      {projects.map((p) => {
        if (!callbacks.current.has(p.project))
          callbacks.current.set(p.project, (value) =>
            setActivity((old) => (old[p.project] === value ? old : { ...old, [p.project]: value })),
          );
        return (
          <ProjectView
            key={p.project}
            initial={p}
            active={selected === p.project}
            onActivity={callbacks.current.get(p.project)!}
          />
        );
      })}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
