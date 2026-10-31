# SQLite first-Send preparation (#120)

Worktree and No project scratch reservations continue to use the #118 SQLite chat transaction before external allocation. Reservation now compares the saved context inside the serialized transaction: stale or competing preparation cannot overwrite a changed checkout, worktree choice, provider identity or existing reservation. The resource path, branch and selected committed base remain fixed.

Returned directory/provider identities are recorded in a bounded preparation-result record in the same SQLite authority before updating the chat. A successful chat transaction removes the matching result atomically. If that transaction fails, reopen reconciles the exact previous/result records and revision before publishing the store; divergent context fails closed. Reconciliation changes metadata only, never allocates resources or submits a prompt. Schema 3 adds this table to the existing store without changing established host/client identities or importing legacy data. No new product concept, dependency or client transport was introduced.

The provider/Git/filesystem effect remains outside SQLite. If storage fails before an observed result can itself be recorded, the pre-effect reservation/creating state still prevents replacement; no storage design can durably retain newly returned bytes while all persistence is unavailable. WAL NORMAL retains the accepted OS-crash/power-loss limit.

## Verification

TDD reproduced a stale scratch context being overwritten and a returned provider identity being lost after a real SQLite chat-write failure. Both regressions now pass.

Authenticated first-Send fixtures use real on-disk SQLite with trigger failures before scratch reservation, after directory allocation and after provider creation. Reopen retains the exact reservation and recovered observed identities, preserves the prompt, introduces no Git in scratch, and submits zero turns. Immutable command retry remains uncertain without redispatch.

Subprocess fixtures perform authenticated first Send into real scratch folders and real Git managed worktrees. After the deterministic provider appends an external turn-effect record, SIGKILL terminates the process. Reopening retains directory/provider identity; recovered status, duplicate command and stale-epoch rejection leave exactly one effect. The worktree starts at the recorded base with committed contents and preserves the source's changed disk contents. Existing worktree tests preserve the source index, tracked/staged/untracked/ignored bytes and preparation Stop behavior. Worktree and scratch ownership-write fixtures now use actual SQLite errors instead of mocked chat writes.

No live Codex turns, human accessibility/native checks or physical power-loss tests were performed. Deterministic providers establish injected-failure behavior, not installed-provider compatibility. No UI controls changed.

## Final integration qualification (2026-10-31)

Started in the clean isolated worktree at `ac9509e`, with accepted `0a9c981` as an ancestor. Merged integration `dfac940` (#121) and then `2fc88c1` (#122); resolved the shared worker handler by retaining both preparation-result and client-recovery operations. A final merge reported already up to date. No issue was closed, PR created or change merged into the integration branch.

- Final full host suite: **320 passed, four skipped**, 37 files passed and one skipped. The skips include opt-in live-provider qualification.
- Final typecheck and lint pass. Build and unsigned macOS arm64 package pass.
- `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/durable-state.spec.ts tests/scratch.spec.ts tests/worktree-drafts.spec.ts tests/send.spec.ts`: **five passed**, including actual packaged SQLite worker startup, first-Send resource preparation, independent scratch folders without Git, retained composer/file contents, durable Send and restart identities.
- Packaged scratch testing exposed a related first-Send reopening regression: while provider acceptance awaited approval, navigation/history tried to acquire Send's context lock and hid live control. A failing host regression reproduced both open and history paths. They now read the already-connected session while its original context transition holds identity stable; they cannot start a substitute connection or turn. The host regression and packaged scratch workflow pass.
- Intermediate verification failures are retained here: the first scratch UI runs failed on the missing approval control before this repair; an added fixture initially terminated a not-yet-ready worker, fixed by awaiting readiness before cleanup. One concurrent focused worktree run failed before reservation, while its isolated rerun and final full suite passed. Final runs above have no unhandled errors.

All five #120 criteria have deterministic coverage. Live installed Codex/native-human qualification remains unperformed; the accepted WAL NORMAL and external-effect limits still apply. Retained preparation results are metadata evidence, not provider transcript backups or automatic recovery of external effects.
