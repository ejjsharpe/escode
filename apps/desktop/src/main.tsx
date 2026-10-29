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
import { affected, moved, reconcile, reconcileSave } from "../host/file-operation-state";
import { FilesTree } from "./files";
import { AgentsView } from "./agents";
import { ChatView } from "./chat";
import { useProjectChats } from "./chat-state";
import { WorktreeChoices } from "./worktrees";
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
type BufferState = {
  model: monaco.editor.ITextModel;
  disk: Document;
  view?: monaco.editor.ICodeEditorViewState | null;
};
declare global {
  interface Window {
    escode: {
      lifecycle: import("../host/workspace").LifecycleBridge;
      onClose(callback: () => void): () => void;
      chat: ChatBridge;
      toolStatus(): Promise<unknown>;
      project: ProjectBridge;
      watchFiles(root: string, paths: string[], callback: (error?: string) => void): () => void;
      nativeFiles(files: File[]): Promise<string>;
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
monaco.editor.defineTheme("escode", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#131416",
    "editor.foreground": "#dedee5",
    "editorLineNumber.foreground": "#777582",
    "editorLineNumber.activeForeground": "#c5bddf",
    "editor.lineHighlightBackground": "#1e1f23",
    "editor.selectionBackground": "#48405f",
    "editorCursor.foreground": "#b7aaf5",
    "editorWidget.background": "#24252b",
    "editorWidget.border": "#484351",
  },
});
const styles = stylex.create({
  page: {
    color: "#dedee5",
    backgroundColor: "#131416",
    minHeight: "100vh",
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
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
  const [filesRevision, setFilesRevision] = useState(0);
  const [transferProgress, setTransferProgress] = useState(false);
  const [path, setPath] = useMemory(root, "path", "");
  const [message, setMessage] = useState("Open a local Git checkout to begin.");
  const [conflict, setConflict] = useState<{ path: string; disk: Document } | null>(null);
  const selectedChange = useRef<Change | null>(memory.views[root]?.change ?? null);
  const presentation = useRef(0);
  const [diff, setDiff] = useState<{ original: string; modified: string; title: string; file?: string } | null>(
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
    const b: BufferState = {
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
      readOnly: closeInFlight.current || saveInFlight.current,
      automaticLayout: true,
      theme: "escode",
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "SFMono-Regular, Menlo, Consolas, monospace",
      padding: { top: 16, bottom: 16 },
      accessibilitySupport: "on",
      editContext: false,
      ariaLabel: path + " editor",
    });
    container.current.dataset.modelUri = b.model.uri.toString();
    container.current.dataset.language = b.model.getLanguageId();
    editor.current = instance;
    if (b.view) instance.restoreViewState(b.view);
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveAction.current());
    const update = () => setDirty(b.model.getValue() !== b.disk.text);
    update();
    const listener = b.model.onDidChangeContent(update);
    return () => {
      listener.dispose();
      b.view = instance.saveViewState();
      instance.dispose();
      editor.current = null;
    };
  }, [path, diff, mode, bufferRevision]);
  useEffect(() => {
    if (!diff || !container.current) return;
    const original = monaco.editor.createModel(diff.original, "plaintext");
    const buffer = diff.file ? buffers.current.get(diff.file) : undefined;
    const modified = buffer?.model ?? monaco.editor.createModel(diff.modified, "plaintext");
    const instance = monaco.editor.createDiffEditor(container.current, {
      readOnly: !buffer || closeInFlight.current || saveInFlight.current,
      originalEditable: false,
      automaticLayout: true,
      theme: "escode",
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "SFMono-Regular, Menlo, Consolas, monospace",
      padding: { top: 16, bottom: 16 },
      renderSideBySide: false,
      accessibilitySupport: "on",
      editContext: false,
      domReadOnly: !buffer,
      originalAriaLabel: diff.title + " original",
      modifiedAriaLabel: diff.title + " modified",
    });
    instance.setModel({ original, modified });
    // Monaco's initial diff option pass clears the side labels.
    instance.getOriginalEditor().updateOptions({
      ariaLabel: diff.title + " original",
      readOnly: true,
      domReadOnly: true,
    });
    const modifiedEditor = instance.getModifiedEditor();
    modifiedEditor.updateOptions({ ariaLabel: diff.title + " modified" });
    if (buffer) editor.current = modifiedEditor;
    modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveAction.current());
    const update = () => setDirty(!!buffer && modified.getValue() !== buffer.disk.text);
    update();
    const listener = modified.onDidChangeContent(update);
    return () => {
      listener.dispose();
      if (editor.current === modifiedEditor) editor.current = null;
      instance.dispose();
      original.dispose();
      if (!buffer) modified.dispose();
    };
  }, [diff]);
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
    if (!closeInFlight.current && (!diff || diff.file)) void save(undefined, diff?.file ?? path);
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
      let file: string | undefined;
      let unavailable = "";
      try {
        const buffer = buffers.current.get(change.path);
        if (!buffer || buffer.model.getValue() === buffer.disk.text) {
          const disk = await projectCall("read", root, change.path);
          if (!buffers.current.has(change.path)) addBuffer(change.path, disk);
          else if (buffer && buffer.model.getValue() === buffer.disk.text) {
            buffer.disk = disk;
            if (buffer.model.getValue() !== disk.text) buffer.model.setValue(disk.text);
          }
        }
        file = change.path;
      } catch (error) {
        unavailable = "Working file unavailable; comparison is read-only. " + String(error);
      }
      if (generation !== presentation.current || modeRef.current !== "Source Control") return;
      if (file) setPath(file);
      const title =
        change.area + " · " + change.path +
        (file && change.area === "staged" ? " · working copy" : "");
      setDiff((old) =>
        old?.title === title &&
        old.original === value.original &&
        old.modified === value.modified &&
        old.file === file
          ? old
          : { ...value, title, file },
      );
      setMessage(unavailable || "Edit the new side · Cmd+S to save the working file.");
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
  async function fileOperation(
    kind: "move" | "trash" | "paste" | "duplicate" | "drag-move" | "drag-copy" | "import",
    source: string | string[],
    destination = "",
    inline = false,
  ) {
    const transferring =
      kind === "paste" ||
      kind === "duplicate" ||
      kind === "drag-move" ||
      kind === "drag-copy" ||
      kind === "import";
    if (closeInFlight.current || saveInFlight.current || conflict) {
      if (inline || transferring) throw Error("Finish the pending file action first.");
      return;
    }
    const sources = typeof source === "string" ? [source] : [...source];
    const single = sources[0];
    closeInFlight.current = true;
    setFileClosing(!transferring);
    setTransferProgress(transferring);
    setMessage(
      transferring
        ? "Transferring files… Navigation and chat Stop remain available. Earlier move undo history resets."
        : "Applying file operation…",
    );
    editor.current?.updateOptions({ readOnly: true });
    try {
      for (const [file, b] of buffers.current) {
        memory.drafts = memory.drafts.filter((d) => d.root !== root || d.path !== file);
        if (b.model.getValue() !== b.disk.text)
          memory.drafts.push({ root, path: file, text: b.model.getValue(), disk: b.disk });
      }
      await persist();
      await flush();
      if (
        kind === "move" &&
        Array.from(buffers.current.keys()).some(
          (f) =>
            affected(
              f.normalize("NFC").toLowerCase(),
              destination.normalize("NFC").toLowerCase(),
            ) && !affected(f, single),
        )
      )
        throw Error("Destination has open buffers. Close them or choose another path.");
      const batch =
        kind === "trash"
          ? await projectCall("trash-selection", root, sources)
          : transferring
            ? await projectCall("transfer", root, kind, destination, sources)
            : null;
      const results = batch
        ? batch.results
        : [
            {
              source: single,
              ...(await projectCall(
                "file-operation",
                root,
                inline ? "rename" : "move",
                single,
                inline ? destination.split("/").at(-1)! : destination,
              )),
            },
          ];
      for (const saved of batch && "saves" in batch ? batch.saves : []) {
        const b = buffers.current.get(saved.path);
        if (b) b.disk = saved.disk;
        reconcileSave(memory, root, saved);
      }
      let nextPath = memory.views[root]?.path ?? path;
      const reconciliationNotes: string[] = [];
      for (const result of results) {
        if (!result.applied || !result.intent) continue;
        const source = result.intent.source;
        const target = result.intent.destination;
        const operationKind = result.intent.kind;
        if (operationKind === "copy") {
          for (const draft of result.intent.copies ?? []) {
            const existing = buffers.current.get(draft.path);
            if (!existing) addBuffer(draft.path, draft.disk, draft.text);
            else {
              const text = existing.model.getValue();
              const clean = text === existing.disk.text;
              const current = editor.current?.getModel() === existing.model;
              const view = current ? editor.current?.saveViewState() : existing.view;
              existing.disk = draft.disk;
              if (clean || text === draft.text) {
                if (text !== draft.text) {
                  existing.model.pushStackElement();
                  existing.model.pushEditOperations(
                    [],
                    [{ range: existing.model.getFullModelRange(), text: draft.text }],
                    () => null,
                  );
                  existing.model.pushStackElement();
                }
                if (current && view) editor.current?.restoreViewState(view);
              } else {
                reconciliationNotes.push(
                  `Destination ${root}/${draft.path} changed while copying. Its current text was retained; source edits remain available at ${root}/${moved(draft.path, target, source)}. Review both before saving.`,
                );
              }
              // Match the recovery draft to the visible model, including any newer destination edits.
              void record(draft.path, existing);
            }
          }
          reconcile(memory, result.intent);
          continue;
        }
        const current = editor.current?.getModel();
        for (const [file, b] of Array.from(buffers.current)) {
          if (!affected(file, source)) continue;
          if (current === b.model) b.view = editor.current?.saveViewState();
          buffers.current.delete(file);
          if (operationKind === "move") {
            const next = addBuffer(moved(file, source, target), b.disk, b.model.getValue());
            next.view = b.view;
          }
          b.model.dispose();
        }
        reconcile(memory, result.intent);
        nextPath =
          operationKind === "move"
            ? moved(nextPath, source, target)
            : affected(nextPath, source)
              ? ""
              : nextPath;
      }
      setPath(nextPath);
      setDiff(null);
      selectedChange.current = null;
      setBufferRevision((n) => n + 1);
      setDirty(
        !!buffers.current.get(nextPath) &&
          buffers.current.get(nextPath)!.model.getValue() !==
            buffers.current.get(nextPath)!.disk.text,
      );
      let completionError = "";
      try {
        await persist();
        // Never acknowledge before the reconciled state has reached durable storage.
        if (batch?.requiresAck || (!batch && results.some((r) => r.applied)))
          await projectCall("file-operation-ack", root);
      } catch (error) {
        completionError = `\nRecovery persistence/acknowledgement failed; restart to reconcile available intent: ${String(error)}`;
      }
      setFilesRevision((n) => n + 1);
      let refreshError = "";
      try {
        await refresh();
      } catch (error) {
        refreshError = `\nRefresh failed: ${String(error)}`;
      }
      if (batch && "open" in batch) for (const file of batch.open) await select(file);
      const failed = batch && "saves" in batch ? batch.results.find((r) => r.conflict) : undefined;
      if (failed?.conflict) {
        await select(failed.conflict.path);
        setConflict(failed.conflict);
      }
      const message =
        [batch?.message ?? results[0].message, ...reconciliationNotes].join("\n") +
        completionError +
        refreshError;
      setMessage(message);
      if (inline && !results[0].applied) throw Error(message);
    } catch (error) {
      report(error);
      if (inline) throw error;
    } finally {
      closeInFlight.current = false;
      setFileClosing(false);
      setTransferProgress(false);
      editor.current?.updateOptions({ readOnly: false });
    }
  }
  closers.set(root, {
    project,
    close: async () => {
      if (closeInFlight.current) return false;
      for (const file of buffers.current.keys()) if (!(await closeFile(file, false))) return false;
      return true;
    },
  });
  return (
    <div className="workspace" hidden={!active || mode === "Chats"} inert={fileClosing}>
      <aside aria-label={mode + " sidebar"}>
        {transferProgress && (
          <p role="status">
            Transferring captured files… Navigation and chat Stop remain available.
          </p>
        )}
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
                  setFilesRevision((n) => n + 1);
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
            <FilesTree
              key={root}
              root={root}
              active={active}
              activePath={path}
              disabled={!!conflict || saving}
              revision={filesRevision}
              dirty={(file) => {
                const b = buffers.current.get(file);
                return !!b && b.model.getValue() !== b.disk.text;
              }}
              open={async (file, focusEditor) => {
                await select(file);
                if (focusEditor)
                  requestAnimationFrame(() => {
                    if (
                      container.current?.getClientRects().length &&
                      editor.current?.getModel() === buffers.current.get(file)?.model
                    )
                      editor.current?.focus();
                  });
              }}
              rename={(source, destination) => fileOperation("move", source, destination, true)}
              create={async (parent, name, kind) => {
                const destination = (parent ? parent + "/" : "") + name;
                if (
                  Array.from(buffers.current.keys()).some(
                    (file) =>
                      file.normalize("NFC").toLowerCase() ===
                      destination.normalize("NFC").toLowerCase(),
                  )
                )
                  throw Error("Destination has an open buffer. Close it or choose a free name.");
                const file = await projectCall("create-entry", root, parent, name, kind);
                setFilesRevision((n) => n + 1);
                if (kind === "file") await select(file);
                return file;
              }}
              transfer={async (kind, sources, parent) => {
                if (kind === "copy" || kind === "cut") {
                  setMessage(await projectCall("clipboard-capture", root, kind, sources));
                } else await fileOperation(kind, sources, parent);
              }}
              trash={async (sources) => {
                await fileOperation("trash", sources);
              }}
            />
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
                {dirty && path && (!diff || diff.file) ? " • Unsaved" : ""}
              </span>
              {path && (mode === "Files" || diff?.file) && (
                <Button disabled={saving} onClick={() => void save(undefined, diff?.file ?? path)}>
                  Save ⌘S
                </Button>
              )}
              {path && mode === "Files" && (
                <Button disabled={saving || fileClosing} onClick={() => void closeFile(path)}>
                  Close file
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
                      file: conflict.path,
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
            <p
              role="status"
              tabIndex={0}
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                maxHeight: "30vh",
                overflow: "auto",
                flexShrink: 0,
              }}
            >
              {message}
            </p>
            <div className="editor" ref={container} />
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
  const [chatStore, { snapshots, chats }] = useProjectChats(initial.project);
  const [selectedChat, setSelectedChat] = useMemory(initial.project, "chat", "");
  const chatNavigation = useRef(0);
  useEffect(() => {
    chatNavigation.current++;
  }, [active, mode]);
  const selectChat = async (id: string) => {
    chatNavigation.current++;
    const chat = chats.find((c) => c.id === id);
    if (chat && chat.phase !== "draft") selectCheckout(chat.checkout);
    setSelectedChat(id);
    await chatStore.open(id);
  };
  const createChat = async (root: string) => {
    const generation = chatNavigation.current;
    const chat =
      root === checkout
        ? await window.escode.chat("createDraft", initial.project)
        : await window.escode.chat("create", initial.project, root);
    await chatStore.load();
    if (chatNavigation.current !== generation) return;
    if (chat.phase !== "draft") selectCheckout(chat.checkout);
    await selectChat(chat.id);
  };
  useEffect(() => {
    const all = Object.values(snapshots);
    const value = all.some((s) => s.requests.length)
      ? "Needs input"
      : all.some((s) => s.busy)
        ? "Running"
        : "";
    setActivity(value);
    onActivity(value);
  }, [snapshots, onActivity]);
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
            <div className="chat-view">
              <div className="chat-conversation">
                <WorktreeChoices
                  project={initial.project}
                  createChat={createChat}
                  onRemoved={() => chatStore.load()}
                />
                {active && mode === "Chats" && (
                  <ChatView
                    project={initial.project}
                    checkout={checkout}
                    sidebarId={sidebarId}
                    selected={selectedChat}
                    select={selectChat}
                    createChat={createChat}
                  />
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
function App({ restored, errors }: { restored: Status[]; errors: string[] }) {
  const [projects, setProjects] = useState<Status[]>(restored);
  const [selected, setSelected] = useState(memory.selected || "agents");
  useEffect(() => {
    const moved = () => setSelected("agents");
    window.addEventListener("draft-context-changed", moved);
    return () => window.removeEventListener("draft-context-changed", moved);
  }, []);
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
          if (memory.selected === project) memory.selected = "agents";
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
          : [
              ...old,
              {
                ...value,
                root:
                  memory.savedProjects?.find((p) => p.project === value.project)?.root ??
                  value.root,
              },
            ],
      );
      if (!memory.projects.some((p) => p.project === value.project)) {
        const saved = memory.savedProjects?.find((p) => p.project === value.project);
        memory.projects.push(saved ?? { project: value.project, root: value.root });
      }
      memory.savedProjects ??= [];
      if (!memory.savedProjects.some((p) => p.project === value.project))
        memory.savedProjects.push({ project: value.project, root: value.root });
      void persist();
      setSelected(value.project);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <main {...stylex.props(styles.page)} data-agents={selected === "agents"} inert={closing}>
      <header>
        <strong>escode</strong>
        <span>{selected}</span>
      </header>
      <nav className="project-tabs" aria-label="Projects">
        <Button aria-pressed={selected === "agents"} onClick={() => setSelected("agents")}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></svg>
          Agents
        </Button>
        {projects.map((p) => (
          <div className="project-tab" key={p.project} data-active={selected === p.project}>
          <Button
            key={p.project}
            aria-label={p.project.split("/").at(-1) + (activity[p.project] ? " · " + activity[p.project] : "")}
            aria-pressed={selected === p.project}
            title={`${p.project} · Middle-click or press Delete to close editor`}
            onAuxClick={(event) => {
              if (event.button === 1) void close(p.project);
            }}
            onKeyDown={(event) => {
              if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                void close(p.project);
              }
            }}
            onClick={() => setSelected(p.project)}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 3 9 5v8l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v8" /></svg>
            <span className="project-tab-name">{p.project.split("/").at(-1)}</span>
            {activity[p.project] && <span className="project-tab-activity" title={activity[p.project]} aria-label={activity[p.project]} />}
          </Button>
          <Button className="project-tab-close" aria-label={`Close ${p.project.split("/").at(-1)} project`} title="Close project editor" onClick={() => void close(p.project)}>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 4 8 8 M12 4l-8 8" /></svg>
          </Button>
          </div>
        ))}
        <Button className="project-tab-open" aria-label="Open project…" title="Open project…" onClick={() => void open()}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14 M5 12h14" /></svg>
        </Button>
      </nav>
      {error && <p role="alert">{error}</p>}
      {selected === "agents" && <AgentsView />}
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
