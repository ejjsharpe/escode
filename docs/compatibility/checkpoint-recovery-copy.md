# Checkpoint recovery-copy coverage (#140)

The existing administrative recovery utility inventories checkpoints and snapshots
retained by historical operations from the same online SQLite backup cut. Capture,
branch preparation and expiry publish atomic SQLite records; the utility reads the
copy rather than racing separate live queries. Saved file bytes are embedded in
these records, including branch snapshots whose source point has expired. No
second checkpoint store, scheduled backup or remote backup service is introduced.

Available snapshots require valid file paths, modes and canonical base64 bytes.
Missing required bytes, checkout identity or exact Git base/object dependencies
make the manifest incomplete. Expired/unavailable snapshots stay unavailable; no
current files are substituted. Git repositories and provider history remain external
requirements, not archived content. The manifest inventories their exact references.
Reconciliation checks their current availability again, including retained provider
contexts, and blocks uncertain historical operations. The preserved original SQLite
store must remain available for comparison: a point expired or retired since the
copy cannot regain effect authority from the older copy. Missing original authority
retains quarantine. This conservative procedure does not support destruction of the
original installation followed by autonomous recovery.

Use the bundled `recovery-admin.cjs` copy/recover/reconcile commands documented in
[the recovery procedure](sqlite-recovery-copy.md). Preserve the original user-data
folder, repositories and provider histories. Inspect `manifest.json` for `complete`,
`missing` and `checkpoints`, then the recovered sibling `.reconciliation.json`.
Do not remove quarantine to bypass a missing dependency. A successful check does
not install old spool chunks as live requests. Startup rotates admission authority;
new effects require explicit authenticated commands. No turn, approval, mutation or
historical operation is replayed by this utility. Copies cannot undo newer external
effects or recreate provider history. External writers can race observations; ordinary
operation admission still revalidates targets. WAL NORMAL power-loss limits remain.

## Qualification

Real SQLite/Git/files tests exercise concurrent capture and copying, cleanup and
branch-record publication, retained branch bytes after source expiry, missing
checkpoint/spool bytes, missing Git bases, provider uncertainty, original preservation,
divergent disk files, quarantine and stale authenticated Send with zero effects.
An additional red/green test exposed and fixed recovery admission overlooking an
uncertain historical operation retained in SQLite.

The first test command could not start until frozen dependencies were installed.
A combined recovery/expiry/capacity run passed 15/16 tests; the existing expiry
agent-activity polling case timed out. Its isolated rerun passed all five tests.
Recovery plus SQLite recovery passed 25 tests before the final uncertainty check.
The final seven recovery tests, typecheck, lint, build and macOS arm64 packaging passed.

Run from the repository root after build/package:

```sh
node apps/desktop/scripts/qualify-checkpoint-recovery.mjs
```

The assert-based packaged procedure creates a temporary real Git repository and
worker-owned SQLite store, captures changed saved bytes, retains a historical branch
snapshot, then invokes the macOS packaged executable with `ELECTRON_RUN_AS_NODE=1`
and its `app.asar/dist/host/recovery-admin.cjs` for copy, recover and reconcile.
Change the original working file between recovery and reconciliation; assert a
complete manifest, ready report, original bytes unchanged and retained checkpoint
bytes intact. This procedure ran successfully with no provider thread. It does not
establish live-provider history compatibility, human accessibility or physical
power-loss durability. No renderer UI changed.

The broader recovery/SQLite-recovery/capacity rerun passed all 29 tests. An earlier
run hit the 15-second fixture timeout; the real-Git fixture now isolates repositories
from SQLite/copy output and permits 60 seconds for subprocess-heavy verification.
