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

The new batch controls and native batch confirmation have **not** received human VoiceOver acceptance, Finder Put Back verification or a manual process restart in this slice. Prior first-gate Put Back/VoiceOver and tree/inline VoiceOver approvals do not certify these new controls. Automated dialog responses establish application choice handling, not native dialog reading/focus behavior under VoiceOver. The parent owns those new manual acceptance checks after fresh review.

Tests use isolated temporary repositories and app profiles. No live authenticated Codex turn was run. The protected first-slice/tree/inline snapshots, Desktop fixture, ports 5173–5175, other checkouts and newer main were untouched. No staging, commits, merge, push, PR, tracker write or issue closure occurred.

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
