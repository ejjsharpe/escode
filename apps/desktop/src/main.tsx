import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@base-ui/react/button";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import type { Change, Document, SaveResult, ProjectBridge } from "../host/project";
import { ChatView } from "./chat";
import type { ChatBridge } from "./chat";
import "./style.css";
import { memory, initialize, persist, flush, useMemory, closers } from "./workspace";
type Status = {
  project: string;
  root: string;
  branch: string;
  changes: Change[];
  gitError?: string;
  approvalRequired?: boolean;
};
type BufferState = { model: monaco.editor.ITextModel; disk: Document };
declare global {
  interface Window {
    escode: {
      lifecycle: import("../host/workspace").LifecycleBridge;
      onClose(callback: () => void): () => void;
      chat: ChatBridge;
      toolStatus(): Promise<unknown>;
      project: ProjectBridge;
    };
    MonacoEnvironment: { getWorker(_: string, label: string): Worker };
  }
}
window.MonacoEnvironment = {
  getWorker: (_id, label) => {
    if (label === "json") return new JsonWorker();
    if (["css", "scss", "less"].includes(label)) return new CssWorker();
    if (["html", "handlebars", "razor"].includes(label)) return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TypeScriptWorker();
    return new EditorWorker();
  },
};
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
  project,
  active,
  mode,
  onStatus,
  onBlocked,
}: {
  root: string;
  project: string;
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
  const [checkoutError, setCheckoutError] = useState("");
  const [files, setFiles] = useState<{ path: string; directory: boolean }[]>([]);
  const [directory, setDirectory] = useMemory(root, "directory", "");
  const [path, setPath] = useMemory(root, "path", "");
  const [message, setMessage] = useState("Open a local Git checkout to begin.");
  const [conflict, setConflict] = useState<{ path: string; disk: Document } | null>(null);
  const selectedChange = useRef<Change | null>(memory.views[root]?.change ?? null);
  const presentation = useRef(0);
  const [diff, setDiff] = useState<{ original: string; modified: string; title: string } | null>(
    null,
  );
  const [bufferRevision, setBufferRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileClosing, setFileClosing] = useState(false);
  const closeInFlight = useRef(false);
  useEffect(
    () => onBlocked(root, !!conflict || saving || fileClosing),
    [conflict, saving, fileClosing, root, onBlocked],
  );
  const saveInFlight = useRef(false);
  const saveAction = useRef<() => void>(() => {});
  const report = (error: unknown) =>
    setMessage(error instanceof Error ? error.message : String(error));
  const refresh = async () => {
    let value: Status;
    try {
      value = await projectCall("status", root);
      setCheckoutError("");
    } catch (error) {
      setCheckoutError(
        "Checkout unavailable. Restore access to the original directory, then Retry checkout. Edits and chat associations are retained. " +
          String(error),
      );
      throw error;
    }
    setStatus(value);
    onStatus(value);
    if (value.gitError) setDiff(null);
    else if (selectedChange.current && modeRef.current === "Source Control") {
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
  function record(file: string, b: BufferState) {
    memory.drafts = memory.drafts.filter((d) => d.root !== root || d.path !== file);
    if (b.model.getValue() !== b.disk.text)
      memory.drafts.push({ root, path: file, text: b.model.getValue(), disk: b.disk });
    return persist();
  }
  function addBuffer(file: string, disk: Document, text = disk.text) {
    const b = {
      disk,
      model: monaco.editor.createModel(text, undefined, monaco.Uri.file(root + "/" + file)),
    };
    buffers.current.set(file, b);
    b.model.onDidChangeContent(() => {
      void record(file, b);
    });
    return b;
  }
  useEffect(() => {
    for (const d of memory.drafts.filter((d) => d.root === root)) addBuffer(d.path, d.disk, d.text);
    if (path) void select(path, false);
    return () => {
      closers.delete(root);
    };
  }, []);
  useEffect(
    () => () => {
      for (const b of buffers.current.values()) b.model.dispose();
    },
    [],
  );
  useEffect(() => {
    void refresh().catch(report);
    void browse(directory);
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
    const b = buffers.current.get(path);
    if (!b) return;
    const instance = monaco.editor.create(container.current, {
      model: b.model,
      automaticLayout: true,
      theme: "vs-dark",
      accessibilitySupport: "on",
      editContext: false,
      ariaLabel: path + " editor",
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
  }, [path, diff, mode, bufferRevision]);
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
      accessibilitySupport: "on",
      editContext: false,
      domReadOnly: true,
      originalAriaLabel: diff.title + " original",
      modifiedAriaLabel: diff.title + " modified",
    });
    instance.setModel({ original, modified });
    // Monaco's initial diff option pass clears the side labels.
    instance.getOriginalEditor().updateOptions({ ariaLabel: diff.title + " original" });
    instance.getModifiedEditor().updateOptions({ ariaLabel: diff.title + " modified" });
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
  async function select(file: string, present = true) {
    const generation = present ? ++presentation.current : presentation.current;
    try {
      if (!buffers.current.has(file)) {
        const disk: Document = await projectCall("read", root, file);
        if (!buffers.current.has(file)) addBuffer(file, disk);
      }
      if (!present) {
        setBufferRevision((old) => old + 1);
        return;
      }
      if (generation !== presentation.current) return;
      setPath(file);
      setDiff(null);
      setBufferRevision((old) => old + 1);
      setMessage("Cmd+S to save.");
    } catch (e) {
      report(e);
    }
  }
  async function save(version?: string, target = path) {
    if (!target || saveInFlight.current) return false;
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
        await record(target, b);
        await refresh();
        setMessage("Saved " + target);
        return b.model.getValue() === b.disk.text;
      }
    } catch (e) {
      report(e);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }
  saveAction.current = () => {
    if (!closeInFlight.current) void save();
  };
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
      await record(conflict.path, b);
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
      memory.views[root] = { ...memory.views[root], change };
      void persist();
      const value = await projectCall("diff", root, change.path, change.area);
      if (generation !== presentation.current || modeRef.current !== "Source Control") return;
      const title = change.area + " · " + change.path;
      setDiff((old) =>
        old?.title === title && old.original === value.original && old.modified === value.modified
          ? old
          : { ...value, title },
      );
      setMessage("Read-only Git diff · unsaved edits excluded.");
    } catch (e) {
      if (generation !== presentation.current) return;
      setDiff(null);
      report(e);
    }
  }
  async function closeFile(file: string, dispose = true) {
    const b = buffers.current.get(file);
    if (!b || saveInFlight.current || closeInFlight.current) return false;
    closeInFlight.current = true;
    setFileClosing(true);
    editor.current?.updateOptions({ readOnly: true });
    try {
      if (b.model.getValue() !== b.disk.text) {
        const choice = await window.escode.lifecycle("dirty", root + "/" + file);
        if (choice === 2) return false;
        if (choice === 0 && !(await save(undefined, file))) {
          setPath(file);
          window.dispatchEvent(new CustomEvent("reveal-file", { detail: { project, root } }));
          return false;
        }
      }
      // Remove the durable draft before disposing the only in-memory copy.
      const drafts = memory.drafts;
      memory.drafts = drafts.filter((d) => d.root !== root || d.path !== file);
      try {
        await persist();
      } catch (error) {
        memory.drafts = [
          ...memory.drafts.filter((d) => d.root !== root || d.path !== file),
          ...drafts.filter((d) => d.root === root && d.path === file),
        ];
        report(error);
        return false;
      }
      if (!dispose) {
        b.model.setValue(b.disk.text);
        return true;
      }
      buffers.current.delete(file);
      b.model.dispose();
      if (path === file) {
        setPath("");
        setDiff(null);
        setConflict(null);
        setDirty(false);
      }
      return true;
    } finally {
      closeInFlight.current = false;
      setFileClosing(false);
      editor.current?.updateOptions({ readOnly: false });
    }
  }
  closers.set(root, {
    project,
    close: async () => {
      for (const file of [...buffers.current.keys()])
        if (!(await closeFile(file, false))) return false;
      return true;
    },
  });
  return (
    <div className="workspace" hidden={!active || mode === "Chats"} inert={fileClosing}>
      <aside aria-label={mode + " sidebar"}>
        <p className="directory">
          {status?.branch} · {root}
        </p>
        {checkoutError && (
          <>
            <p role="status">{checkoutError}</p>
            <Button
              onClick={() =>
                void (async () => {
                  await refresh();
                  await browse(directory);
                  if (path) await select(path, false);
                })().catch(report)
              }
            >
              Retry checkout
            </Button>
          </>
        )}
        {status?.gitError && <p role="status">{status.gitError}</p>}
        {status?.gitError && (
          <Button onClick={() => void refresh().catch(report)}>Retry Git</Button>
        )}
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
                    aria-pressed={file.directory ? undefined : file.path === path}
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
                        <Button
                          aria-pressed={
                            selectedChange.current?.path === c.path &&
                            selectedChange.current.area === area
                          }
                          onClick={() => void showDiff(c)}
                        >
                          {c.path}
                        </Button>
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
            {path && mode === "Files" && (
              <Button disabled={saving || fileClosing} onClick={() => void closeFile(path)}>
                Close file
              </Button>
            )}
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
            <p className="directory">
              Ctrl+Shift+M toggles whether Tab leaves the editor. F7 / Shift+F7 reads the next /
              previous diff change; Escape returns to the diff.
            </p>
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
  const [mode, setMode] = useMemory(initial.project, "mode", "Files");
  const [checkout, setCheckout] = useMemory(initial.project, "checkout", initial.root);
  const [roots, setRoots] = useMemory(initial.project, "roots", [initial.root]);
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
  useEffect(() => {
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.project === initial.project) {
        selectCheckout(detail.root);
        setMode("Files");
      }
    };
    window.addEventListener("reveal-file", reveal);
    return () => window.removeEventListener("reveal-file", reveal);
  }, []);
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
          project={initial.project}
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
function App({ restored, errors }: { restored: Status[]; errors: string[] }) {
  const [projects, setProjects] = useState<Status[]>(restored);
  const [selected, setSelected] = useState(memory.selected);
  const [activity, setActivity] = useState<Record<string, string>>({});
  const [error, setError] = useState(errors.join("\n"));
  const [closing, setClosing] = useState(false);
  const closeInFlight = useRef(false);
  async function close(project?: string) {
    if (closeInFlight.current) return;
    closeInFlight.current = true;
    setClosing(true);
    try {
      if (!(await window.escode.lifecycle("prepare", project))) return;
      for (const entry of closers.values()) {
        if ((!project || entry.project === project) && !(await entry.close())) return;
      }
      await flush();
      const previousProjects = memory.projects,
        previousSelected = memory.selected;
      try {
        if (project) {
          memory.projects = memory.projects.filter((p) => p.project !== project);
          memory.selected = memory.projects[0]?.project ?? "";
          await persist();
        }
        await window.escode.lifecycle("finish", project);
      } catch (error) {
        memory.projects = previousProjects;
        memory.selected = previousSelected;
        void persist();
        throw error;
      }
      if (project) {
        setProjects((old) => old.filter((p) => p.project !== project));
        setSelected(memory.selected);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      closeInFlight.current = false;
      setClosing(false);
    }
  }
  useEffect(() => window.escode.onClose(() => void close()), [projects]);
  useEffect(() => {
    const reveal = (event: Event) => setSelected((event as CustomEvent).detail.project);
    window.addEventListener("reveal-file", reveal);
    const listener = (event: Event) =>
      setError("Recovery draft could not be saved: " + (event as CustomEvent).detail);
    window.addEventListener("recovery-error", listener);
    return () => {
      window.removeEventListener("recovery-error", listener);
      window.removeEventListener("reveal-file", reveal);
    };
  }, []);
  useEffect(() => {
    memory.selected = selected;
    void persist();
  }, [selected]);
  const callbacks = useRef(new Map<string, (value: string) => void>());
  async function open() {
    try {
      const value = await window.escode.project("open");
      if (!value) return;
      setError("");
      setProjects((old) =>
        old.some((p) => p.project === value.project)
          ? old.map((p) => (p.project === value.project && p.approvalRequired ? value : p))
          : [...old, value],
      );
      if (!memory.projects.some((p) => p.project === value.project))
        memory.projects.push({ project: value.project, root: value.root });
      void persist();
      setSelected(value.project);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <main {...stylex.props(styles.page)} inert={closing}>
      <header>
        <strong>escode</strong>
        <Button onClick={() => void open()}>Open project…</Button>
        <span>{selected}</span>
        {selected && <Button onClick={() => void close(selected)}>Close project</Button>}
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
            key={p.project + (p.approvalRequired ? ":approval" : "")}
            initial={p}
            active={selected === p.project}
            onActivity={callbacks.current.get(p.project)!}
          />
        );
      })}
    </main>
  );
}
window.escode
  .lifecycle("load")
  .then(({ state, restored, errors }) => {
    initialize(state);
    createRoot(document.getElementById("root")!).render(
      <App restored={restored} errors={errors} />,
    );
  })
  .catch((error) => {
    window.escode.onClose(() => {
      void window.escode
        .lifecycle("prepare")
        .then((confirmed) => {
          if (confirmed) return window.escode.lifecycle("finish");
        })
        .catch((error) => {
          document.getElementById("root")!.textContent += "\n" + String(error);
        });
    });
    document.getElementById("root")!.textContent =
      "Workspace could not be loaded. Existing recovery data has been retained. Resolve the error and restart: " +
      String(error);
  });
