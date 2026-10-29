# Files reveal and ignored visibility (#46)

Implementation evidence on branch `t3/implement-issue-38`, based only on
`1e2a9330e29daabbc1fc08e0832036c5a0da2ab8`. This is independent ticket evidence,
not acceptance of parent #38, native #45 integration or automatic watching (#47).
All changes remain unstaged and uncommitted for independent review.

## Behavior and boundary

Reveal Active File loads only its ancestor listings, expands them and scrolls to the row.
An actual active-path change can reveal automatically without focusing the tree; initial
mount, refresh and restart do not override remembered collapse. Manual collapse cancels a
pending reveal. Responses are scoped to the originating checkout, active file, tree cache
revision and presentation generation. Show ignored files is offered when an ancestor or
file is hidden; accepting it restores focus to Reveal Active File.

Unfiltered listings remain cached. Hide Git-ignored files starts off, is remembered per
checkout and does not remove editor buffers, drafts or remembered selection/expansion.
The optional boolean survives legacy migration, filesystem-operation mapping and crash
reconciliation. Loaded visible directories use one `git check-ignore -z --stdin` call per
listing, with NUL-delimited filenames and Git's normal tracked-file semantics. Exit 1
means no matches; other Git failures retain all entries, leave the requested toggle state
accessible and explain that filtering is unavailable. Refresh retries. A failure in any
loaded directory makes all cached entries visible. Collapsed directories are not scanned.

Copy Path, Copy Relative Path and Reveal in Finder use the context entry, independently
of active editor and batch selection. Empty-space context uses the checkout root (relative
path `.`). Typed project IPC retains sender/frame checks and requires an open approved
checkout and live project session. Entry paths use the existing canonical/no-follow native
identity boundary; protected app state and `.git` remain unavailable. These actions do not
change the file-operation journal, clipboard transfer authority or editor model identity.

## Reproducible checks

Platform: macOS 26.3.1, Darwin 25.3.0 arm64; Bun 1.4.4; Electron 45.1.0.

- `bun run typecheck`, `bun run lint`, `bun run test`: passed; full host suite
  119 passed / 2 intentionally skipped (live Codex gates).
- `bun run --cwd apps/desktop build` and `bun run --cwd apps/desktop package`.
- `bun run --cwd apps/desktop test -- host/project.test.ts host/file-operations.test.ts`:
  50 passed, including real Git filename/ignore cases, one-call batching for 2,002 root
  entries, canonical paths, no-follow ancestry and replaced checkout roots. The existing
  move/restart cases now assert retained hide-ignored preference.
- `bun run --cwd apps/desktop test -- host/workspace.test.ts host/file-operations.test.ts`:
  34 passed, including fresh-store preference/draft/approval preservation.
- `bun run --cwd apps/desktop smoke -- tests/files-tree.spec.ts tests/navigation.spec.ts tests/accessibility.spec.ts tests/file-operations.spec.ts tests/files-inline.spec.ts tests/files-trash-handoffs.spec.ts tests/files-transfer.spec.ts tests/files-drag.spec.ts tests/files-import.spec.ts`:
  initial run 59 passed, two fixture expectations updated: drag now expects the moved
  active file's ancestors expanded, and the inline origin-race interceptor consumes the
  listing envelope rather than the former entry array. Each affected suite was rerun.
- `bun run --cwd apps/desktop smoke -- tests/files-reveal.spec.ts tests/navigation.spec.ts tests/files-drag.spec.ts tests/file-operations.spec.ts`:
  navigation, drag and operation suites passed (19 cases); reveal focus coverage exposed
  a missing ref attachment, fixed and rerun in the commands below.
- `bun run --cwd apps/desktop smoke -- tests/files-reveal.spec.ts tests/files-inline.spec.ts`:
  15 passed after the ref and listing-fixture fixes.
- `bun run --cwd apps/desktop smoke -- tests/files-reveal.spec.ts` and
  `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/packaged.spec.ts tests/files-reveal.spec.ts`:
  1 unpackaged / 2 packaged passed. The final reveal journey includes scroll into viewport, collapse across refresh/restart,
  ignored dirty text retention, Show ignored files and focus restoration, actual context
  path clipboard values, root context, requested Finder target, Git failure/recovery,
  per-project preference isolation and a held real response released after file selection
  changes. Navigation additionally checks independent original/linked-checkout preferences.

A separate real temporary-root measurement returned 2,002 entries and 1,000 ignored
matches in 47 ms (listing plus ignore batch, one local run; not a performance guarantee).
The existing generated copy/import regressions also passed: 500 MiB / 8,000 binary files,
native copy 5,330 / 4,236 ms and concurrent protocol Stop 3 / 2 ms in this run.
No virtualization or watcher subsystem was added.

Visual inspection used the Electron screenshot `apps/desktop/test-results/files-reveal.png`.
The existing palette/layout is retained; the toggle exposes pressed state visually and to
assistive technology, errors/reveal feedback use live status, and menus retain keyboard
navigation. Impeccable's detector returned no findings on the changed tree component.

## Limits and handoff

Native Finder display and manual VoiceOver remain for the parent after independent review
and a reviewable app. The automated Finder check intercepts `shell.showItemInFolder` to
verify its requested target; it establishes no operating-system effect. No live Codex run,
manual app restart, signing, tracker changes, commit, push, PR or main integration occurred.
Restart evidence uses fresh Electron processes and persisted temporary workspace state.
Packaging is unsigned by the existing configuration. The build retains its existing large
chunk warning. Ignore checks share the existing synchronous host helper; this slice adds
neither background Git workers nor deep scans. Outside-app path changes after final
validation remain the existing practical filesystem race boundary.

Ready for fresh independent full Ponytail review. Native and full-parent acceptance are
separate gates. The initial 61-case regression run's two failures were fixture assumptions;
the corrected drag and inline suites passed in the focused reruns listed above. No remaining
failure is being waived.
