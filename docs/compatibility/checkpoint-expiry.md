# Inactivity checkpoint expiry (#137)

Started from isolated integration `982d3c8`, preserving `0a9c981`, on
`implement/137-checkpoint-expiry`. Only the default inactivity cleanup is owned
here; #138 owns configuration/Never and #139 owns wider reclamation/capacity.

The host schedules cleanup every minute through its existing SQLite worker.
Each transaction expires at most 100 available snapshots, retaining boundary and
provider metadata with an explicit expiry reason. Opening expires eligible old
coverage before extending remaining coverage. Polling never touches activity.
User Send and captured checkpoints persist activity; observed turn/item events
also extend it. Live sessions/context transitions and pending completions protect
required state. Failed activity writes disable cleanup for that host lifetime.

Recovery evidence is deliberately conservative: any client's saved file drafts,
nonempty file-operation evidence, uncertain rewind, preparation results or
nonterminal/uncertain Send receipt protects data. Checkout approvals alone do not
protect historical files. Retained branch receipts already contain independent
checkpoint copies; cleanup never rewrites them. No provider deletion, worktree
removal, Git mutation, VACUUM or immediate disk-release promise is introduced.

Verification results and remaining qualification limits follow below.

## Executed qualification (2026-10-31)

Merged the integration tip `b269f70` (including #133 and #135) into this branch;
`0a9c981` remains an ancestor. The integration branch itself was not changed.
TDD started with authenticated polling incorrectly reporting available coverage
after 31 days; that assertion failed before implementation and passed afterward.

Final focused host run: `bun run --cwd apps/desktop test --
host/checkpoint-expiry.test.ts host/boundaries.test.ts host/durable-send.test.ts
--maxWorkers=1`: **24/24 passed**, three files, 140.05s under concurrent local
qualification load. Tests exercise real SQLite/Git, authenticated opening/Send/
inspection, controllable inactivity, user and agent activity, active work, polling
exclusion, no resurrection, recovery drafts, retained branch copies, nonterminal/
uncertain receipts, 100-record batches and transaction rollback on injected expiry
failure. Saved files/index and chat identities remain intact; deterministic
provider counts establish no automatic extra turns. Retained pending completion
records protect interrupted work after live-session loss.

Typecheck, lint, build and unsigned arm64 packaging passed. Lint retains four
pre-existing warnings; build retains existing bundle-size/import.meta warnings.
The rebuilt packaged history run passed six of seven checks: navigation,
streaming, file inspection, completion branching, restoration and expiry. The
before-message branch result was still busy at the existing five-second assertion
and timed out under concurrent host/package load; its isolated rerun is recorded
below. The expiry screenshot was visually inspected: unavailable reason, retained
provider history and retained composer are visible.

Failed-run history also includes an incorrect draft-open rejection expectation,
an activity fixture that omitted explicit provider connection, and an established
restoration fixture lacking createdAt. The fixture expectation/setup was corrected;
checkpoint activity now safely handles that existing optional timestamp. An initial
packaged expiry run exposed checkout approvals incorrectly blocking cleanup; these
are authority metadata rather than file-history dependencies and were excluded.

No paid live-provider turns, manual VoiceOver/native checks, actual ENOSPC volume,
physical power-loss test or full capacity/performance qualification was performed.
Recovery/uncertain evidence can conservatively delay cleanup for unrelated chats;
this slice never prunes that evidence to reclaim space. Logical expiry does not
establish immediate disk release. #138 settings/Never and #139 broader storage
reclamation remain outside this ticket. No issue closure or PR was created.

Isolated packaged before-message branch rerun: **1/1 passed**, 6.7s, without a
source or timeout change. All seven packaged scenarios have passed on the final
built source, with the combined-run timing failure retained above. No known
functional #137 criterion remains unmet at these automated seams; the human/live
and conservative cleanup qualification limits above remain.
