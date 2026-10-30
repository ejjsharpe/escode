# Batch Trash implementation evidence

Implementation handoff for [Move selected entries to macOS Trash safely](https://github.com/ejjsharpe/escode/issues/42), against [Specification: IDE-style Files view](https://github.com/ejjsharpe/escode/issues/38). Baseline: `3ed89ca9162802cbb69cac9a89aba3ef0ba96764`, branch `t3/implement-issue-38`. This is uncommitted implementation evidence for a fresh independent review, not acceptance or issue closure.

## Behavior and boundary

`src/files.tsx` captures the retained selection before any await, including hidden descendants after Collapse All. Context-menu, Trash button and tree-only Cmd+Backspace/Delete use one batch request. The tree handler requires the tree itself as event target; Monaco, inline fields and other inputs retain their own shortcuts. Rename remains single-selection. Completion restores focus only to a visible originating tree.

`host/main.ts` validates sender, opened checkout and arguments, then resolves native source identities and actual directory types independently of visible rows. Valid selected folders prune selected descendants. One native confirmation lists absolute paths, normalized item count and affected dirty descendant paths/count. Cancel is the default. Dirty choices are Save and Move to Trash, Discard and Move to Trash, and Cancel.

Each item revalidates its originating project session, checkout/source identity and the existing protected/no-follow native boundary at execution. Save uses Project.save's existing version checks. A save conflict blocks that item's Trash and returns its disk version to the renderer's ordinary Compare/Overwrite/Reload/Cancel controls. Other independent items can complete. Resolving a conflict does not automatically delete the file; retry Trash explicitly. A failed save or Trash keeps available edits/drafts, including explicit Discard until individual native success.

The same `FileOperations.run`, durable intent and `reconcile` used by rename/move perform every deletion. Fully persisted items release the shared journal before the next item; persistence/acknowledgement failures retain an applied result and pending recovery intent. Subsequent items cannot bypass an uncertain journal. Renderer disposal and path reconciliation apply only to successful deletions/moves. Persistence, acknowledgement and refresh errors are appended without replacing per-item outcomes, and Files refresh still runs after a failed persistence/acknowledgement handoff. Results appear above the editor in a keyboard-focusable, wrapping, scrollable status region so longer batches remain readable.

No new filesystem helper, workspace layout, permanent-delete fallback, rollback or operation undo was added. The existing operation journal additionally records Save-before-Trash intents and their completed disk baselines. Native Finder Trash remains the recovery mechanism. The first gate's practical final-syscall race and best-effort recovery limits still apply; see [native and recovery evidence](file-operations.md). A crash after native Trash but before durable completion retains ambiguous drafts rather than inferring discard from absence. Explicit Save can change disk bytes even when later Trash fails; results do not promise batch rollback.

## R1 findings addressed for independent R2 review

R1 found two reproducible handoff defects: a renderer persistence/acknowledgement error could replace completed Trash outcomes and prevent Files refresh; successful internal saves could leave failed Trash buffers/drafts with the pre-save baseline, causing false conflicts on retry. Both are fixed at their shared handoffs.

The renderer now retains native per-item outcomes, reconciles them in memory, attempts durable persistence/acknowledgement, and appends any failure before refreshing Files and displaying results. This also covers the shared rename/move completion handler. A pending record is acknowledged only after the renderer's reconciled state persists successfully; failures retain available intent for recovery. Items already persisted and acknowledged by the host need no pending journal merely because a later renderer-only write fails: fresh startup uses the host's reconciled workspace.

The host returns completed saves separately from deletion outcomes and lists them in the report. `FileOperations.save` records the intended save before invoking the ordinary `Project.save` version check, persists a successful save baseline independently of deletion, then releases the existing journal. A failed handoff returns the known completed save and retains pending intent; Trash and subsequent mutations cannot bypass that record. Renderer buffers and recoverable drafts adopt each returned disk baseline using shared `reconcileSave` handling, without replacing their available text. The root remains the originating CheckoutView's root. Earlier successful descendants retain their own new baseline when a later descendant conflicts.

Restart applies a recorded completed-save baseline without substituting current external bytes. If interrupted before completion was recorded, matching intended disk text establishes the saved baseline; an unchanged original object cancels an unexecuted save intent. Other uncertain outcomes retain drafts and block mutations. This retains the existing hash-based save-conflict guarantee and best-effort recovery limits; it does not claim transactional saving or batch rollback.

## R2 navigation/crash finding addressed for independent R3 review

R2 reproduced a remaining whole-batch race: after a saved file's Trash failed and a clean sibling's Trash succeeded, a real Agents navigation could persist the old renderer baseline after the sibling's journal-clear rename completed but before its promise returned. The native item was no longer busy and its journal was null; a crash then restored a stale baseline and produced a false Save conflict. R1/R2's per-item journal and ordinary baseline tests did not establish this whole-batch handoff guarantee.

`FileOperations` now owns a bounded whole-batch handoff containing the originating root and known completed Save/Trash facts. Each fact is captured immediately when its disk outcome is known, before completion persistence or acknowledgement awaits. Clearing an individual item's journal releases that journal for the next item but does not release the batch facts. `lifecycle.persist` routes through `FileOperations.persist`: after validating the incoming workspace, it reapplies those facts **inside the serialized workspace write queue**. Stale snapshots therefore retain legitimate navigation and unrelated draft text while adopting completed disk baselines and successful removals. Snapshots never grant filesystem authority.

The host marks every fact-bearing batch as requiring renderer acknowledgement, including batches containing saves but no successful deletions. The renderer reconciles its models/memory, awaits durable persistence, then acknowledges. The host drains earlier workspace writes before releasing the batch facts. Ordinary saves, creates, moves and new batches cannot bypass that delivery interval; tree navigation and Agents remain usable and navigation persistence continues through the fact overlay. Cancelled or entirely failed batches with no completed facts release their empty handoff. Normal acknowledgement releases the protection, so later ordinary persistence and a legitimately recreated file's drafts are unaffected.

A failed persistence/acknowledgement keeps available handoff facts; native mutations retain the existing pending/restart protection. Acknowledging earlier known facts never clears a later uncertain item's journal. The batch fact list is in memory; crash recovery relies on the already corrected durable workspace plus any remaining per-item journal, not an invented atomic batch journal. This closes stale renderer snapshot regression during the supported single-renderer handoff. It does not promise cross-process transactional disk operations, survival of unacknowledged keystrokes, or operation rollback.

Two new Electron journeys pause **after** the real journal-clear rename has completed and **before** its promise returns, click the actual Agents control and inspect a fresh read of workspace JSON. Both verify the failed item's saved baseline/text, successful sibling deletion and actual Trash bytes, unrelated retained edits, and persisted Agents navigation. One uses SIGKILL and fresh-process Save (then a real external write that must conflict). The other resumes delivery, performs another Save-and-Trash batch, recreates the former path and verifies a new draft persists normally. Host regressions independently check stale snapshot correction/release and preservation of an uncertain later journal. No production timing hook was added.

## Automated checks (2026-10-29, macOS arm64)

Commands run from this worktree for R3:

- `bun run --cwd apps/desktop typecheck`: passed.
- `bun run --cwd apps/desktop lint`: passed.
- `bun run --cwd apps/desktop test`: **96 passed, 2 opt-in live skips**. Existing native race, save-conflict, recovery and migration tests remain green. Seven additional host cases cover baseline-only reconciliation with newer available text, save baseline persistence/acknowledgement failure, interrupted save before/after replacement, origin closure, and ambiguous replacement. Two R3 cases add whole-batch stale snapshot correction/release and uncertain later-item protection. Real permission-denial and missing-source retention cases remain included.
- `bun run --cwd apps/desktop build`: passed; existing large-chunk warning remains.
- `bun run --cwd apps/desktop package`: unsigned macOS arm64 app built in `apps/desktop/release/mac-arm64/escode.app`.
- `bun run --cwd apps/desktop smoke -- tests/files-trash-handoffs.spec.ts tests/file-operations.spec.ts tests/files-tree.spec.ts tests/files-inline.spec.ts tests/lifecycle.spec.ts tests/lifecycle-races.spec.ts tests/agents-files-recovery.spec.ts tests/project.spec.ts tests/accessibility.spec.ts`: **45 passed** against the final stable build.
- `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-trash-handoffs.spec.ts tests/file-operations.spec.ts`: **19 passed**, using the restricted packaged PATH against the final stable build.
- Impeccable's R1 detector over changed renderer files returned `[]`; R2/R3 add no controls or visual structure. `git diff --check` passed. The R1 rendered partial-result view was captured at `/tmp/escode-files-42-batch.png` and visually inspected; individual success/error lines remain readable above the editor.

`tests/files-trash-handoffs.spec.ts` includes the eight R1/R2 real-repository Electron journeys: host and renderer-only workspace persistence denial after native Trash success, journal acknowledgement denial, retry Save-and-Trash after native failure, ordinary Save after that failure, genuine external conflict after a completed internal save, partial folder save followed by conflict and fresh-process recovery, and a completed save whose baseline handoff fails before Trash. These inspect actual disk/Trash bytes, visible outcomes/tree refresh, durable baselines, retained text, pending protection where applicable, and automated killed-process restarts. Dialog responses and failure seams are controlled; native saves and successful Trash operations are real.

`tests/file-operations.spec.ts` covers native-dialog choices with controlled dialog responses, hidden nested selection pruning, dirty descendant plus clean/dirty independent items, native failure after successful items, durable failed draft retention, actual Trash bytes for Save and Discard, Cancel, both tree Trash shortcuts, context-menu batching, missing source and replaced root while confirmation is pending, mixed conflict plus successful deletion, ordinary Overwrite resolution, and a pending operation completed while another project is visible. Existing move tests retain Monaco URI/language/new undo, conflict baseline and automated killed-process recovery coverage. Native fixture destinations are inspected and only test-owned Trash objects are cleaned up.

During R1 development, test assertions were corrected for the newly visible conflict panel and dirty accessible tree names. A root-swap test caught refresh errors hiding per-item results; implementation now preserves those results. Final checks supersede those exploratory failures. During R2, an initial broad run hit a test-owned profile cleanup race (now retried), and a packaged restart overlapped an app rebuild and saw the temporarily absent helper. A root-swap test also timed out in that overlapping run. Stable-artifact reruns are recorded separately; those failed runs are not counted as passes. During R3, a host assertion incorrectly required an absent optional `completed` property to exist with value undefined; it was corrected to assert that the retained journal is not completed.

## Human acceptance and limits

After original Files R3 approval, the user confirmed batch VoiceOver controls after editing `batch-a.txt` unsaved, selecting it with `batch-b.txt`, invoking Cmd+Backspace, reviewing paths/dirty choices, cancelling, then choosing Discard and Move to Trash. The bounded check covered dialog announcements, results and returned tree focus. Finder Bin → Put Back restored **both original paths and original disk contents**, followed by explicit Refresh. See [the bounded manual acceptance record](https://github.com/ejjsharpe/escode/issues/42#issuecomment-6506637165). This is original Files 42 evidence, not a new combined-integration manual check. This batch record does not certify transfers. The separate [bounded transfer VoiceOver pass](https://github.com/ejjsharpe/escode/issues/43#issuecomment-6507567050) covers Copy/Paste, copied unsaved text, Keep Both and Duplicate. No manual Cut/move, process restart, live-provider concurrency or full-parent acceptance is claimed. Automated dialog responses establish application choice handling; they do not establish native VoiceOver behavior. The subsequent Files 42 integration and its exact tested bases remain recorded below.


Original Files-slice tests used isolated temporary repositories and app profiles. No live authenticated Codex turn was run. The protected first-slice/tree/inline snapshots, Desktop fixture, ports 5173–5175, other checkouts and newer main were untouched. That slice did not perform integration or tracker closure; its later approved commit and the pending combined reconciliation are recorded separately.

## Complete uncommitted file set

- `apps/desktop/host/file-operations.ts`: shared journal, Save-before-Trash and whole-batch handoff facts/acknowledgement.
- `apps/desktop/host/file-operation-state.ts`: path/removal and baseline-only reconciliation.
- `apps/desktop/host/workspace.ts`: intent validation and queued snapshot reconciliation.
- `apps/desktop/host/main.ts`: batch coordination, lifecycle persistence and mutation/delivery guards.
- `apps/desktop/host/project.ts`: typed batch request/result bridge.
- `apps/desktop/src/main.tsx`: origin-scoped model/baseline reconciliation, durable acknowledgement and honest outcomes.
- `apps/desktop/src/files.tsx`: retained selection, context menu, tree shortcuts and focus restoration.
- `apps/desktop/host/file-operations.test.ts`: real host failure, recovery and handoff regressions.
- `apps/desktop/tests/file-operations.spec.ts`: batch native/UI acceptance and fixture cleanup.
- `apps/desktop/tests/files-trash-handoffs.spec.ts`: persistence, baseline and navigation/crash handoff journeys.
- `README.md`, `GLOSSARY.md`, `docs/compatibility/files-trash.md`: behavior, vocabulary and reproducible evidence.

## Files 42 reconciliation with Agents 32–36

This pending integration uses local HEAD `f1ee9449bdecbd944046ed431296d23e833b7a0d`
and approved Files tip `812b1c547a2401984c9b9f2fc425eede76fa15e8`.
The automatic merge retained an obsolete `closingProjects` reference in batch
Trash origin validation. Agents 32 deliberately removed that editor-close
revocation policy. The reconciliation removes that reference and describes an
invalid origin as unavailable or quitting. It retains the captured project-session
owner, exact cached Project instance, native checkout/source identity checks,
protected-path checks and validation immediately before Save/Trash. Closing an
editor does not revoke a valid retained session. Authorized app quit still denies
pending mutations and shuts down retained chat processes.

Four added Electron cases hold a two-item batch at native confirmation, navigate
to another real project, and assert the original checkout remains the target.
They cover actual clean-editor UI closure; the retained host editor-finish
contract with dirty work; replaced-root rejection; and authorized quit rejection.
The dirty case verifies successful Save bytes in native Trash, removal of only
successful drafts, and unrelated dirty text and its original disk baseline.
Rejected cases retain dirty text/baselines and leave original/replacement files
and the other checkout untouched. The quit probe holds `app.quit` after the real
lifecycle finish handler so its pending IPC result can be observed; the existing
lifecycle tests exercise actual shutdown of active processes from closed editors.
The dirty retained case invokes host editor finish directly; ordinary UI closure
still resolves dirty files and refuses closure during its own renderer file action.

No new product concepts or application behavior beyond this reconciliation are
introduced. The existing completed-save, failed-Trash, external-conflict,
whole-batch navigation/journal-clear/SIGKILL, continuation/recreated-path and
uncertain-journal guards remain in place. Tests use unique temporary repositories
and user-data profiles. No reserved manual window, port or Desktop fixture is used.

Combined integration verification:

- Pinned Bun 1.4.4: `bun install --frozen-lockfile` passed without lockfile changes.
  Initial checks could not start without dependencies; the default Bun 1.3.14
  rejected lockfile version 2. The installed Vite Plus Bun 1.4.4 resolved this.
- From the integration root: `bun run typecheck`, `bun run lint`, `bun run test`,
  `bun run build`, and `bun run package` passed. Nx reported successful full
  host-suite completion; its captured summary did not print individual test counts.
- From `apps/desktop`: `bun run smoke` passed **72 tests, 1 opt-in live skip**.
  This includes real retained-process shutdown, migration/recovery, Agents drafts,
  scratch/worktree execution fixtures, tree/inline operations and packaged launch.
- The first focused run passed 13 of 14 cases; the new clean-editor case issued
  IPC before native project opening completed. A repeat started before the test
  edit had landed and reproduced that failure. Waiting for the actual Files row
  fixed this test setup race; all four new cases and the full suite then passed.
- No new combined manual VoiceOver, Finder Put Back, manual restart or live
  authenticated Codex evidence is claimed. Dialog/failure seams are controlled;
  filesystem saves/Trash and automated killed-process recovery are real. The
  practical syscall race and best-effort recovery limits remain unchanged.
- Restricted-PATH packaged verification passed **26 tests** using the freshly
  built unsigned macOS arm64 app:
  `ESCODE_PACKAGED=1 bun run smoke -- tests/files-trash-handoffs.spec.ts tests/lifecycle.spec.ts tests/lifecycle-races.spec.ts tests/retained-project.spec.ts tests/agents-files-recovery.spec.ts tests/concurrency.spec.ts tests/chat-recovery.spec.ts tests/worktree-drafts.spec.ts`
  from `apps/desktop`. No rebuild ran concurrently with these tests.
- `git diff --check` and staged whitespace checks passed. The reconciliation is
  staged for a new full independent review; HEAD and MERGE_HEAD are preserved.
  No commit, merge completion, push, PR, tracker mutation or main write was made.

## Updated reconciliation on the Agents 37 base

The new dedicated pending integration is
`/private/tmp/escode-files-42-integration-0347eaf`, branch
`integrate/files-42-agents37`, HEAD
`0347eaf4abe355a598752dff63bb72320e425570`, with MERGE_HEAD still exactly
`812b1c547a2401984c9b9f2fc425eede76fa15e8`. The earlier reconciliation and
verification above belong to the prior `f1ee944` base; they are not substituted
for checks on this newer base.

The three resolution files were read from the old dedicated checkout and checked
byte-for-byte against its reviewed-candidate tree
`d3980bb614327fe8f6231c06f3d282b771abce2d` before copying. That checkout remains
a read-only donor. Host code and all four pending two-item regressions are unchanged
from that candidate; this evidence file additionally records the newer run.

All nine Agents 37 base paths were accounted for: `README.md` and `GLOSSARY.md`
retain their integrated-evidence links/manual-gate statements alongside the Files
42 additions; `host/chat.test.ts`, `tests/accessibility.spec.ts`,
`tests/availability.spec.ts`, `tests/chat.spec.ts`, `tests/lifecycle.spec.ts`,
`tests/retained-project.spec.ts` and `docs/compatibility/agents-acceptance.md`
retain the exact committed Agents 37 contents. No application-source delta exists
between the old and new base. No acceptance assertions or unrelated documentation
were replaced.

The retained owner/session and cached Project checks still bind each batch to its
origin; native checkout/source identities are checked before each Save/Trash,
including after asynchronous journal writes. Editor finish retains authority;
actual quit marks the host as quitting and shuts down all owned chat contexts.
The renderer still resolves dirty closure choices and blocks its own closure
while a file action is active. Completed Save/Trash facts still overlay queued
workspace snapshots through durable renderer acknowledgement, without clearing
an uncertain later journal or overwriting unrelated navigation/text. Agents 37's
mixed request/Stop and project/scratch quit assertions exercise the same unchanged
runtime with the Files 42 preservation and handoff regressions.

New-base environment: macOS 26.3.1 (25D2128), arm64, Bun 1.4.4, Node v26.13.0;
locked Electron 45.1.0, TypeScript 7.0.2 and Playwright 1.64.1. Frozen installation
passed (468 packages; no manifest/lockfile changes). Direct desktop typecheck and
lint passed. The direct uncached host suite with `ESCODE_LIVE_CHAT=0` passed
**126 tests, four opt-in live skips; 13 files passed, one skipped**. These are
new-base controlled/native test results, not a new installed-provider claim.

Build/package precede Electron runs. The full Electron development/HMR test uses
a private ephemeral port and temporarily changes the source color token, restoring
it in `finally`; its source hash is checked afterward. No build or other test run
is overlapped with that full suite. Reserved ports 5173–5176, manual snapshots and
Desktop fixtures are untouched; test repositories and profiles are isolated.

The newer run's direct commands (from the new integration root) are:

```sh
bun install --frozen-lockfile
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
ESCODE_LIVE_CHAT=0 bun run --cwd apps/desktop test
bun run --cwd apps/desktop build
bun run --cwd apps/desktop package
ESCODE_LIVE_CHAT=0 ESCODE_PACKAGED=0 bun run --cwd apps/desktop smoke
```

Bun commands above used the available pinned executable
`/Users/elliotsharpe/.local/share/vite-plus/bin/bun`. Build and package passed;
large-chunk, missing package description/author, default-icon and explicitly
unsigned-package notices remain. Signing and notarization were not tested.
The HMR case passed but logged React's repeated-`createRoot` development warning;
no HMR behavior was changed in this resolution. The renderer source hash after
HMR is still `96877b7829fb4296a2478c395b1fdae875550e51`, matching its pre-run
contents. No new-base setup or test failure has required a code/test correction.

The full new-base Electron suite passed **72 tests, two opt-in live skips**
(74 discovered), including the unchanged four reconciliation regressions and all
Agents 37 non-live assertions. It also exercised the existing packaged launch and
editor workflows. HMR restoration was verified again after full-suite completion;
only the three deliberate resolution files differ from the initial pending merge.

The fresh unsigned app also passed **32 restricted-PATH packaged tests**, with
no failures or skips, using:

```sh
ESCODE_LIVE_CHAT=0 ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-trash-handoffs.spec.ts tests/lifecycle.spec.ts tests/lifecycle-races.spec.ts tests/retained-project.spec.ts tests/agents-files-recovery.spec.ts tests/concurrency.spec.ts tests/chat-recovery.spec.ts tests/worktree-drafts.spec.ts tests/accessibility.spec.ts tests/availability.spec.ts
```

This includes the new base's expanded keyboard, acknowledged unavailable-checkout
checkpoint, mixed project/scratch request routing, retained editor and quit
assertions, together with all batch handoff cases. No new-base check failed.
Final whitespace checks pass. All seven non-overlapping Agents 37 test/evidence
files still match HEAD exactly; the README/glossary retain both amendments.
The donor's three files still match its original candidate tree. Only the three
resolution files are newly staged atop the existing pending 13-path merge.
HEAD/MERGE_HEAD and local main remain unchanged; no commit, merge completion,
push, PR, tracker mutation, main write, delegation or active Files 43 import was
performed. The old donor was not written to.

This is implementation readiness for a NEW full independent review, not that
review's result or a new acceptance claim. No new manual VoiceOver, Finder Put
Back, manual restart, live-provider, signing or notarization validation occurred.
The original bounded Files 42 user pass linked above remains the manual evidence.
Existing final-syscall races, explicit-save conflict policy, best-effort recovery
and nontransactional batch limits are unchanged. Other checkouts, reserved manual
snapshots/ports and Desktop fixtures were not used.

## Current Files 43 integration context

Files 42 is already integrated in actual main at `e0b66346ed8e7464011c08bfac78319adc0609e1`, including the accepted Agents evidence and all Files 42 delivery/acknowledgement fixes. The pending Files 42 merge descriptions above are historical records of that completed integration, not its current status. Files 43 is now being reconciled against that exact main commit in a dedicated checkout; see [transfer integration evidence](files-transfer.md#integration-with-accepted-agents-and-files-42). The original batch manual evidence remains bounded to the journey above; this reconciliation adds no new batch manual acceptance.

## Authenticated host Trash replacement — issue 81 (2026-10-30)

Batch Trash now enters through the validated `trashEntries` Files RPC on the
shared authenticated host connection. The former `trash-selection` project IPC
route rejects requests. Desktop still supplies native confirmation and native
Trash; no permanent-delete fallback exists. The existing journal, completed-save
baselines, batch facts and renderer acknowledgement preserve partial outcomes and
block uncertain retries. The host captures checkout identity before confirmation
and revalidates it and the originating session before effects. Selection and dirty
descendant capture, descendant pruning, Save/Discard/Cancel and success-only buffer
retirement retain their existing behavior. After integration with issue 80, operation acknowledgement also uses the
authenticated host RPC shared with rename/move.

Native confirmation has no ordinary query deadline: a user can take more than
35 seconds to decide without losing the result channel. Queue admission remains
bounded. Socket loss does not redispatch Trash; retained journal/batch evidence
continues to guard further mutations and restart reconciliation.

Verification on macOS 26.3.1, Apple Git 2.50.1, Codex 0.163.0, Bun 1.4.4 and
Electron 45.1.0 (embedded Node 24.22.1): typecheck, lint, build and unsigned packaging
pass. Focused host Files transport, operation-preservation and native race tests
pass (59 tests); the reconnect suite passes (4 tests), including a real 36-second
confirmation delay beyond the normal deadline. Added transport coverage rejects
empty/non-string selections before dispatch and preserves partial results, saved
baselines and operation identities. Handoff fixtures now recognize the fresh-state
owned empty-journal envelope when asserting and injecting acknowledgement failures.

The toolbar/context menu, keyboard handling, native confirmation choices and focus
behavior are unchanged. Automated results do not add manual VoiceOver, Finder Put
Back, signing/notarization, live-provider, exhaustive multi-client or capacity
acceptance. Existing manual exclusions and filesystem final-syscall race limits
remain in force. No legacy state is imported or deleted.

Final qualification: the full unit suite, typecheck and lint pass; build/package
pass. All nine packaged `file-operations.spec.ts` cases pass and all fourteen
packaged `files-trash-handoffs.spec.ts` cases pass, including fresh-process recovery,
failed Save, partial success, late snapshots, checkout replacement and Quit. Crash
fixtures explicitly release their own confirmed-dead host lock and use the process
PID instead of the removed Playwright process accessor. Quit fixtures accept the
expected closed-session recovery rejection while asserting no stale Trash effect.
Standards review found no actionable findings; specification review identified the
confirmation deadline and evidence gaps, both addressed.

Integration with main at `0bda668` passed typecheck, lint, build and package.
The seven focused packaged integration cases passed across the initial run and
an isolated Save rerun: the initial Save assertion exceeded its five-second UI
wait while still applying, then passed alone in 3.4 seconds. A concurrent full
unit run had one unchanged shutdown descendant-start timeout (207 passed,
4 skipped); this was investigated separately from Trash behavior.
The final full-suite rerun passed: 208 tests passed, 4 opt-in tests skipped
(22 test files passed, 1 skipped). No shutdown code or timing limits were changed.
After the final rebase onto create-entry delivery at `b8bed72`, typecheck, lint,
build and package pass again. The combined transport, operation and reconnect
suites pass (51 tests); packaged restart recovery after native success and ordinary
Save after failed Trash both pass (2 cases). The earlier full-suite result remains
bounded to the preceding integrated tree; this final rebase was checked at the
shared transport and preservation boundaries.
