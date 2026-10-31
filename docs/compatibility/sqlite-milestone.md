# Storage milestone qualification (#127, spec #117)

2026-10-31, isolated worktree `/Users/elliotsharpe/.t3/worktrees/escode/t3-fbad77c9`,
branch `t3/sqlite-metadata-cutover`, based on integration `7ed42e0` with `0a9c981`
in ancestry. Integration merge before reporting returned already up to date.
This record does not accept #127 or unblock historical implementation #128.

Implemented: host project approvals now use revision-checked SQLite records keyed
by host identity, independently of client workspace membership. Existing approval
JSON bytes are ignored and preserved. Renderer workspace persistence cannot grant
approvals. Recovery copies include approvals in the consistent SQLite cut;
reconciliation checks approved directory identities. Packaged fixtures seed
approvals directly into SQLite rather than copying old approval JSON at launch.
No import or dual write was added.

TDD: the new preservation test initially failed parsing `preserved old bytes` from
the superseded JSON path. After cutover all 12 workspace tests passed.

Executed evidence:

- Typecheck and lint passed. Dependency resolution uses symlinks to the integration
  checkout's installed dependencies; no dependency/lockfile change.
- Host suite from `apps/desktop`, after native helper compilation: 345 passed,
  4 skipped, 42 files, 38.94 seconds. An earlier invocation from repository root
  was stopped because relative native helper paths failed; it is not passing evidence.
- Build and unsigned arm64 package passed.
- Restricted-PATH packaged emergency Stop, stable identity relaunch and
  CSS/Monaco/tool smoke: 3 passed, 10.3 seconds.
- Actual packaged Electron worker readback: journal mode `wal`, synchronous `1`
  (NORMAL), checkpoint_fullfsync `1`. The committed
  `tests/sqlite-qualification.spec.ts` performs this independently in a fresh
  measurement store inside the packaged runtime.
- 100 sequential 4 KiB recovery writes in that worker: median 0.082167 ms,
  p95 0.177667 ms, maximum 0.688583 ms. Database plus WAL/SHM grew from 77,928
  to 514,648 bytes. This is a single practical worker round-trip measurement,
  not editor, Save, Send or control latency, a speedup, or a capacity claim.
  The test passed in 551 ms (869 ms runner total). Initial harness attempts
  failed because `require` is unavailable in Electron evaluation; corrected to
  `process.getBuiltinModule`. Cleanup initially obscured that error and was fixed.

Inspected bounds: worker admission is 64 pending requests; chats are limited to
1 MiB serialized; submissions retain at most 1,000 identities; each recovery row
is limited to 16 MiB; live spool defaults to 64 MiB. These do not establish a total
metadata bound: recovery owners/rows, submission payloads and queued spool work
need combined qualification. Protected evidence is not pruned to admit work.

Exact remaining criteria:

1. Complete metadata cutover: startup still opens `FoundationState` JSON receipts
   and takes its epoch/owner from that store; recovery-copy still requires/fences
   that journal. Those paths and their fixtures must be removed together. The
   old standalone `send.ts` path and Foundation tests also remain. This change
   only removes active JSON project-approval persistence.
2. Complete-worker failure with emergency Stop remains unqualified; current
   emergency evidence establishes receipt-write failures only. No real full-disk
   scenario was executed here. Existing crash/replay/corruption/missing-store
   regressions passed in the combined host suite; this adds no stronger guarantee.
3. Actual live provider saved-history reconciliation has not been executed.
   Deterministic recovery-copy tests do not establish the live adapter guarantee.
4. Baseline/follow-up editing, Save, Send and control latency remains unmeasured.
   No checkpoint/cleanup workload exists in this slice. Aggregate queue/storage
   bounds remain incomplete as described above.
5. Human accessibility/live-provider gates were not performed. No physical power
   loss, stronger project-file durability, exhaustive capacity or multi-client
   guarantee is claimed. Existing lookup-watcher intermittency remains a known
   integration qualification limit.

Follow-up: focused workspace/recovery-copy/durable-state checks passed 27/27.
A transient attempted worker approval-owner check rejected the older host fixture
identities (7 failures); it was removed before the passing rerun. Project-draft
packaged scenario passed. The initial combined saved-project recovery run exposed
fixture input mutation: adding directory identities changed expected workspace
records. The seed helper now copies inputs before adding identities.
The corrected saved-project/interrupted-move and closed-editor/linked-worktree
packaged rerun passed 2/2 in 7.2 seconds. Final typecheck/lint and diff checks pass.

## Completion follow-up (2026-10-31)

Worktree `/Users/elliotsharpe/.t3/worktrees/escode/t3-f79b964f`, branch
`t3/sqlite-metadata-cutover-1`: verified clean integration base `7ed42e0`, merged
exact partial `11ff1b3e7b2874991931ce2701d02449e655f014`, preserved `0a9c981`.
Final integration merge returned already up to date. No issue closure, PR or merge
into integration was performed; #128 still requires #127 acceptance.

The remaining active FoundationState JSON store and standalone Send implementation
are deleted with their obsolete tests. Startup identities come from SQLite; the
host generates a new admission epoch and uses Electron's process-owned single
instance lock. File commands share that epoch and SQLite workspace ownership.
Recovery export, validation and reconciliation now use command receipts in the
consistent SQLite cut; no separate JSON writer/fence exists. Packaged identity
fixtures read SQLite. Existing old bytes are neither imported nor removed.

TDD evidence: removing JSON setup from recovery fixtures first produced five
ENOENT failures at the external journal lock; the SQLite-only copy tests then
passed, including unresolved command quarantine. The 257th recovery owner initially
succeeded; it now fails while existing rows remain readable. Aggregate byte-limit,
queue, complete-worker-loss and existing recovery tests pass at their existing
boundaries. The removed tests exercised the superseded store, rather than the
active SQLite implementation.

Admission limits are explicit: 64 MiB aggregate serialized bodies across chats,
submission bodies/association snapshots, preparation results and recovery rows;
256 distinct recovery owners, 1,280 recovery rows, 16 MiB per recovery row, 1 MiB
chat collection, 1,000 submission identities; client/chat/command identity keys
are limited to 256 characters where admitted. SQLite transaction triggers enforce
aggregate limits, including shared file-fact fanout, and roll back the mutation.
Worker queue: 64 requests and 32 MiB serialized fields. Live spool: existing
64 MiB disk quota, plus 64 queued writes and 8 MiB serialized queued snapshots.
No protected evidence is evicted. These are logical admission limits, not an
upper bound on SQLite page overhead, WAL retained by readers, temporary backup
space or provider-owned storage. Exhaustion requires explicit operator action.

Executed follow-up:

- Combined host suite: 329 passed, six skipped (including two explicit opt-in
  qualification cases), 41 files, 52.76 s. A subsequent focused run including the
  aggregate 64 MiB rejection test passed 24/24 in 2.32 s.
- Typecheck, lint, build and unsigned arm64 package passed. Dependencies were
  installed with the frozen lockfile; no dependency or lockfile change.
- Complete worker termination: ordinary admission rejects with no dispatch;
  captured emergency Stop returns uncertain and dispatches exactly once;
  ordinary Send remains rejected. Existing authenticated target/authority and
  packaged emergency tests remain the complementary checks.
- Real ENOSPC: created a disposable 20 MiB HFS+ disk image with `hdiutil`, filled
  it with real 1 MiB then 4 KiB files, and ran the storage qualification test.
  SQLite rejects recovery persistence and Stop admission, keeps the original
  saved draft, and permits explicit emergency cancellation exactly once. This
  exposed SQLite's automatic rollback on full disk; worker error handling now
  preserves the original failure instead of masking it with a second rollback.
  Both opt-in qualification cases passed together in 1.96 s. No project or user
  volume was filled. Reproduce with a disposable mounted filesystem:
  `ESCODE_FULL_VOLUME=<mount> ESCODE_READ_ONLY_PROVIDER=1 bun run --cwd apps/desktop test -- host/storage-qualification.test.ts`.
- Installed provider: Codex 0.166.0, `codex login status` reports ChatGPT login.
  Executed account/read, thread/list and the existing recovery inspector's
  thread/read against an existing exact saved thread/cwd; identity, cwd and turns
  were confirmed. No thread/start, resume, turn or resource mutation was requested.
  This qualifies read-only saved-provider inspection on this installation; it
  does not qualify historical continuation or every saved thread.
- Packaged actual UI measurements: baseline editing 138.407 ms and Save 269.735 ms;
  after 32 additional valid 64 KiB recovery records, editing 55.511 ms and Save
  258.445 ms. Editing includes automation click/select/type/render; Save includes
  button admission, disk observation and re-enabled UI. Initial timing attempts
  issued Cmd+S during the preceding in-flight Save and did not measure a second
  save; the fixture now waits for the enabled Save button. This is a bounded
  baseline/follow-up workload on the current build, not an old-version comparison.
- Two packaged Send/ordinary Stop/emergency Stop runs: 386.430/120.156/54.670 ms
  and 383.734/111.189/50.913 ms. Provider protocol/effects are deterministic local
  fixtures; these measure real packaged UI and host paths, not network/model time.
- Packaged worker readback remains WAL/NORMAL/checkpoint_fullfsync=1. A follow-up
  100 x 4 KiB sample measured median 0.129584 ms, p95 0.250375 ms, max 4.027792 ms;
  SQLite/WAL/SHM grew from 77,928 to 514,648 bytes. No speedup is claimed.

Qualification limits remain: no physical power-loss test, stronger project-file
flush guarantee, exhaustive capacity/multi-client matrix, new manual accessibility
check or historical implementation. Checkpoint capture/cleanup does not yet exist
in this slice and has no latency claim. There is no unmet authentication gate for
the executed read-only provider inspection. These bounded checks require parent
acceptance before #128 is unblocked.

Final packaged rerun after rebuilding the final spool bound: 6/6 passed. This
includes explicit fresh-store baseline and follow-up Send/control runs with 32
additional valid 64 KiB recovery records: Send 384.800/383.385 ms, ordinary Stop
120.332/114.862 ms, emergency Stop 45.779/31.071 ms. An overlapping earlier test
launch during package replacement failed ENOENT; it is excluded from pass evidence.
The final serialized build/package/test run succeeded.

## Remaining worker-loss gate (2026-10-31)

Isolated branch `t3/127-worker-stop`, worktree
`/Users/elliotsharpe/.t3/worktrees/escode/t3-7e02e0ca`, starts at exact integration
`973d3305b50abcb356632f192b27b9fafc2e1f9a`, preserving `0a9c981`.
The integration tip was merged before reporting (already up to date).

The earlier direct DurableSend worker-loss evidence did not qualify combined-app
authorization. The packaged app now qualifies that remaining boundary: terminate
the real worker during captured live work, fail ordinary Stop admission, explicitly
request emergency cancellation with retained validated live authority, and reject
an actual superseding provider turn without cancellation of that newer turn.
Unrecorded Send/approval and wrong-project requests are rejected through the same
authenticated renderer/host path. See emergency-stop.md for behavior and failed-run
history. No authentication bypass or general mutation exception was introduced.

Executed final checks:

- Host suite: 330 passed, six skipped, 41 files, 66.45 s.
- Targeted `host/lookup.test.ts`: 5/5 passed, 6.31 s. Merger's line-106 watcher
  timeout was not reproduced; no lookup code or timeout was changed. Existing
  intermittency is not asserted fixed or a regression from this change.
- Typecheck, lint, build and unsigned arm64 package passed; frozen dependencies
  installed without lockfile changes. Diff whitespace check passed.
- Combined packaged emergency/worker-loss, restart and SQLite qualification:
  7/7 passed, 15.8 s. An earlier run had 3 passes and one baseline ordinary Stop
  timeout before fault injection; the unchanged final rerun passed all cases.
- Packaged readback: WAL, synchronous NORMAL (1), checkpoint_fullfsync=1.
  100 x 4 KiB recovery writes: median 0.147042 ms, p95 0.284167 ms,
  max 3.833167 ms; database/WAL/SHM 77,928 to 514,648 bytes.
- Packaged baseline/follow-up edit 148.003/40.266 ms, Save 358.004/254.705 ms;
  Send 881.393/381.842 ms, Stop 123.805/117.859 ms, emergency 52.181/32.036 ms.
  These bounded automation measurements are not speedup claims.

No exact remaining worker-loss acceptance gap was found. Parent acceptance still
owns #127 closure and #128 gating; neither issue was changed. Prior real ENOSPC
and read-only installed-provider qualification is preserved, not rerun. Physical
power loss, exhaustive capacity/multi-client, new manual accessibility and
historical implementation remain outside this qualification.
