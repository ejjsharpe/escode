import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
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
  trash,
}: {
  root: string;
  active: boolean;
  activePath: string;
  disabled: boolean;
  revision: number;
  dirty: (path: string) => boolean;
  open: (path: string, editor: boolean) => Promise<void>;
  rename: (path: string) => void;
  trash: (path: string) => void;
}) {
  const [state, setState] = useMemory(root, "files", {
    expanded: [],
    selected: [],
    focus: "",
    scroll: 0,
  });
  const [cache, setCache] = useState<Record<string, Listing>>({});
  const loaded = useRef(new Map<string, Promise<void>>());
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
      },
      (error) => {
        if (generation === epoch.current)
          setCache((c) => ({ ...c, [path]: { error: String(error) } }));
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
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || disabled) return;
    if (event.key === "Escape" && menu !== null) {
      event.preventDefault();
      dismiss();
      return;
    }
    const row = focused;
    const index = rows.findIndex((r) => r.path === row?.path);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      update({ selected: rows.map((r) => r.path) });
      return;
    }
    if (!row) return;
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      context(row.path);
      return;
    }
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
        <div className="tree-message" role="status" style={{ paddingLeft: level * 16 }}>
          {value?.error
            ? `${parent || "Checkout"}: ${value.error}. Use Refresh to retry.`
            : "Loading files…"}
        </div>
      );
    if (!value.entries.length)
      return (
        <div className="tree-message" role="status" style={{ paddingLeft: level * 16 }}>
          Empty folder
        </div>
      );
    return value.entries.map((entry, index) => {
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
            className={"tree-row" + (entry.path === focused?.path ? " tree-focus" : "")}
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
            <span>{entry.path.split("/").at(-1)}</span>
            {dirty(entry.path) && <span aria-hidden="true"> •</span>}
          </div>
          {entry.directory && state.expanded.includes(entry.path) && (
            <div role="group">{listing(entry.path, level + 1)}</div>
          )}
        </div>
      );
    });
  }
  return (
    <>
      <div className="files-tools" aria-label="Files actions">
        <button onClick={refresh}>Refresh</button>
        <button onClick={() => update({ expanded: [], focus: state.focus.split("/")[0] || "" })}>
          Collapse All
        </button>
      </div>
      <div
        ref={tree}
        role="tree"
        aria-label="Files"
        aria-multiselectable="true"
        aria-disabled={disabled}
        aria-activedescendant={focused ? root + ":" + focused.path : undefined}
        tabIndex={0}
        className="files-tree"
        onKeyDown={key}
        onScroll={(event) => {
          if (active && !restoring.current && event.currentTarget.getClientRects().length)
            update({ scroll: event.currentTarget.scrollTop });
        }}
      >
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
            disabled={disabled || state.selected.length !== 1}
            onClick={() => {
              dismiss();
              rename(menu);
            }}
          >
            Rename/move
          </button>
          <button
            role="menuitem"
            disabled={disabled || state.selected.length !== 1}
            onClick={() => {
              dismiss();
              trash(menu);
            }}
          >
            Move to Trash
          </button>
          {state.selected.length > 1 && <p>Choose one entry for Rename/move or Trash.</p>}
          <button role="menuitem" onClick={dismiss}>
            Dismiss menu
          </button>
        </div>
      )}
      <div className="files-operation-actions">
        <button
          disabled={disabled || state.selected.length !== 1}
          aria-label={"Rename/move " + state.selected[0]}
          onClick={() => rename(state.selected[0])}
        >
          Rename/move
        </button>
        <button
          disabled={disabled || state.selected.length !== 1}
          aria-label={"Move to Trash " + state.selected[0]}
          onClick={() => trash(state.selected[0])}
        >
          Trash
        </button>
      </div>
    </>
  );
}
