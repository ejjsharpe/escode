import type { WorkspaceState } from "./workspace";
import type { Intent } from "./file-operations";
export const affected = (path: string, source: string) =>
  path === source || path.startsWith(source + "/");
export const moved = (path: string, source: string, destination: string) =>
  affected(path, source) ? destination + path.slice(source.length) : path;
export function reconcile(state: WorkspaceState, intent: Intent) {
  const { root, source, destination, kind } = intent;
  state.drafts = state.drafts.flatMap((d) =>
    d.root !== root || !affected(d.path, source)
      ? [d]
      : kind === "trash"
        ? []
        : [{ ...d, path: moved(d.path, source, destination) }],
  );
  const view = state.views[root];
  if (view) {
    for (const field of ["path", "directory"] as const) {
      if (view[field] && affected(view[field], source))
        view[field] = kind === "trash" ? "" : moved(view[field], source, destination);
    }
    if (view.files) {
      const map = (paths: string[]) =>
        paths.flatMap((p) =>
          kind === "trash" && affected(p, source)
            ? []
            : [kind === "move" ? moved(p, source, destination) : p],
        );
      view.files = {
        ...view.files,
        expanded: map(view.files.expanded),
        selected: map(view.files.selected),
        focus: map([view.files.focus])[0] ?? source.split("/").slice(0, -1).join("/"),
      };
    }
    if (view.change && affected(view.change.path, source)) view.change = undefined;
  }
}
