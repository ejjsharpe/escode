import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { memory, useMemory } from "./workspace";
import type { FilesMemory } from "../host/workspace";

type Entry = { path: string; directory: boolean };
type Listing = { entries?: Entry[]; error?: string };
export function FilesTree({
  root,
  active,
  activePath,
  disabled,
  revision,
  dirty,
  open,
  rename,
  create,
  trash,
  transfer,
}: {
  root: string;
  active: boolean;
  activePath: string;
  disabled: boolean;
  revision: number;
  dirty: (path: string) => boolean;
  open: (path: string, editor: boolean) => Promise<void>;
  rename: (path: string, destination: string) => Promise<void>;
  create: (parent: string, name: string, kind: "file" | "folder") => Promise<string>;
  trash: (paths: string[]) => Promise<void>;
  transfer: (
    kind: "copy" | "cut" | "paste" | "duplicate" | "drag-move" | "drag-copy" | "import",
    paths: string[],
    parent: string,
  ) => Promise<void>;
}) {
  const [state, setState] = useMemory(root, "files", {
    expanded: [],
    selected: [],
    focus: "",
    scroll: 0,
  });
  const [edit, setEdit] = useState<{
    source?: string;
    parent: string;
    kind: "file" | "folder";
    value: string;
    error?: string;
  } | null>(null);
  const drag = useRef<{ id: string; paths: string[]; token: Promise<string> } | null>(null);
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragGeneration = useRef(0);
  const [dropTarget, setDropTarget] = useState<{ parent: string; copy: boolean } | null>(null);
  const dragFormat = "application/x-escode-tree";
  function clearDrag() {
    clearTimeout(hover.current);
    hover.current = undefined;
    drag.current = null;
    setDropTarget(null);
  }
  useEffect(() => {
    dragGeneration.current++;
    clearDrag();
    return () => {
      dragGeneration.current++;
      clearTimeout(hover.current);
      drag.current = null;
    };
  }, [root, active, disabled]);
  function startDrag(event: DragEvent, path: string) {
    if (!active || disabled || edit || (event.target as Element).closest("input, textarea")) {
      event.preventDefault();
      return;
    }
    clearDrag();
    const paths = latest.current.selected.includes(path) ? [...latest.current.selected] : [path];
    update({ selected: paths, focus: path });
    const id = crypto.randomUUID();
    const token = window.escode.project("drag-capture", root, paths);
    // Keep capture rejection handled even if the user cancels before dropping.
    void token.catch(() => {});
    drag.current = { id, paths, token };
    event.dataTransfer.setData(dragFormat, id);
    event.dataTransfer.effectAllowed = "copyMove";
  }
  function over(event: DragEvent, parent: string) {
    event.stopPropagation();
    const session = drag.current;
    const native =
      !event.dataTransfer.types.includes(dragFormat) && event.dataTransfer.types.includes("Files");
    if (
      (!session && !native) ||
      !active ||
      disabled ||
      edit ||
      (!native && !event.dataTransfer.types.includes(dragFormat))
    ) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    const folded = (p: string) => p.normalize("NFC").toLowerCase();
    if (
      session?.paths.some(
        (p) => folded(parent) === folded(p) || folded(parent).startsWith(folded(p) + "/"),
      )
    ) {
      event.dataTransfer.dropEffect = "none";
      clearTimeout(hover.current);
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = native || event.altKey ? "copy" : "move";
    if (dropTarget?.parent !== parent) {
      clearTimeout(hover.current);
      const generation = dragGeneration.current;
      if (parent && !latest.current.expanded.includes(parent))
        hover.current = setTimeout(() => {
          if (drag.current === session && generation === dragGeneration.current) {
            update({ expanded: [...new Set([...latest.current.expanded, parent])] });
            void load(parent);
          }
        }, 650);
    }
    setDropTarget({ parent, copy: native || event.altKey });
  }
  async function drop(event: DragEvent, target: string) {
    event.preventDefault();
    event.stopPropagation();
    const session = drag.current;
    const valid = session && event.dataTransfer.getData(dragFormat) === session.id;
    const files = Array.from(event.dataTransfer.files);
    const native = !event.dataTransfer.types.includes(dragFormat) && files.length > 0;
    const nativeToken = native
      ? Promise.resolve().then(() => window.escode.nativeFiles(files))
      : undefined;
    void nativeToken?.catch(() => {});
    const copy = event.altKey;
    const generation = dragGeneration.current;
    clearDrag();
    if ((!valid && !native) || !active || disabled || edit) {
      setActionError(
        "Only a drag from this checkout's Files tree or genuine native files is supported.",
      );
      return;
    }
    try {
      let parent = "";
      if (target) {
        const container = target.split("/").slice(0, -1).join("/");
        const listing = cache[container] ?? (await load(container));
        const entry = listing.entries?.find((e) => e.path === target);
        if (!entry) throw Error(listing.error || "Destination missing. Refresh and try again.");
        parent = entry.directory ? target : container;
      }
      const token = await (nativeToken ?? session!.token);
      if (generation !== dragGeneration.current) return;
      setActionError("");
      await transfer(native ? "import" : copy ? "drag-copy" : "drag-move", [token], parent);
    } catch (error) {
      if (generation === dragGeneration.current) setActionError(String(error));
    }
    if (generation === dragGeneration.current) restoreFocus();
  }
  const input = useRef<HTMLInputElement>(null);
  const committing = useRef(false);
  const startingEdit = useRef(false);
  const [actionError, setActionError] = useState("");
  const editRef = useRef<HTMLDivElement>(null);
  const initializedInput = useRef<HTMLInputElement | null>(null);
  async function beginEdit(kind: "rename" | "file" | "folder", target = state.selected[0] || "") {
    if (edit || disabled || startingEdit.current) return;
    startingEdit.current = true;
    setActionError("");
    setMenu(null);
    try {
      let parent = "";
      let directory = false;
      if (target) {
        const container = target.split("/").slice(0, -1).join("/");
        const listing = cache[container] ?? (await load(container));
        const entry = listing.entries?.find((entry) => entry.path === target);
        if (!entry)
          throw Error(
            listing.error || "Selected entry is missing. Refresh and select the entry again.",
          );
        directory = entry.directory;
        parent = kind === "rename" || !directory ? container : target;
      } else if (kind === "rename") {
        throw Error("Select one entry to rename.");
      }
      if (parent && kind !== "rename") {
        const parts = parent.split("/");
        update({
          expanded: [
            ...new Set([
              ...latest.current.expanded,
              ...parts.map((_, i) => parts.slice(0, i + 1).join("/")),
            ]),
          ],
        });
      }
      setEdit(
        kind === "rename"
          ? {
              source: target,
              parent,
              kind: directory ? "folder" : "file",
              value: target.split("/").at(-1)!,
            }
          : { parent, kind, value: "" },
      );
    } catch (error) {
      setActionError(
        `Cannot ${kind === "rename" ? "rename" : "create at"} ${root}/${target}: ${String(error)} Use Refresh and select the entry again.`,
      );
      restoreFocus();
    } finally {
      startingEdit.current = false;
    }
  }
  function restoreFocus() {
    requestAnimationFrame(() => {
      if (tree.current?.getClientRects().length) tree.current.focus();
    });
  }
  async function commit() {
    if (!edit || committing.current) return;
    const name = edit.value;
    if (
      !name.trim() ||
      name === "." ||
      name === ".." ||
      /[/\\\0]/.test(name) ||
      name.toLowerCase() === ".git"
    ) {
      setEdit({ ...edit, error: "Enter one name without separators or traversal." });
      requestAnimationFrame(() => input.current?.focus());
      return;
    }
    committing.current = true;
    try {
      const destination = edit.parent ? edit.parent + "/" + name : name;
      if (edit.source && destination !== edit.source) await rename(edit.source, destination);
      else if (!edit.source) await create(edit.parent, name, edit.kind);
      update({ focus: destination, selected: [destination] });
      setEdit(null);
      refresh();
      restoreFocus();
    } catch (error) {
      setEdit({
        ...edit,
        error: String(error).includes("EEXIST")
          ? "This name is already in use. Choose another name."
          : `${root}/${edit.source || (edit.parent ? edit.parent + "/" : "") + name}: ${String(error)}`,
      });
      requestAnimationFrame(() => {
        if (input.current?.getClientRects().length) input.current.focus();
      });
    } finally {
      committing.current = false;
    }
  }
  useLayoutEffect(() => {
    if (!active || !edit || !input.current || initializedInput.current === input.current) return;
    initializedInput.current = input.current;
    input.current.focus();
    const end =
      edit.kind === "file" && edit.value.lastIndexOf(".") > 0
        ? edit.value.lastIndexOf(".")
        : edit.value.length;
    input.current?.setSelectionRange(0, end);
  });
  useEffect(() => {
    if (!edit || edit.error || !active) return;
    const clickAway = (event: PointerEvent) => {
      if (!editRef.current?.contains(event.target as Node)) void commit();
    };
    document.addEventListener("pointerdown", clickAway);
    return () => document.removeEventListener("pointerdown", clickAway);
  }, [edit, active]);
  function field() {
    if (!edit) return null;
    return (
      <div
        ref={editRef}
        className="tree-edit"
        onDragStart={(e) => e.stopPropagation()}
        onDragOver={(e) => e.stopPropagation()}
        onDrop={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          aria-label={edit.source ? "Rename " + edit.source : "New " + edit.kind + " name"}
          aria-invalid={!!edit.error}
          aria-describedby={root + ":edit-help"}
          value={edit.value}
          onChange={(e) => setEdit({ ...edit, value: e.target.value, error: undefined })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            }
            if (e.key === "Escape" && !committing.current) {
              e.preventDefault();
              setEdit(null);
              restoreFocus();
            }
          }}
        />
        <div id={root + ":edit-help"} className="tree-edit-help">
          {edit.error ? (
            <div role="alert">{edit.error}</div>
          ) : edit.source ? (
            "Enter to rename; Escape to cancel. Earlier text undo history resets; unsaved text and cursor/scroll are preserved."
          ) : (
            "Enter to create; Escape to cancel."
          )}
        </div>
      </div>
    );
  }
  const [cache, setCache] = useState<Record<string, Listing>>({});
  const loaded = useRef(new Map<string, Promise<Listing>>());
  const epoch = useRef(0);
  const restoring = useRef(true);
  const tree = useRef<HTMLDivElement>(null);
  const anchor = useRef(state.focus);
  const prefix = useRef({ text: "", time: 0 });
  const [menu, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const latest = useRef(state);
  latest.current = state;
  function update(next: Partial<FilesMemory>) {
    latest.current = { ...latest.current, ...next };
    setState(latest.current);
  }
  function load(path: string) {
    const pending = loaded.current.get(path);
    if (pending) return pending;
    const generation = epoch.current;
    const task = window.escode.project("files", root, path).then(
      (entries) => {
        if (generation === epoch.current) setCache((c) => ({ ...c, [path]: { entries } }));
        return { entries };
      },
      (error) => {
        if (generation === epoch.current)
          setCache((c) => ({ ...c, [path]: { error: String(error) } }));
        return { error: String(error) };
      },
    );
    loaded.current.set(path, task);
    return task;
  }
  function refresh() {
    restoring.current = true;
    epoch.current++;
    loaded.current.clear();
    setCache({});
  }
  useEffect(() => {
    if (memory.views[root]?.files) setState(memory.views[root].files!);
    refresh();
  }, [revision]);
  useEffect(() => {
    void load("");
    // Only expanded ancestors reachable from the root are loaded.
    function visit(parent: string) {
      for (const entry of cache[parent]?.entries ?? []) {
        if (entry.directory && state.expanded.includes(entry.path)) {
          void load(entry.path);
          visit(entry.path);
        }
      }
    }
    visit("");
  }, [cache, state.expanded]);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  const rows: (Entry & { level: number })[] = [];
  function collect(parent: string, level: number) {
    const entries = cache[parent]?.entries ?? [];
    entries.forEach((entry) => {
      rows.push({ ...entry, level });
      if (entry.directory && state.expanded.includes(entry.path)) collect(entry.path, level + 1);
    });
  }
  collect("", 1);
  const focused = rows.find((r) => r.path === state.focus) ?? rows[0];
  useEffect(() => {
    function missing(path: string) {
      const parts = path.split("/");
      for (let i = 0; i < parts.length; i++) {
        const entries = cache[parts.slice(0, i).join("/")]?.entries;
        if (!entries) return false;
        if (!entries.some((e) => e.path === parts.slice(0, i + 1).join("/"))) return true;
      }
      return false;
    }
    const expanded = state.expanded.filter((p) => !missing(p));
    const selected = state.selected.filter((p) => !missing(p));
    let focus = state.focus;
    while (focus && missing(focus)) focus = focus.split("/").slice(0, -1).join("/");
    if (
      expanded.length !== state.expanded.length ||
      selected.length !== state.selected.length ||
      focus !== state.focus
    )
      update({ expanded, selected, focus });
  }, [cache]);

  // Wait for restored expanded directories before clamping the remembered scroll.
  useLayoutEffect(() => {
    if (!active) {
      restoring.current = true;
      return;
    }
    if (!tree.current || !restoring.current) return;
    tree.current.scrollTop = state.scroll;
    if (
      cache[""] &&
      !rows.some((r) => r.directory && state.expanded.includes(r.path) && !cache[r.path])
    )
      restoring.current = false;
  }, [cache, active]);
  useEffect(() => {
    if (menu !== null)
      menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [menu]);
  function focus(path: string, range = false, additive = false) {
    let selected = [path];
    if (range) {
      const start = rows.findIndex((r) => r.path === anchor.current);
      const end = rows.findIndex((r) => r.path === path);
      selected = rows
        .slice(Math.min(start < 0 ? end : start, end), Math.max(start, end) + 1)
        .map((r) => r.path);
    } else {
      anchor.current = path;
      if (additive)
        selected = state.selected.includes(path)
          ? state.selected.filter((p) => p !== path)
          : [...state.selected, path];
    }
    update({ focus: path, selected });
    requestAnimationFrame(() =>
      tree.current
        ?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"] > .tree-row`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }
  function toggle(path: string) {
    const expanded = state.expanded.includes(path);
    update({
      expanded: expanded ? state.expanded.filter((p) => p !== path) : [...state.expanded, path],
      ...(expanded && state.focus.startsWith(path + "/") ? { focus: path } : {}),
    });
  }
  function context(path: string) {
    if (!state.selected.includes(path)) {
      anchor.current = path;
      update({ selected: [path], focus: path });
    } else update({ focus: path });
    setMenu(path);
  }
  function dismiss() {
    setMenu(null);
    tree.current?.focus();
  }
  async function moveToTrash() {
    if (disabled || edit || !latest.current.selected.length) return;
    const paths = [...latest.current.selected];
    dismiss();
    await trash(paths);
    if (active) restoreFocus();
  }
  async function transferSelection(kind: "copy" | "cut" | "paste" | "duplicate") {
    const paths = [...latest.current.selected];
    const target = menu ?? latest.current.focus;
    dismiss();
    setActionError("");
    try {
      let parent = "";
      if (kind === "paste" && target) {
        const container = target.split("/").slice(0, -1).join("/");
        const listing = cache[container] ?? (await load(container));
        const entry = listing.entries?.find((e) => e.path === target);
        if (!entry) throw Error(listing.error || "Destination missing. Refresh and select again.");
        parent = entry.directory ? target : container;
      }
      await transfer(kind, paths, parent);
    } catch (error) {
      setActionError(String(error));
    }
    if (active) restoreFocus();
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || disabled || edit) return;
    if (event.key === "Escape" && drag.current) {
      clearDrag();
      return;
    }
    if (event.key === "Escape" && menu !== null) {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.metaKey && ["Backspace", "Delete"].includes(event.key)) {
      event.preventDefault();
      void moveToTrash();
      return;
    }
    if (event.metaKey && ["c", "x", "v"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      void transferSelection(
        event.key.toLowerCase() === "c"
          ? "copy"
          : event.key.toLowerCase() === "x"
            ? "cut"
            : "paste",
      );
      return;
    }
    const row = focused;
    const index = rows.findIndex((r) => r.path === row?.path);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      update({ selected: rows.map((r) => r.path) });
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.altKey && ["n", "N"].includes(event.key)) {
      event.preventDefault();
      beginEdit(event.shiftKey ? "folder" : "file");
      return;
    }
    if (event.key === "Enter" && state.selected.length === 1) {
      event.preventDefault();
      beginEdit("rename", state.selected[0]);
      return;
    }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const target = state.selected[0] || row?.path;
      if (target) context(target);
      else setMenu("");
      return;
    }
    if (!row) return;
    if (event.metaKey && event.key === "ArrowDown") {
      event.preventDefault();
      if (!row.directory) void open(row.path, true);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      focus(rows[next].path, event.shiftKey);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row.directory) {
        if (!state.expanded.includes(row.path)) toggle(row.path);
        else if (rows[index + 1]?.level > row.level) focus(rows[index + 1].path, event.shiftKey);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.directory && state.expanded.includes(row.path)) toggle(row.path);
      else {
        const parent = row.path.split("/").slice(0, -1).join("/");
        if (parent) focus(parent, event.shiftKey);
      }
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (!row.directory) void open(row.path, false);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.length === 1) {
      event.preventDefault();
      const now = Date.now();
      const text =
        (now - prefix.current.time < 700 ? prefix.current.text : "") +
        event.key.toLocaleLowerCase();
      prefix.current = { text, time: now };
      const query = [...text].every((c) => c === text[0]) ? text[0] : text;
      const ordered = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
      const match = ordered.find((r) =>
        r.path.split("/").at(-1)!.toLocaleLowerCase().startsWith(query),
      );
      if (match) focus(match.path, event.shiftKey);
    }
  }
  function listing(parent: string, level: number) {
    const value = cache[parent];
    if (!value?.entries)
      return (
        <>
          {edit && !edit.source && edit.parent === parent && field()}
          <div className="tree-message" role="status" style={{ paddingLeft: level * 16 }}>
            {value?.error
              ? `${parent || "Checkout"}: ${value.error}. Use Refresh to retry.`
              : "Loading files…"}
          </div>
        </>
      );
    if (!value.entries.length && !(edit && !edit.source && edit.parent === parent))
      return (
        <div className="tree-message" role="status" style={{ paddingLeft: level * 16 }}>
          Empty folder
        </div>
      );
    return (
      <>
        {edit && !edit.source && edit.parent === parent && field()}
        {value.entries.map((entry, index) => {
          return (
            <div
              key={entry.path}
              role="treeitem"
              id={root + ":" + entry.path}
              data-path={entry.path}
              aria-label={entry.path.split("/").at(-1) + (dirty(entry.path) ? ", unsaved" : "")}
              aria-level={level}
              aria-posinset={index + 1}
              aria-setsize={value.entries!.length}
              aria-selected={state.selected.includes(entry.path)}
              aria-expanded={entry.directory ? state.expanded.includes(entry.path) : undefined}
              aria-current={entry.path === activePath ? "true" : undefined}
            >
              <div
                className={
                  "tree-row" +
                  (entry.path === focused?.path ? " tree-focus" : "") +
                  (dropTarget?.parent === entry.path ? " tree-drop" : "")
                }
                draggable={!disabled && !edit}
                onDragStart={(event) => startDrag(event, entry.path)}
                onDragEnd={clearDrag}
                onDragOver={(event) => over(event, entry.directory ? entry.path : parent)}
                onDrop={(event) => void drop(event, entry.path)}
                style={{ paddingLeft: 6 + (level - 1) * 16 }}
                onClick={(event) => {
                  if (disabled) return;
                  tree.current?.focus();
                  focus(entry.path, event.shiftKey, event.metaKey || event.ctrlKey);
                  if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
                    if (entry.directory) toggle(entry.path);
                    else void open(entry.path, false);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!disabled) context(entry.path);
                }}
              >
                {entry.directory && (
                  <svg
                    aria-hidden="true"
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    style={{
                      transform: state.expanded.includes(entry.path) ? "rotate(90deg)" : undefined,
                    }}
                  >
                    <path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                )}
                {edit?.source === entry.path ? (
                  field()
                ) : (
                  <span>{entry.path.split("/").at(-1)}</span>
                )}
                {dirty(entry.path) && <span aria-hidden="true"> •</span>}
              </div>
              {entry.directory && state.expanded.includes(entry.path) && (
                <div
                  role="group"
                  onDragOver={(event) => over(event, entry.path)}
                  onDrop={(event) => void drop(event, entry.path)}
                >
                  {listing(entry.path, level + 1)}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  }
  return (
    <>
      <div className="files-tools" aria-label="Files actions">
        <button
          title="New File (Cmd+Option+N)"
          aria-keyshortcuts="Meta+Alt+N"
          disabled={disabled || !!edit}
          onClick={() => beginEdit("file")}
        >
          New File
        </button>
        <button
          title="New Folder (Cmd+Option+Shift+N)"
          aria-keyshortcuts="Meta+Alt+Shift+N"
          disabled={disabled || !!edit}
          onClick={() => beginEdit("folder")}
        >
          New Folder
        </button>
        <button onClick={refresh}>Refresh</button>
        <button onClick={() => update({ expanded: [], focus: state.focus.split("/")[0] || "" })}>
          Collapse All
        </button>
      </div>
      {actionError && (
        <div role="alert" className="tree-edit-help">
          {actionError}
        </div>
      )}
      <div role="status" className="tree-edit-help tree-drop-status">
        {dropTarget
          ? `${dropTarget.copy ? "Copy" : "Move"} to ${dropTarget.parent || "checkout root"}${!dropTarget.copy ? " · confirmation before moving" : ""}`
          : "Drag to move · Option-drag to copy"}
      </div>
      <div
        ref={tree}
        role="tree"
        aria-label="Files"
        aria-multiselectable="true"
        aria-disabled={disabled}
        aria-activedescendant={focused ? root + ":" + focused.path : undefined}
        tabIndex={0}
        className={"files-tree" + (dropTarget?.parent === "" ? " tree-drop" : "")}
        onDragOver={(event) => over(event, "")}
        onDrop={(event) => void drop(event, "")}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            clearTimeout(hover.current);
            setDropTarget(null);
          }
        }}
        onKeyDown={key}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            update({ selected: [], focus: "" });
            tree.current?.focus();
          }
        }}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            update({ selected: [], focus: "" });
            setMenu("");
          }
        }}
        onScroll={(event) => {
          if (active && !restoring.current && event.currentTarget.getClientRects().length)
            update({ scroll: event.currentTarget.scrollTop });
        }}
      >
        {edit &&
          (edit.source
            ? !rows.some((r) => r.path === edit.source)
            : edit.parent &&
              !rows.some(
                (r) => r.path === edit.parent && r.directory && state.expanded.includes(r.path),
              )) &&
          field()}
        {listing("", 1)}
      </div>
      {menu !== null && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={"Actions for " + menu}
          className="files-menu"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setMenu(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              dismiss();
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
              );
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              items[
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length
              ]?.focus();
            }
          }}
        >
          <p>
            {state.selected.length} selected · {menu}
          </p>
          <button
            role="menuitem"
            disabled={disabled || !!edit}
            onClick={() => beginEdit("file", menu)}
          >
            New File
          </button>
          <button
            role="menuitem"
            disabled={disabled || !!edit}
            onClick={() => beginEdit("folder", menu)}
          >
            New Folder
          </button>
          <button
            role="menuitem"
            disabled={disabled || !!edit || state.selected.length !== 1}
            onClick={() => {
              dismiss();
              beginEdit("rename", menu);
            }}
          >
            Rename
          </button>
          <button
            role="menuitem"
            disabled={disabled || !!edit || !state.selected.length}
            onClick={() => void moveToTrash()}
          >
            Move to Trash
          </button>
          {(["copy", "cut", "paste", "duplicate"] as const).map((kind) => (
            <button
              key={kind}
              role="menuitem"
              disabled={disabled || !!edit || (kind !== "paste" && !state.selected.length)}
              onClick={() => void transferSelection(kind)}
            >
              {kind[0].toUpperCase() + kind.slice(1)}
            </button>
          ))}
          {state.selected.length > 1 && <p>Choose one entry for Rename.</p>}
          <button role="menuitem" onClick={dismiss}>
            Dismiss menu
          </button>
        </div>
      )}
      <div className="files-operation-actions">
        <button
          disabled={disabled || !!edit || state.selected.length !== 1}
          aria-label={"Rename " + state.selected[0]}
          onClick={() => beginEdit("rename", state.selected[0])}
        >
          Rename
        </button>
        <button
          disabled={disabled || !!edit || !state.selected.length}
          aria-label={
            "Move to Trash " +
            (state.selected.length === 1
              ? state.selected[0]
              : state.selected.length + " selected items")
          }
          aria-keyshortcuts="Meta+Backspace Meta+Delete"
          onClick={() => void moveToTrash()}
        >
          Trash
        </button>
      </div>
    </>
  );
}
