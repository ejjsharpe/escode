# Combined historical qualification (#141)

Qualification remains open for the user-owned manual gates. This record does not
accept or close #117 or #141. The partial handoff ledger is retained below; the
internal-gap follow-up records subsequent repairs and final qualification.
Isolated branch `t3/issue-141-durable-state`, worktree
`/Users/elliotsharpe/.t3/worktrees/escode/t3-48868b2b`, starts at integration
`79f3f6ea84c03efbafc0c9ad9a62113ae919ee87`; `0a9c981` remains an ancestor.
Integration was merged before handoff (already up to date). No PR, issue closure
or merge into integration is authorized or performed. Scope is standalone #117,
with no map work. GitHub #117/#141, README, glossary, tracker, accepted local spec,
ADR 0003 and the preceding slice evidence were consulted. Existing accepted
host/client, real SQLite/Git and packaged Electron seams apply. TDD, Ponytail and
Impeccable instructions were consulted; no visual redesign is included.

## Actual installed provider

Codex `0.166.0` was located at `/Users/elliotsharpe/.bun/bin/codex`.
Its generated experimental JSON schema declares inclusive `lastTurnId` on
`thread/fork`. The executable was exercised, rather than treating that declaration
or deterministic protocol fixtures as runtime evidence.

Run `node apps/desktop/scripts/qualify-historical-provider.mjs` explicitly. This
creates two paid turns with read-only sandbox and never approval in a temporary
fixture directory, then creates historical provider forks without sending turns
on those forks. It does not inspect personal conversations. Fixture provider
threads are retained in provider-owned storage; temporary working files are removed.

Executed twice. The strengthened final run compared complete persisted turn bodies:
source retained two completed turns; fork through the first retained exactly the
first turn (the context before the second message), excluding the later turn;
fork through the second retained both turns. Reading the source again returned
unchanged bodies. Reading an invented missing thread rejected explicitly.
The forks started no agent turn. This establishes persisted native context
selection at these two boundaries, not model-semantic recall of every hidden tool
state or compatibility with every provider/version. No original user history was
modified. Deterministic UI fixtures remain distinct from these live-provider results.

## Parent acceptance mapping

| #117 stories | Evidence and scope |
| --- | --- |
| 1–10 | SQLite drafts/Send/controls/creation-transfers/file-recovery records; real worker host suite; packaged durable-state and checkpoint restart. Client ownership, identity and immutable receipts remain host-owned. |
| 11–20 | Before/completion checkpoints, boundary/file inspection and packaged history navigation/files/expiry. Fresh manual saves, staging preservation, exclusions and unavailable coverage are asserted at real SQLite/Git seams. |
| 21–27 | Conversation rewind and protected restoration records; packaged navigation and restoration including dirty-buffer/conflict comparison. Original/shared and No project refusal remain host assertions. |
| 28–36 | Before/after branching and explicit summary UI modes; real Git/SQLite authenticated boundary tests cover source/index preservation, exact reservations, partial outcomes, SIGKILL and no replay; actual provider probe above independently checks context selection. |
| 37–38 | No project inspection/rewind and explicit unavailable file coverage in packaged navigation and authenticated boundary tests; scratch folders remain Git-free. |
| 39–48 | Retention/expiry host tests plus packaged settings/Never/restart and expiry UI; branch/recovery/uncertain dependencies protected. No worktree/conversation deletion. |
| 49–51 | Capacity/exhaustion and durable Send/control host tests; packaged storage faults and worker-loss Stop. The partial superseded-target disclosure failure and its repair are recorded below. |
| 52–55 | Packaged effective settings, recovery-copy/checkpoint-recovery-copy tests and packaged copy/recover/reconcile. Original files/store retained; provider/Git remain external dependencies. |
| 56 | Current baseline and checkpoint-load measurements below; bounded local samples only. |

This mapping combines the predecessor records with current runs; it does not
claim every story was exercised as one uninterrupted live-provider UI journey.
The final combined packaged suite uses real Electron/SQLite/Git and deterministic
provider subprocesses. The partial handoff lacked a combined live-provider UI/recovery journey. The
follow-up below records the actual installed-provider UI/restart/recovery journey;
the complex rewind/branch/restoration UI choices remain covered by deterministic
provider fixtures, separately from the real native-context probe.

## Measurements and limits

Current packaged readback: `journalMode=wal`, `synchronous=1` (NORMAL),
`checkpointFullfsync=1`. One hundred 4 KiB recovery writes: median 0.142084 ms,
p95 0.233166 ms, max 0.971959 ms; database/WAL/SHM aggregate grew
114,936 → 551,656 bytes. These are local observations, not a speedup claim.

Baseline editing 128.79 / 70.85 ms; renderer Save 580.7 / 239.9 ms;
outer automation/disk verification Save 1129.34 / 365.05 ms.
Checkpoint-load editing 134.67 / 79.94 ms; renderer Save 942.0 / 448.6 ms;
outer Save 1505.81 / 496.33 ms. Single app worker fill/reclaim cycles admitted
47 one-MiB payloads in 2.55–2.84 seconds; main-file observations
46,268,416 → 49,545,216 bytes, with WAL zero at successful cleanup observations.
Slowest recorded cleanup in the editing load run was 170.10 ms, recoveryRead
95.15 ms. Baseline Send 384.8–397.2 ms, Stop 118.3–118.7 ms, emergency
control 51.5–55.4 ms; worker-loss emergency control 43.8 ms.
The loaded emergency-control attempt failed before a cancellation measurement;
it supplies no loaded-control pass. Shared-machine concurrent tests affect samples.

Selected operational bounds remain 10,000 paths, 8 MiB raw captured bytes,
4 MiB Git output and 15-second capture/subprocess deadlines; two concurrent
captures, 64 pending SQLite requests / 32 MiB queued bytes, 48 MiB available
checkpoint payload / 64 MiB total checkpoint records, separate 64 MiB retained
historical operation payload and 1,000 operation records. Expiry batches at most
100 points. Never does not disable capacity limits. Main pages are reusable, not
promised to shrink; protected evidence is never evicted to admit work. The load
helper exercises the actual worker mailbox/query, not real Git scan scheduling.

WAL NORMAL can lose recent acknowledged metadata after OS crash/power loss.
External provider/Git/filesystem effects are not transactional with SQLite;
missing metadata is not proof that nothing happened. Fresh-store/no-import,
external-writer races, no automatic replay/continuation, and recovery quarantine
remain in force. Recovery cannot recreate lost provider history or undo external
effects. Exhaustive multi-client/revocation/full-capacity work remains deferred.

## Failed runs, repairs and remaining gates

Initial concurrent host runs were stopped after overlapping test execution was
identified; their partial failures are not passes. A subsequent complete one-worker
run returned 361 passed, six skipped and one failure: shutdown during the first
saved-chat metadata read returned connected instead of cancelled. The isolated
shutdown rerun reproduced it. `open` now registers its context transition and
session before metadata/expiry awaits and checks the connection epoch before
connecting. The existing failing public shutdown test is the regression seam.

Initial packaged combined run: 17 passed, four failed, plus worker teardown timeout.
Both move-recovery tests assumed an owner.lock survived confirmed process exit;
fixture cleanup now tolerates an already-absent lock. Their rerun passed 2/2.
Restoration timed out in the combined run but passed its traced isolated rerun
(9.8 seconds), including dirty text, restored disk, preserved conflict baseline
and explicit Save. This rerun does not erase the combined timeout.

Superseded-target Emergency Stop visible disclosure failed repeatedly, including
an isolated traced run. The expected `Stale Stop target.` alert was absent;
the rendered alert instead reported SQLite worker exit/storage unavailability.
A speculative client error-preservation change did not fix it and was reverted.
This is an internal unresolved acceptance failure, not an external access gate.
Loaded baseline Emergency Stop also failed to expose its emergency button; do not
infer loaded-control acceptance from the baseline passes.

Manual current-build VoiceOver and native macOS checks are user-owned and were
not performed. Previous acceptance on older features/builds does not qualify
these new controls. Physical ENOSPC and power-loss experiments were not performed.
No complete parent acceptance is claimed while these gates remain.

User-owned manual gate: on the final packaged app, use VoiceOver to discover and
activate Historical boundaries, before/after points, unavailable-history reasons,
file comparison, rewind/branch confirmations and Settings/Never. Verify announced
scope/consequences, focus on result and Cancel/Escape return, readable conflict
choices and retained unsent/unsaved text. Check native macOS window close/reopen,
explicit Quit Save/Discard/Cancel, and dialogs with these operations in progress.
These checks require a human; automated keyboard assertions do not certify them.

## Handoff run ledger

Raw command output is retained in [evidence/141](evidence/141/).
The complete subsequent two-worker host run passed 360, skipped six and failed
two: a real worktree-creation 15-second timeout, and the context regression during
shutdown-fix development. The final context guard allocates the session only after
acquiring the transition and removes a newly allocated session on failed metadata
validation. Final shutdown/project-draft verification passed 18/18 in 6.04 seconds;
a preceding shutdown/boundary run passed 24/24. Neither substitutes for a clean
full final-source suite. The final source retains the independent Send guard
against incomplete historical preparation.

One intermediate combined packaged run overlapped rebuilding its own executable:
14 passed, seven failed. That is invalid qualification, retained for diagnosis.
The subsequent stable-build run returned 19 passed, two failed: superseded Stop
and conversation-only rewind navigation (confirmation did not reach the expected
`Conversation rewound` result within five seconds). It included passing before/after
branch, summary, restoration, expiry, settings, recovery, editing and navigation
cases. Source refinement after that binary requires final-source requalification;
do not treat it as a clean acceptance run.

Exact remaining work includes fixing superseded Stop disclosure and establishing
loaded-control success; diagnosing the intermittent rewind/combined-run failures;
a clean full suite and combined final-source packaged pass; measuring actual
before/after Git capture latency separately from the aggregate Send/restart timer;
and the combined actual-provider UI/restart/recovery journey. These internal gaps
are not explained away as external human gates. The explicit human gates above
remain additional work. Typecheck/lint/build/package success alone cannot accept
these workflows. No physical capacity or durability guarantee is inferred.

Final-source typecheck, lint (four existing warnings), build and unsigned arm64
packaging passed. Final-source packaged checkpoint capture/unavailable coverage/
SIGKILL-restart, conversation rewind navigation and protected restoration passed
3/3 in 24.7 seconds. The aggregate three-Send/fault/restart timer was 1017.25 ms;
it is not a per-capture latency. This focused result narrows the intermittent
rewind failure but does not replace the failed combined qualification. The latest
18-test shutdown/context run passed after preserving the Send historical-pending
guard and removing failed-open placeholder sessions. No clean full final-source
host/combined run or complete parent acceptance is claimed.

## Internal-gap follow-up on the isolated completion branch

The preceding ledger describes the partial handoff at `706e8ee`; this section
records subsequent work on `t3/complete-141-internal-gaps` in
`/Users/elliotsharpe/.t3/worktrees/escode/t3-b7fe17af`. The branch starts from
integration `79f3f6e`, incorporates that exact partial commit, and retains
`0a9c981`. No issue closure, PR, or merge into integration is performed.

The existing superseded Stop packaged test went red again. The context-error
alert took precedence over the command error, hiding cancellation results during
storage loss. Command results now have their own alert alongside context/storage
errors. The supersession fixture also needed a valid provider sequence: an active
turn must complete before the replacement turn starts; an unsolicited competing
turn-start notification is correctly ignored by the host. The existing exact
stale-target and no-extra-interrupt assertions remain intact. The shutdown/open
context guards, historical-pending Send guard and owner-lock cleanup from the
partial branch are retained.

The first actual-provider UI/recovery run exposed an additional internal gap:
composer text survived restart in Chromium but disappeared when the SQLite copy
was recovered into a fresh profile. A dedicated client-owned `chatClient` recovery
record now persists composer text/revisions and retained Send/control identities
through the authenticated host connection. Hydration precedes chat actions; the
host binds storage to its authenticated desktop client, validates keys/string
values, serializes writes with revision checks, and rejects records above 4 MiB.
No transcript ownership changes. Pending Send persistence precedes dispatch;
failed final clearing restores the local pending identity for status-only retry.
Ordinary Stop still reaches host emergency admission when client persistence fails.
The copy/recovery validator accepts this dedicated record without treating it as
a filesystem intent requiring external reconciliation.

The live test's original retained-composer assertion was kept. The repaired
journey passed on installed Codex 0.166.0: fresh fixture Git checkout and app
store, one tool-free paid turn, visible before/after inspection, application
restart, retained unsent composer, consistent copy, recovery into a fresh profile,
read-only actual-provider reconciliation, same thread identity and one user turn
on reopening. It verifies source disk contents remain unchanged. Fixture threads
remain provider-owned; no personal chat was opened or mutated. Quit dialogs use
the existing explicit-confirmation fixture; automated execution does not certify
native dialog or VoiceOver behavior. This journey is separate from the prior
two-turn native-fork context probe and does not claim every historical operation
was performed in a single live-provider conversation.

Focused Send persistence tests went red before their fixes, then passed 20/20.
The command-alert fix passed all four Emergency Stop cases, and loaded control
passed three repetitions before the additional client-persistence fix. Full final
source and binary results are recorded below.

The first frozen-source packaged run after adding chat-client recovery passed
20/21, failing expiry. Repeating after waiting for the public idle snapshot still
failed 3/3, disproving the initial fixture-timing hypothesis; that fixture change
was reverted. The worker conservatively treated the new nonempty chat-client
record as a dependency on every historical file snapshot. The correct fix excludes
that identity/composer record from file-dependency classification, like checkout
authority, while retaining the record itself and all existing file-recovery,
receipt, preparation and branch guards. The authenticated expiry test went red
with a retained composer, then passed with the composer still intact after expiry.
No expiry assertion, history assertion, or test deadline was weakened. Focused
expiry plus Send tests passed 25/25 before the final serial run.

### Frozen-source final results

- Typecheck, lint (four existing warnings), build and unsigned arm64 packaging passed.
- Full host: **364 passed, six skipped**, 42 files passed/two skipped, 305.24 seconds;
  `bun run --cwd apps/desktop test -- --maxWorkers=1`.
- Complete combined packaged suite: **21/21 passed**, 1.7 minutes, one worker;
  history, checkpoints, retention, durable-state, navigation, Agents/file recovery,
  SQLite qualification and Emergency Stop. Rewind and restoration use unchanged
  assertions and deadlines. The binary was built once before these runs and was
  not rebuilt concurrently.
- Final loaded editing/control: **2/2 passed**, 11.0 seconds, one worker with
  `ESCODE_CHECKPOINT_LOAD=1`. Actual worker fill/reclaim admitted 47 one-MiB
  payloads in 2.25–2.34 seconds; cleanup reached 138.88 ms in this run. WAL was
  zero at the successful cleanup observations; main-file observations were
  46,268,416–49,418,240 bytes. These are bounded local samples, not physical
  full-disk qualification or real Git scan load.

Final unloaded renderer Save: 240.5 / 252.4 ms; outer Save verification:
275.5 / 324.9 ms; editing: 137.9 / 54.3 ms. Under checkpoint worker load,
renderer Save: 326.6 / 345.8 ms; outer Save: 439.9 / 492.4 ms; editing:
150.7 / 91.6 ms. Loaded Send: 419.5 ms; Stop: 133.0 ms; emergency control:
86.2 ms. Unloaded Send: 387.6–391.4 ms; Stop: 112.3–129.1 ms; emergency:
43.9–57.8 ms; worker-loss emergency: 54.1 ms. Prior baseline/loaded Save samples
above are preserved as earlier observations; no speedup is inferred between runs.

Effective settings remain WAL / NORMAL (`synchronous=1`) /
`checkpoint_fullfsync=1`. One hundred 4 KiB recovery writes measured median
0.126583 ms, p95 0.241875 ms, maximum 2.07175 ms; aggregate SQLite/WAL/SHM bytes
114,936 → 551,656. Fresh-store, external-effect, OS/power-loss, external-writer,
no replay/continuation and protected-dependency limits remain unchanged.

Final installed-provider packaged journey: **1/1 passed**, 45.9 seconds (46.2 seconds
including runner startup), Codex **0.166.0** at the recorded actual installation.
The final binary exercised UI before/after inspection, restart, consistent copy,
fresh-profile recovery and actual-provider reconciliation with retained unsent
text and exactly one user turn on reopening. No automatic replay or continuation
was observed; source files remained intact.

Separate actual Git-backed capture calls measured **163.322042 ms before-message**
and **163.162458 ms after-turn**. Each is one whole `captureTurnCheckpoint` call,
including Git discovery, file reads and SQLite persistence in the isolated fixture;
these are not pure Git subprocess timings or aggregate Send/restart timers. The
packaged copy/recover/reconcile script also passed with complete retained checkpoint
and branch coverage and newer disk contents preserved.

Final raw logs are `evidence/141/completion-{host,packaged,load,live,capture}.log`,
with build/type/lint/package logs alongside them (console trailing whitespace normalized). Red regressions, rejected timing
hypotheses and intermediate failures are retained separately. An intermediate
host run loaded old code while new tests were being edited; its development
failures are excluded from qualification. Final source was frozen for the complete
serial host/packaged/load/live runs. The final integration-tip merge was already
up to date at `79f3f6e`; both required ancestors remain reachable.

No identified internal gap remains from this qualification. Current-build manual
VoiceOver and native macOS lifecycle/dialog checks above are **unperformed and
user-owned**. Physical ENOSPC/power-loss and the explicitly deferred exhaustive
multi-client/revocation/full-capacity matrix remain unperformed. Final independent
Astra reviews are subsequent work; this implementation task performs no closure,
PR, or merge into integration, and does not claim complete parent acceptance.
