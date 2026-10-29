# Create and inline rename (issue 41)

This slice implements empty file/folder creation and single-basename inline Rename in the existing Files tree on the isolated Files branch, based on `676baa3dd27249c1c8a480ea54aecf9144b567c6`. It replaces the temporary checkout-relative Rename/move form; transfers remain later scope. No dependency, workspace schema or broader copy/import capability is added.

New File/New Folder use the selected folder, a selected file's parent, or root after empty-space selection/context targeting. Creating expands the destination and a new file opens in the existing editor. Toolbar and context menu provide both commands. Tree-focused Cmd+Option+N creates a file; Cmd+Option+Shift+N creates a folder. Enter starts single-entry Rename; it initially selects a file's stem (the whole name for folders/dotfiles). Enter or pointer click-away submits, Escape cancels, and window blur alone leaves the input untouched. Shortcuts ignore input and Monaco events. Field labels, described instructions, local alert errors, invalid state and restored tree/input focus support keyboard use. The user has confirmed the bounded inline VoiceOver journey recorded under Manual evidence below.

Names reject empty/whitespace-only input, absolute/traversal names, slash/backslash/NUL and case variants of .git. Both renderer and host validate; the host derives a rename destination from the source parent and one basename. Native create opens the approved checkout descriptor with the existing no-follow/beneath boundary, compares parent identity at execution, creates files exclusively or uses exclusive mkdir, and never truncates existing entries. Native rename retains exclusive no-overwrite behavior, including case-only changes on the tested filesystem. The main-process sender, open/approved checkout, project-session lifetime, mutation/recovery lock and protected app-state checks apply. Open destination buffers and available destination recovery drafts block creation/replacement. A create under a directory containing protected app state is rejected even when the leaf does not exist.

Rename uses the established durable move-intent journal and reconciliation flow. Dirty descendants retain text, disk conflict baseline and view state; Monaco models rebind to the new URI/language through supported APIs. Earlier undo history resets with disclosure before submission and in the success status; subsequent undo works. Recovery/tree paths map with the successful outcome. Files entries refresh after success. Failure retains the inline value and local error; uncertain outcomes retain available work and intent and block mutations pending reconciliation. A field remains available if its old source row disappears. Completion belongs to its originating CheckoutView, including a project switch during journal persistence. Native operations retain the first gate's disclosed final-check-to-mutation race limitation; no cross-process transaction is claimed.

## Verification

Platform: macOS arm64, Electron 45.1.0, Monaco 0.57.0. All journeys use generated temporary repositories and isolated profiles. Commands from the repository root:

```sh
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
bun run --cwd apps/desktop test
bun run --cwd apps/desktop build
bun run --cwd apps/desktop package
bun run --cwd apps/desktop smoke
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-inline.spec.ts tests/file-operations.spec.ts tests/files-tree.spec.ts tests/agents-files-recovery.spec.ts
git diff --check
```

`host/file-operations.test.ts` adds real-repository exclusive file/folder creation, invalid names, occupied paths, missing parents, .git, replaced checkout roots and regular-directory/symlink parent swaps at native execution. Existing move tests cover case-only dirty-folder remapping, interrupted intent/restart, failed persistence, uncertain results, source/destination swaps, conflict baselines and native Trash.

`tests/files-inline.spec.ts` exercises toolbar/context/keyboard creation, unloaded-folder input focus, selected-file parent/root targets, new-file editor/language, create and rename name collisions without overwrite, stem selection, Escape/focus restoration, actual Electron window blur plus renderer blur, case-only click-away rename, and Monaco Enter isolation. A second journey pauses the real journal persistence, switches project, then resumes and asserts only the origin changed. A third executes the real native rename but drops its reply, then verifies retained input/text, Refresh showing the actual destination, and restart reconciliation followed by a save only to the destination. `tests/file-operations.spec.ts` now uses inline controls for the dirty-folder/restart/resource/undo/conflict journey, and extends protected-state IPC probes to create. Existing tree, navigation, lifecycle, accessibility and combined Agents/recovery journeys cover shared boundaries.

Ignored screenshots `apps/desktop/test-results/files-inline.png` and `files-inline-error.png` support visual inspection. The mechanical Impeccable detector returned no findings for the changed tree/CSS. Early verification caught a stale-build test launch, the protected-directory create gap, missing initial input focus for unloaded folders, and click-away retry consuming Refresh after an uncertain operation; these were corrected before final verification. An error-state field waits for changed input or explicit Enter retry so Refresh can inspect actual paths. The pending-origin test was corrected to retry a not-yet-created path rather than throw on its first ENOENT.

Final results (2026-10-29):

- Typecheck, lint, production build, unsigned macOS directory package and diff check passed.
- Full host suite: **86 passed, 2 opt-in live tests skipped** (9 files passed, 1 skipped).
- Full Electron suite: **31 passed, 1 live-Codex test skipped**. Includes all three inline journeys, dirty-folder rename/restart/undo/conflict, native authority and app-state protection, tree, navigation, lifecycle/races, accessibility, Agents recovery, concurrency, development and packaged baseline journeys.
- Additional restricted-PATH packaged journeys: **9 passed**, including inline create/case/conflicts, pending-origin rename, uncertain native result/restart, tree state and combined Agents migration/recovery.
- Existing renderer chunk-size, unsigned/default-icon package, NO_COLOR/FORCE_COLOR and development duplicate-createRoot warnings remain. The development style-update assertion passed.
- Final local logs: `/tmp/escode-41-host.log`, `/tmp/escode-41-build.log`, `/tmp/escode-41-package.log`, `/tmp/escode-41-smoke-final.log`, `/tmp/escode-41-packaged-final.log`. The reviewable unsigned app is `apps/desktop/release/mac-arm64/escode.app`.

The final full and packaged runs followed the protected-state and click-away fixes; earlier failing runs are not counted as final passes.

## Manual evidence and limits

The user confirmed the preceding **new tree** VoiceOver journey with “Pass — new tree works with VoiceOver”, covering nested expansion/selection, Shift-arrows, Shift+F10/Escape and Space/Cmd+Down. The [accepted issue 40 resolution](https://github.com/ejjsharpe/escode/issues/40#issuecomment-6504830600) records the exact scope. This is separate from first-slice controls. That tree pass does not certify a manual process-restart test or the later inline controls. First-slice Finder Put Back restored the path; explicit Refresh reflects restored entries, while automatic external-change refresh remains issue 47.

The [issue 41 manual evidence](https://github.com/ejjsharpe/escode/issues/41#issuecomment-6505289503)
records the user's “Pass — inline controls work with VoiceOver” in the isolated inline
app. The journey covered file creation, an invalid name and correction, Enter rename,
and Escape cancellation; fields, errors and focus were reported usable. This is bounded
manual evidence separate from the earlier tree pass, and does not certify a manual
process restart or full ticket acceptance. Independent code approval remains pending. The manual pass predates the review corrections below; it does not claim manual coverage of collapsed or
unavailable selection cases.

No live authenticated Codex turn, release signing or manual restart pass is claimed. Earlier text undo history resets on rename as accepted. Transfers, drag/drop, batch Trash, automatic watchers and large-tree/copy measurements remain later slices. User snapshots `/tmp/escode-files-39-manual-9342650`, `/tmp/escode-files-40-manual-f08183d`, ports 5173/5174 and `Desktop/escode-files-test` were untouched.

## Review handoff

Changed application files: `apps/desktop/host/project.ts`, `host/filesystem.c`, `host/main.ts`, `src/files.tsx`, `src/main.tsx`, `src/style.css`. Verification files: `apps/desktop/host/file-operations.test.ts`, `tests/file-operations.spec.ts`, new `tests/files-inline.spec.ts`. Documentation: `README.md`, `GLOSSARY.md`, `docs/compatibility/file-operations.md`, `files-tree.md`, new `files-inline.md`.

Implementation is ready for fresh independent Ponytail review; the checks above passed. This record grants no independent review approval or full ticket acceptance; the bounded user inline VoiceOver pass is recorded above. The full diff is unstaged/uncommitted for the parent and persistent merge agent. No staging, commit, merge, push, PR, tracker change or delegation was performed; no main or other checkout was modified.


## Fresh review correction: creation field after collapse

The parent supplied a fresh independent review finding: an invalid creation field was
rendered only inside its destination listing. Collapse All hid that listing while the
edit continued to disable new operations and tree navigation. The reviewer otherwise
reported no concrete boundary/data-loss/lean findings after inspecting all fourteen
changed files/callers, with 15 host and 11 Electron tests, typecheck, lint and diff checks
passing. Those are reviewer-reported results, not implementer reruns or Ship approval.

This correction changes only three files relative to that review:

- `apps/desktop/src/files.tsx`: extend the existing missing-rename fallback to create
  whenever its parent is not a reachable, expanded directory row. The normal listing
  still owns the field when reachable, including loading/error/empty listings. Exactly
  one field remains visible; its existing mount focus, value/error, validation, Escape,
  click-away and originating parent/checkout behavior remain in use. No host API,
  persistence, shortcut framework or broader operation scope changes.
- `apps/desktop/tests/files-inline.spec.ts`: add three real Electron regressions.
  Invalid nested creation → Collapse All → correction creates only in the original
  nested directory and opens that file; the cancellation variant restores tree focus
  and enables New File/New Folder. A third journey covers injected listing failure,
  actual destination removal and Refresh, retained input/error, safe ENOENT on retry
  without creating at root, then Escape recovery.
- `docs/compatibility/files-inline.md`: this follow-up evidence.

The collapsed invalid field screenshot
`apps/desktop/test-results/files-inline-collapse-correct.png` was visually inspected:
input, focus and validation text remain visible above the collapsed tree. Tests use
separate temporary repositories and Electron profiles. No user manual fixture, snapshot
or ports 5173/5174 were touched.

Follow-up commands:

```sh
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
bun run --cwd apps/desktop build
bun run --cwd apps/desktop smoke -- tests/files-inline.spec.ts tests/files-tree.spec.ts tests/file-operations.spec.ts
bun run --cwd apps/desktop package
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-inline.spec.ts tests/files-tree.spec.ts tests/file-operations.spec.ts
git diff --check
```

Follow-up results (2026-10-29): typecheck, lint, production build, unsigned macOS
package and diff check passed. Focused unpackaged Electron checks: **11 passed**.
The same restricted-PATH packaged checks: **11 passed**. After strengthening the
missing-destination assertion to use stat (so an accidental directory at root cannot
pass as a read failure), that journey additionally passed once unpackaged and once
packaged. Existing blur/click-away, pending-origin, uncertain-outcome/restart and
native authority/preservation regressions are included in the eleven-test runs.
Logs: `/tmp/escode-41-r1-build.log`, `/tmp/escode-41-r1-smoke.log`,
`/tmp/escode-41-r1-package.log`, `/tmp/escode-41-r1-packaged.log`. The refreshed
reviewable app remains `apps/desktop/release/mac-arm64/escode.app`. Existing build and
unsigned-package warnings remain unchanged. The prior full host and Electron counts
above describe the initial implementation; no full-suite rerun is claimed for this
rendering-only correction. The bounded user inline VoiceOver pass is now recorded above; manual process-restart
verification remains parent-owned and pending. All work remains uncommitted and
unstaged for a **new independent reviewer**; no independent approval is granted here.


## Round 2 correction: selected creation destination after collapse

The parent reports that independent review round 2 confirmed the first hidden-field
finding resolved and all three correction regressions passing. That review found a
separate destination bug: after selecting folder/deep then Collapse All, New File and
New Folder looked up only visible rows, treating the invisible directory as a file and
creating in folder instead. The reviewer otherwise reported no further concrete
findings across all fourteen files/callers/spec, with 15 host and 11 Electron checks,
typecheck, lint and diff passing. These remain reviewer-reported checks, not Ship
approval or fresh implementer full-suite runs.

Only three files change relative to round 2:

- `apps/desktop/src/files.tsx`: resolve the selected entry from the retained listing of
  its containing directory, using the existing lazy load when absent. Load now returns
  its listing as well as caching it. Missing/failed listings show a contextual alert
  with the originating checkout and selected path; no unknown entry is assumed to be a
  file and no fallback parent/root is granted. One in-flight resolution prevents
  competing edit starts. Successful resolution expands the original destination's
  ancestors. Host validation and all mutation/recovery boundaries remain unchanged.
- `apps/desktop/tests/files-inline.spec.ts`: two exact-disk regressions cover selected
  folder/deep → Collapse All → New File and New Folder, checking that only the nested
  destination exists (and a new file opens there). A third journey restores a hidden
  selection with unloaded listings, verifies successful type loading, then exercises a
  failed listing and an actually missing entry without offering a retargeted editor.
  The existing synthetic root-context-menu journey now waits for creation to finish
  and focuses the tree before dispatch. Fixture removal uses Node's bounded recursive
  retry after an observed ENOTEMPTY teardown race following SIGKILL; no product
  assertion was weakened.
- `docs/compatibility/files-inline.md`: retain both review findings and their fixes,
  record current checks, and replace stale inline manual-pending claims with the bounded
  user VoiceOver pass. No manual process-restart claim is added.

Round 2 follow-up commands:

```sh
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
bun run --cwd apps/desktop build
bun run --cwd apps/desktop smoke -- tests/files-inline.spec.ts tests/files-tree.spec.ts tests/file-operations.spec.ts
bun run --cwd apps/desktop package
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-inline.spec.ts tests/files-tree.spec.ts tests/file-operations.spec.ts
git diff --check
```

Round 2 implementer results (2026-10-29): typecheck, lint, production build,
unsigned macOS directory package and diff check passed. All **14 focused Electron
journeys passed**, followed by **14 restricted-PATH packaged journeys passed**.
These include both exact collapsed-destination regressions, lazy selected-type loading,
unavailable/missing selection rejection, all three first-review regressions, and the
existing blur/click-away, pending origin, uncertain outcome/restart, native protection
and dirty rename/undo/conflict checks. The synthetic menu-focus test additionally
passed twice after its readiness/focus synchronization change. Earlier failed runs
are not included in these final passes.

Logs: `/tmp/escode-41-r2-build.log`, `/tmp/escode-41-r2-smoke.log`,
`/tmp/escode-41-r2-package.log`, `/tmp/escode-41-r2-packaged.log`.
The refreshed reviewable app is `apps/desktop/release/mac-arm64/escode.app`.
Existing chunk-size, unsigned/default-icon and NO_COLOR/FORCE_COLOR warnings remain.
The prior full-suite figures remain historical; no new full host/full Electron run is
claimed for this renderer-only correction.
The refreshed package is the concrete app for review; acceptance awaits a **new full
independent reviewer (r3)**. No staging, commit, merge, push, tracker mutation or
delegation occurred. Main/other worktrees, reserved manual snapshots, ports 5173–5175
and the Desktop fixture were untouched.

## Round 3 correction and complete visible-row audit

The parent reports that independent r3 confirmed both earlier findings fixed, with
14 Electron and 15 host tests plus typecheck/lint/diff passing, and no other concrete
safety/preservation/lean findings. R3 found the remaining rename manifestation:
select folder/deep → Collapse All → enabled Rename folder/deep silently did nothing,
because beginRename searched only visible rows. The implementer audit additionally
found Enter would rename the visible focus fallback rather than the retained selection.
These are distinct from the first hidden-input finding and the second create-target
finding above. Reviewer results are reported evidence, not implementer checks or Ship.

Changes relative to r3 are `apps/desktop/src/files.tsx`,
`apps/desktop/tests/files-inline.spec.ts`, `apps/desktop/tests/files-tree.spec.ts`
and this evidence file. The tree test adds a durable project-selection/scroll
acknowledgment before its crash step, after a packaged restart timing failure; it
changes no product persistence code or expected restored result. Create and rename now
use one `beginEdit` path for entry resolution, in-flight exclusion and contextual
errors. The requested path and checkout are captured before awaiting the containing
listing. A rename derives its kind/basename from that resolved entry and uses the
existing hidden-source field fallback. It never guesses file type, silently returns
for an unavailable selected entry, or substitutes another visible path. A background
checkout's field does not take focus; it receives the existing focus behavior when
that checkout becomes active. No host mutation, recovery, persistence or dependency
changes were introduced by this round.

Audit reach (all current tree handlers and callers):

- Toolbar New File/New Folder/Rename, keyboard create/Enter, and menu create/rename
  all call `beginEdit`. Single-selection Enter uses the selected path. Keyboard
  context-menu access preserves the retained selection rather than replacing it with
  the visible fallback row; it also works with a failed root listing and no visible
  rows. An empty selection/tree offers only the existing root context. Pointer context targeting still uses the explicitly
  clicked entry; right-click inside selection preserves multiple selection. Menu and
  toolbar enablement uses selection count, edit and conflict state, not row membership.
- Toolbar/menu Trash already pass their selected/targeted path directly to the
  existing CheckoutView operation handler; they infer no type from rows. The host
  resolves/revalidates actual source identity, permissions and boundaries, confirms
  dirty descendants, and reports failure at that originating checkout. No replacement
  renderer authority or new Trash route was added.
- Arrows, range selection, type-to-select, Home/End and Cmd+A intentionally traverse
  visible rows. Space and Cmd+Down open the visible keyboard focus entry; they are
  navigation, not mutation of a retained selection. Explicit row click uses the listed
  entry. No missing row is interpreted as a file in these handlers.
- Collection/rendering, active-descendant fallback, scroll-restoration readiness and
  the inline fallback use rows only to determine visibility. Collapse changes visible
  focus/expansion while retaining selection. Refresh prunes only paths proven missing
  by directory listings; an unloaded/error listing is not proof of absence. Entry
  resolution now serves all actions needing a retained entry's type or basename.
- Checked FilesTree callbacks in CheckoutView through create-entry/file-operation IPC,
  the move journal, buffer/Monaco mapping, draft reconciliation and native boundary.
  Async completion remains bound to the component's immutable root and captured
  request path, not the latest selection or the newly active checkout.

Meaningful added Electron coverage:

- Hidden selected nested-folder rename through the toolbar, and through Shift+F10's
  context menu, including Escape/focus recovery, exact destination bytes, old-path
  absence and absence of a mistakenly renamed root entry.
- Hidden dirty-file rename through Enter while visible focus is its ancestor: text
  remains dirty, the active resource/save path changes correctly and saving writes only
  at the nested destination.
- Unavailable listing errors now exercise Rename as well as create. A failed root
  listing with zero visible rows still permits keyboard context → retained-source
  Rename via lazy loading, then Escape/focus recovery. An externally
  removed hidden source retains the attempted basename and native ENOENT error,
  permits Escape, and creates neither a replacement source nor destination.
- A deterministic async test delays consumption of the real selected-entry listing,
  changes both selection and project, then resumes. Only the originally requested
  source/checkout receives its rename field and mutation; both other paths remain
  unchanged. This is test-local Promise instrumentation restored before the delay,
  with no production hook or replacement host data. An initial strict-locator failure
  in this multi-project test was corrected to inspect the visible toolbar.

Round 3 commands:

```sh
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
bun run --cwd apps/desktop build
bun run --cwd apps/desktop test -- host/file-operations.test.ts
bun run --cwd apps/desktop smoke -- tests/files-inline.spec.ts tests/files-tree.spec.ts tests/file-operations.spec.ts
bun run --cwd apps/desktop package
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-inline.spec.ts tests/files-tree.spec.ts tests/file-operations.spec.ts
git diff --check
```

Round 3 final implementer results (2026-10-29): typecheck, lint, production build,
unsigned macOS package and diff check passed. Focused host preservation tests:
**15 passed**. Final combined focused Electron journeys: **19 passed**. Final
restricted-PATH packaged journeys: **19 passed**, including all new rename/race
cases and the synchronized durable scroll/restart check. The isolated async entry
resolution test also passed before the combined final runs. Earlier failed attempts
are not included in these final passes.

Logs: `/tmp/escode-41-r3-host.log`, `/tmp/escode-41-r3-build.log`,
`/tmp/escode-41-r3-smoke.log`, `/tmp/escode-41-r3-package.log`,
`/tmp/escode-41-r3-packaged.log`. The concrete updated app remains
`apps/desktop/release/mac-arm64/escode.app`. Existing build/package warnings remain.
No new full-suite result or independent approval is claimed. The user's bounded inline VoiceOver pass above remains accepted
for the prior app; no manual process restart or manual hidden-selection check is
claimed. Existing fields/alerts are reused, and automated focus/keyboard coverage is
recorded without requesting another human pass. Final acceptance awaits **new full
independent review r4**. All edits remain unstaged/uncommitted; there was no staging,
commit, merge, push, tracker mutation, delegation, other-worktree change, or reserved
manual snapshot/port/Desktop modification.
