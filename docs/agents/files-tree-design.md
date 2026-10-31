# Asynchronous Files tree design

## Scope and baseline

The user authorized an implementation rewrite, superseding historical spec-only guidance.
Work stays on main at starting HEAD `0a9c981c9b41d0a6bdf6890cff5a301fdc76ffbb`.
The initial tracked tree was clean. Only `vscode-folder-expansion-research.md` and
`../compatibility/files-expansion.md` were untracked; both remain historical references.
The rejected experiment was already absent, with its patch at
`/tmp/escode-files-expansion-final.patch`. No reset or clean was needed.
The open `wayfinder:map` query returned no issues on 2026-10-31.

## Constraints and dependencies

Complete logical tree data must survive row recycling. Keyboard navigation, range
selection, active-descendant, inline editing, wrapping, active reveal, scroll restoration,
filtering, drag hover and file-operation preservation all cross this coordination point.
The tree cannot infer deletion from a failed read or use row index as identity.
Discovery is limited to root, reachable expanded directories and explicit action/reveal
ancestors. Scrolling must never discover additional directories.

Loading and projection are in-process dependencies. Directory reads and watches are
remote-but-owned: reuse the authenticated host contract through a production Adapter;
controlled promises and watch signals supply the deterministic test Adapter. Existing
file-operation callbacks retain host validation, confirmation and durable preservation.

## Design It Twice

Three independent design agents inspected main and proposed different Interfaces:

1. A unified Files Module with construction, subscribe and command. It hides interaction,
   cache and viewport state behind snapshots. High Depth, but the command vocabulary
   absorbs unrelated operation coordination and makes the Interface larger than its
   method count suggests.
2. A Files model plus a measured viewport Module, joined by complete logical rows.
   Async correctness and geometry have independent test surfaces. The seam is slightly
   larger, but Locality is strong: stale results belong to the model; wrapping and scroll
   corrections belong to the viewport.
3. A declarative React hook returning bound props and rendering items. This optimizes the
   only current UI caller, but couples deterministic verification to React and risks hiding
   a second untested controller underneath the hook.

Selected design: the second, with concrete Files data rather than a generic tree framework.
Keep the React adapter small and retain existing file-operation handlers. Replace the old
cache, pending-load map, recursive JSX and DOM-only scroll assumptions. Do not retain the
rejected 150 ms publication window.

## Source observations

Re-read actual upstream source at VS Code commit
`c198526d8e64ba6f9944e9f7bcc079ed1f6d7fcc`, downloaded from raw.githubusercontent.com
on 2026-10-31 to `/tmp/escode-vscode-reference`.

- [Explorer model](https://github.com/microsoft/vscode/blob/c198526d8e64ba6f9944e9f7bcc079ed1f6d7fcc/src/vs/workbench/contrib/files/common/explorerModel.ts):
  `fetchChildren` reuses resolved children and merges disk results; `forgetChildren`
  resets resolution. Single-child chains can resolve together.
- [File service](https://github.com/microsoft/vscode/blob/c198526d8e64ba6f9944e9f7bcc079ed1f6d7fcc/src/vs/platform/files/common/fileService.ts):
  `readdir` and settled child processing complete before assigning `children`.
- [Async tree](https://github.com/microsoft/vscode/blob/c198526d8e64ba6f9944e9f7bcc079ed1f6d7fcc/src/vs/base/browser/ui/tree/asyncDataTree.ts):
  `doGetChildren` shares pending requests; `processChildren` sorts the full iterable;
  `setChildren` reuses nodes by identity; an 800 ms timeout marks slow requests and is
  cancelled on completion. The timer does not delay successful contents.
- [List view](https://github.com/microsoft/vscode/blob/c198526d8e64ba6f9944e9f7bcc079ed1f6d7fcc/src/vs/base/browser/ui/list/listView.ts):
  render-range differences add/remove mounted rows; dynamic-height handling measures
  entering rows before recycling where needed.

Main recheck: `host/project.ts` already sorts directory-first listings and completes Git
ignore classification; `src/files.tsx` publishes each listing together but mounts every
expanded entry recursively. Its reopening path deletes the pending/resolved promise and
re-reads; remembered expansions are discovered through successive React effects.

## Design inferences and intentional differences

Use the upstream separation of async data and viewport rendering, not a source transplant.
Cached reopening should use resolved data until invalidated, replacing unconditional
reopening reads. Watch readiness, focus/reactivation and explicit Refresh cover recovery;
unavailable watches remain disclosed. No guarantee can detect every missed notification
immediately without polling. Keep filename wrapping rather than adopting truncated labels.
Keep escode's existing keyboard bindings, independent selection, Git-ignore policy and file
preservation workflows. Compact single-child folders and configurable VS Code sorting are
outside this rewrite. Exact Checkout-relative paths identify entries; external renames are
remove/add because the existing listing contract does not provide filesystem object IDs.
Logical cancellation suppresses stale publication; the shared transport need not be closed.
Existing explicit directory overflow limits remain; virtualization does not enlarge wire limits.

Measurements and final validation belong in `../compatibility/files-tree-rewrite.md`.
