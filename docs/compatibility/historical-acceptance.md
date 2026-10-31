# Combined historical qualification (#141)

Qualification remains open. This record does not accept or close #117 or #141.
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
| 49–51 | Capacity/exhaustion and durable Send/control host tests; packaged storage faults and worker-loss Stop. Superseded-target visible disclosure remains unresolved below. |
| 52–55 | Packaged effective settings, recovery-copy/checkpoint-recovery-copy tests and packaged copy/recover/reconcile. Original files/store retained; provider/Git remain external dependencies. |
| 56 | Current baseline and checkpoint-load measurements below; bounded local samples only. |

This mapping combines the predecessor records with current runs; it does not
claim every story was exercised as one uninterrupted live-provider UI journey.
The final combined packaged suite uses real Electron/SQLite/Git and deterministic
provider subprocesses. A fully combined live-provider UI/recovery journey remains
unperformed; passing protocol fixtures does not fill that gap.

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
