# Fresh before-turn checkpoints (#128)

Implemented only the before-message slice of #117, starting from integration
`b5eb1d0` and preserving ancestor `0a9c981`, in isolated worktree
`/Users/elliotsharpe/.t3/worktrees/escode/t3-a70278c1`, branch `t3/saved-file-checkpoints` (initially `t3/a70278c1`).
The accepted #127 worker-loss qualification remains the prerequisite evidence;
no issue, PR or integration branch was changed by this slice.

The existing authenticated Send route persists ordinary admission/dispatch intent
before ChatService prepares a turn. After preparation and its saved Send intent,
it captures fresh disk contents before `turn/start`, then rechecks captured
session/checkout authority and cancellation. Each immutable SQLite checkpoint
records a UUID before-message boundary, production Send command ID, provider
thread/chat/project references, exact checkout path/directory identity, Git HEAD
base and independent available/unavailable file coverage. A failed optional
capture retains a missing-coverage record and exposes the reason through the
existing chat error surface; it does not permit unrecorded Send or approval.
No project retains conversation work with explicitly unavailable file coverage,
without invoking Git or adding Git to scratch folders.

Git only enumerates tracked and eligible nonignored untracked paths and reads
HEAD. Saved bytes, executable modes, symlink targets and tracked deletions live
in SQLite; capture never writes the actual index, Git objects or branch history.
Unsaved editor memory, ignored untracked files, empty directories, nested
repositories/submodules and environment reconstruction are excluded. Existing
client recovery and unsent text remain separate. External writers are not
transactionally excluded; a capture is not an atomic filesystem snapshot.

Capture bounds are 10,000 enumerated paths, 8 MiB raw file contents per capture,
4 MiB Git output and 15 seconds per Git subprocess; file iteration checks its
15-second deadline. The existing SQLite worker queue remains 64 requests/32 MiB.
Encoded available checkpoint records have a separate 48 MiB aggregate budget;
16 MiB further capacity is reserved for unavailable boundary records (64 MiB total).
Nothing is evicted to admit a capture. If even missing-coverage metadata cannot
persist, the existing chat error explicitly reports boundary persistence failure;
optional capture still does not gate already admitted work. This cannot promise
retention of new metadata on a completely unwritable disk. Normal later Send
intent/outcome writes retain their existing fail-closed/uncertain rules.

Schema 4 adds checkpoint records transactionally without replacing identities.
Checkpoint bytes are part of SQLite's consistent recovery copy, with no new
external content dependency. Completion capture, inspection/restore/branch UI,
provider historical-context operations and cleanup belong to later tickets.

## Executed verification (2026-10-31)

- TDD red: authenticated Send dispatched once but returned zero checkpoints when
  the capture hook was absent. Green: the same test retained the saved bytes.
- Real Git/SQLite authenticated Send test verifies manual saved edits between
  turns, distinct boundaries, recorded HEAD and provider reference, unchanged
  actual index bytes and porcelain status, staged-versus-disk differences,
  deleted tracked files, symlink targets, ignored/empty/nested exclusions,
  duplicate command non-dispatch, oversized capture marked unavailable with
  agent work continuing, and intent failure with unchanged provider turn count.
- Full host suite: 330 passed, six skipped, 41 files, 73.35 seconds. Subsequent
  focused Send/chat/command/recovery tests: 31 passed, one live-provider skip;
  final expanded authenticated test file: 6/6 passed.
- Typecheck, lint, build and unsigned arm64 packaging passed. Frozen dependency
  installation made no lockfile changes. Diff whitespace check passed.
- Final packaged checkpoint/restart/SQLite qualification: 4/4 passed, 9.0 seconds.
  The checkpoint case uses the real packaged worker and authenticated renderer
  Send route with a deterministic process provider. It verifies two fresh saved
  states, a checkpoint-write fault retaining unavailable coverage, a separate
  intent-write fault and exactly three provider effects. Three Sends plus fault
  assertions took 300.818 ms in this small fixture; this is not a capacity or
  speedup claim.
- Packaged settings: WAL, NORMAL (1), checkpoint_fullfsync 1. 100 recovery writes:
  median 0.128375 ms, p95 0.229958 ms, max 0.936250 ms; database/WAL/SHM grew
  from 86,120 to 522,840 bytes. Baseline/followup edit: 131.726/53.660 ms;
  Save: 261.245/350.632 ms. These retain the existing storage qualification seam.

Failed-run history: dependencies were initially absent. After frozen installation,
the red test failed for missing checkpoints as intended. The first packaged
fixture omitted ordinary project opening and timed out; the next used an
unrelated New chat visibility wait that raced with switching to Files. The final
fixture opens the project normally and waits for its exact project region; the
combined packaged run above passed. A test-only unknown-result type error was
fixed before the final typecheck.

No remaining #128 acceptance gap is known. No new live paid-provider turn,
manual VoiceOver/native check, real ENOSPC volume, hard-crash checkpoint test or
physical power-loss experiment was run here. Existing storage-milestone evidence
is preserved; deterministic provider/fault tests do not establish new provider
compatibility or power-loss guarantees. There is no new interactive UI operation.
