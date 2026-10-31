# Corresponding completion checkpoints (#129)

Implemented only #129 of standalone #117 on branch
`t3/durable-state-checkpoint-capture`, isolated worktree
`/Users/elliotsharpe/.t3/worktrees/escode/t3-66bcf4c6`, based on integration
`d12d846`, preserving `0a9c981`. No issue closure, PR or merge into integration.

The authenticated Send path reserves an after-turn UUID with its command,
provider thread, chat and exact checkout before provider dispatch. The matching
observed completion finalizes that reservation once with the provider turn ID
and status. Successful completion captures saved files and Git base independently
of both neighboring before-message captures. A chat remains busy until capture
settles, preventing a later Send from contributing its files. Duplicate completion
notifications cannot rewrite a finalized point. Late duplicate started notifications
for the last completed turn are ignored.

The shared checkpoint capture retains #128's Git-index preservation, path/byte/time
and aggregate storage bounds, exclusions, SQLite recovery-copy inclusion, and
external-writer race limits. It also rejects a changed known checkout directory
identity. No schema replacement or synthetic Git commit is needed. Interrupted,
failed or unknown completion has unavailable files. An unobserved completion or
interrupted capture leaves the reserved unavailable record, explicitly stating
that completion was not observed or capture was interrupted. It is not repaired
from current files on restart. If result persistence fails, unavailable fallback
is attempted under the same UUID; if both writes fail, the earlier reservation
survives and the chat discloses persistence failure. Complete storage loss cannot
promise persistence of a new reservation. Existing before points and command,
operation and recovery evidence are never pruned to admit captures.

## Verification

- TDD red: the authenticated completion assertion returned no after-turn record.
  Frozen dependencies were initially missing and installed without lockfile edits.
- Real temporary Git/SQLite over authenticated Send checks fresh before files,
  corresponding completed-turn bytes/provider references, independent intervening
  saves, duplicates, unchanged index bytes, tracked deletions/symlinks and declared
  exclusions, exhaustion with continued turns, intent refusal without dispatch,
  failed available-result persistence with unavailable fallback, failure of both
  result writes with retained reservation, Stop/interruption, and database reopen
  preserving all records without replay. Seven deterministic provider turns.
- Focused host checkpoint/chat/history/storage checks: 29 passed, one live skip.
  Typecheck, lint, build and unsigned arm64 package passed.
- Initial full suite exposed an overly strict started-notification guard in this
  change (three history tests failed); corrected to preserve external provider-work
  observation. The focused affected tests subsequently passed.
- Packaged authenticated renderer Send uses the real SQLite worker and a
  deterministic provider process; checks completion bytes, unavailable capture,
  intent failure, three provider effects and close/relaunch with unchanged records
  and no new provider effect. SQLite WAL/NORMAL/full-checkpoint-flush readback and
  editing/Save qualification run alongside it. Timings are small-fixture observations,
  not a capacity or speedup claim.

No inspection/rewind/branch/retention UI or #130+ work is included. No paid live
provider turn, new manual VoiceOver/native validation, actual ENOSPC volume,
hard-kill during checkpoint capture or physical power-loss experiment was run.
External writers can change files during capture; this is not an atomic filesystem
snapshot. NORMAL retains the accepted possible recent-metadata loss on OS crash
or power loss. Pending unavailable points intentionally gain no later context.

Final qualification details: full host rerun had 329 passing tests, six skips and
one 15-second timeout in unchanged worktree creation under concurrent packaged
load. Its isolated rerun passed all 17 tests. Final distinct-provider-turn fixture
passed 6/6. The packaged restart fixture initially hung on graceful shutdown of
faulted state; it now uses the existing SIGKILL/relaunch pattern after completed
captures and kills the final test process. A subsequent fixture raced completion
before its third Send; it now waits for the public chat busy state. Opening the
unsent draft for that wait was unsupported by the minimal provider fixture, so
that wait starts after the first Send. These failures are fixture history, not
claims of graceful faulted-state Quit qualification. Packaged SQLite qualification
passed 2/2: 100 writes median 0.154208 ms, p95 0.435083 ms, max 3.661084 ms;
86,120 to 522,840 database/WAL/SHM bytes. Baseline/followup edit 198.916/41.121 ms,
Save 609.572/310.604 ms. Concurrent runs affect these observations.
Final packaged checkpoint/restart rerun: 1/1 passed in 3.1 seconds; three Send
sequence plus restart assertions measured 1093.044 ms. No known functional #129
acceptance criterion remains unmet within the accepted deterministic seams.
