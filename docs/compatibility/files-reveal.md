# Files reveal and ignored visibility (#46)

Implementation evidence on branch `t3/implement-issue-38`, based only on
`1e2a9330e29daabbc1fc08e0832036c5a0da2ab8`. This is independent ticket evidence,
not acceptance of parent #38, native #45 integration or automatic watching (#47).
The sections below retain the original feature-check evidence; the pending integration
against the accepted Agents and native-import baseline is recorded at the end.

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

Native Finder display remains a separate functional check for the parent. Remaining
actual screen-reader checks are **USER-DEFERRED** by explicit instruction; they are
neither passed nor a blocker. Earlier bounded manual passes remain historical. The automated Finder check intercepts `shell.showItemInFolder` to
verify its requested target; it establishes no operating-system effect. No live Codex run,
manual app restart, signing, tracker changes, commit, push, PR or main integration occurred.
Restart evidence uses fresh Electron processes and persisted temporary workspace state.
Packaging is unsigned by the existing configuration. The build retains its existing large
chunk warning. Ignore checks share the existing synchronous host helper; this slice adds
neither background Git workers nor deep scans. Outside-app path changes after final
validation remain the existing practical filesystem race boundary.

Ready for fresh independent full Ponytail review. Native functional and full-parent
acceptance evidence is separate; the user has deferred the remaining VoiceOver checks. The initial 61-case regression run's two failures were fixture assumptions;
the corrected drag and inline suites passed in the focused reruns listed above. No remaining
failure is being waived.


## Pending integration against accepted Agents and Files import

Dedicated checkout: `/private/tmp/escode-files-46-integration-823c775`, branch
`integrate/files-46`. HEAD remains `823c775c87a88f788a3869ac188006e91b3741cc`;
MERGE_HEAD remains original feature `c97a38bff051b8c5626d730cb1f5f0a4bdb1cb54`.
The merge remains pending, with neither parent replaced and no commit/push/tracker write.

Deliberate resolutions beyond the textually clean merge:

- `host/main.ts`: replace the obsolete editor-close veto with retained saved-session
  ownership, exact cached Project, root identity and quit validation; revalidate after
  the asynchronous filtered listing. Closing an editor retains authority and live chats.
- `src/files.tsx`: defer selection-driven reveal until the tree is active and file
  operations enable it. The initial combined Electron run exposed a real timing race:
  moved-active-file reveal started while disabled and was cancelled when the operation
  released its guard, leaving the new parent collapsed. The existing drag journey
  exercises this behavior without weakening its expansion, disk, draft or Monaco checks.
- `tests/files-reveal.spec.ts`: four real-IPC journeys hold checkout authorization across
  clean editor closure, retained dirty editor/navigation, root replacement and quit.
  Assert captured context targets (different from the active ignored editor), filter
  results/denials, persisted preference/draft baselines, unchanged originals and the
  other checkout's bytes. Finder is intercepted; no native Finder effect is claimed.
- `host/project.test.ts`: real Git verifies tracked children keep an ignored parent
  visible without deep enumeration.
- `host/workspace.test.ts`: closed-editor restart retains hide-ignored memory alongside
  catalogue, approvals and recovery drafts.
- `host/file-operations.test.ts`: preference survives copied-draft recovery and batch
  Trash/save facts, stale-navigation persistence and durable acknowledgement, alongside
  the feature's move/recovery preference checks.
- This evidence file records the combined results and current manual-check status.

Connected inspection covered all sixteen auto-merged paths plus lifecycle/session and
checkout authority, typed preload IPC, native imports, pre-Replace source validation,
staging/publication, copied-model reconciliation, batch facts/delivery/acknowledgement,
workspace migration and Monaco path rebinding. The accepted Agents README/glossary status
and prior Files capabilities remain intact. No watcher or issue-47 content is included.

Initial setup failures: dependencies were absent, so the first typecheck could not find
Node/Vite types. System Bun 1.3.14 could not parse lockfile version 2. Installing pinned
Bun 1.4.4 under this checkout and running frozen install resolved setup without changing
the lockfile. A new test initially needed a string-result type narrowing; corrected before
Electron execution. The initial combined run's drag assertion failure is described above;
it was not waived as a fixture failure.

Remaining actual VoiceOver checks: **USER-DEFERRED**, neither passed nor a blocker,
per the user's explicit instruction. Prior bounded manual passes remain historical.
Actual native Finder reveal is a separate functional check for the parent. No OS-global
input, manual snapshots/ports, Desktop fixtures, main checkout or active issue-47 source
was intentionally operated. No authenticated live-provider, signing, manual restart,
transactional-operation or full-parent acceptance claims are made. Best-effort recovery
and final-validation-to-OS-effect races retain their existing limitations.


### Combined verification commands and results

Use the checkout-local Bun 1.4.4 on PATH (the system Bun is older). Run from the
integration checkout, with `--cwd apps/desktop` for every command below:

- `bun run --cwd apps/desktop test`: final complete host suite **149 passed / 4 live
  skips**, 14 test files passed and one live-only file skipped. Earlier full run also
  passed 149/4. Final focused Git/workspace run: **23 passed**; preservation/workspace
  run after preference assertions: **35 passed**.
- `bun run --cwd apps/desktop typecheck` and `bun run --cwd apps/desktop lint`:
  passed on final application/test source. Working and staged whitespace checks pass.
- `bun run --cwd apps/desktop build` and `bun run --cwd apps/desktop package`:
  fresh final build and unsigned macOS arm64 package passed; existing large renderer
  chunk warning and explicitly disabled signing remain disclosed.
- `bun run --cwd apps/desktop smoke -- tests/files-drag.spec.ts tests/files-reveal.spec.ts`:
  **14 passed** after the reveal timing fix, including the previously failing drag.
- `bun run --cwd apps/desktop smoke -- tests/navigation.spec.ts tests/accessibility.spec.ts tests/file-operations.spec.ts tests/files-tree.spec.ts tests/files-inline.spec.ts tests/files-trash-handoffs.spec.ts tests/files-transfer.spec.ts tests/files-import.spec.ts tests/retained-project.spec.ts tests/agents-files-recovery.spec.ts tests/lifecycle.spec.ts tests/lifecycle-races.spec.ts tests/concurrency.spec.ts`:
  **72 passed** on final build. Together these establish **86 final built workflows**.
  Initial combined run before the reveal fix: **85 passed / 1 failed** (the drag
  expansion assertion above). Initial reveal-only run: **5 passed**.

Final built generated fixtures measured 500 MiB / 8,000 files: native import **3,411 ms**,
fixture protocol Stop **2 ms**; internal copy **4,163 ms**, fixture Stop **1 ms**. Both
asserted navigation during copying and actual bytes. These are bounded local fixture
measurements, not live-provider concurrency or general performance guarantees.

Build/native test jobs ran sequentially in this integration checkout. The parent requested
a 90-second clipboard quiet window during native acceptance; the already-running suite
finished, then new Electron/clipboard tests were held until that window elapsed. A shared
clipboard observation from the parent's separate session was not treated as a product bug
or used to change source. Native Finder effect evidence remains with the parent.


- `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/packaged.spec.ts tests/files-reveal.spec.ts tests/files-drag.spec.ts tests/files-import.spec.ts tests/files-transfer.spec.ts tests/files-trash-handoffs.spec.ts tests/file-operations.spec.ts tests/navigation.spec.ts tests/accessibility.spec.ts tests/retained-project.spec.ts tests/agents-files-recovery.spec.ts`:
  **64 passed** against the final unsigned package. The launch helper restricts the app
  PATH to `/usr/bin:/bin` plus any explicit fixture tools. Corrected drag reveal, all four
  new context authority cases, native import, transfer models, protected paths, batch
  recovery/acknowledgement, navigation, accessibility and retained-editor checks passed.
  Host bundle, renderer bundle and packaged `app.asar` were verified newer than final
  product sources. Final package fixture timings: see the retained execution log.

Final local and remote main still matched the supplied HEAD when checked; no base update
was merged. Raw command logs and the final sixteen-path hash manifest are retained under
`node_modules/.cache/escode-files-46-integration/` in this dedicated checkout. All sixteen
merge paths are staged; only the seven deliberate resolution paths listed above differ
from the original automatic merge. No unmerged index entries remain, and the worktree
matches the staged files. No commit, merge completion, push, PR or tracker write occurred.

**Ready for NEW fresh FULL Ponytail integration review.** No independent integration
review is claimed here. Remaining actual screen-reader work is USER-DEFERRED, not passed
and not a blocker; actual Finder reveal remains a separate native functional observation.
