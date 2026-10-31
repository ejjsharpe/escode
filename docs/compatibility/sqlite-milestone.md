# Storage milestone qualification (#127, spec #117) — incomplete

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
