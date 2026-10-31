# SQLite recovery copy (#126)

The administrative host utility captures the current SQLite store, its external
foundation receipt journal, and published live-spool indexes and referenced chunks.
It excludes provider history, project files, and future checkpoint contents.
No legacy import, scheduled backup, command replay or turn continuation is provided.

## Operator procedure

Build with `bun run build`. Run the bundled command with Node 26:

```
node apps/desktop/dist/host/recovery-admin.cjs copy SOURCE COPY SPOOL
node apps/desktop/dist/host/recovery-admin.cjs recover COPY NEW_SQLITE HOST_ID CLIENT_ID
node apps/desktop/dist/host/recovery-admin.cjs reconcile NEW_SQLITE HOST_ID CLIENT_ID
```

Paths are absolute operator-selected paths. Under Electron user data, SOURCE is
`durable-chats-v1.sqlite-state-v1`, SPOOL is `live-spool-v1`. COPY and NEW_SQLITE
must not exist. Obtain HOST_ID and CLIENT_ID from the trusted original installation,
not from an untrusted export.

1. Stop escode and preserve its entire original user-data directory, including
   establishment markers, receipts and spool. Do not replace a live database or
   remove its WAL. Do not delete an existing owner lock to force a copy; a crash
   lock needs investigation against the preserved original first.
2. Run `copy`. It exclusively acquires the receipt journal's existing writer lock
   for the whole capture. An active application writer therefore rejects the
   operation. Independent SQLite writes remain supported: the Node SQLite online
   backup API produces a consistent cut while writes continue. The fenced journal
   is copied byte-for-byte and checked against the SQLite owner. Temporary owner
   lock creation/removal is the only source write by this utility.
3. Inspect `manifest.json`: SHA-256 inventories the database, receipt journal and
   captured spool files. Missing/corrupt required spool data marks it incomplete.
   Published spool indexes have their own cut and may be newer than SQLite.
4. Run `recover` to validate format, owners, identities, integrity and checksums,
   preserving both original and export. It creates a separate database and retains
   the external receipt bytes without rewriting unresolved evidence. A sibling
   `.recovery-pending` marker blocks application startup.
5. Run `reconcile`. The production adapter uses installed Codex through the ordinary
   validated app-server protocol. It reads account status without token refresh and
   `thread/read` with turns, confirming exact thread ID and checkout. It never calls
   thread resume/start, turn start, approval or file mutation methods. Unavailable,
   unauthenticated, unsupported or mismatched history retains quarantine.
6. Read the sibling `.reconciliation.json`. It observes checkout inode/device/path,
   receipt associations and recovered draft file hashes against retained baselines.
   Missing/replaced roots, incomplete content, unresolved external or SQLite receipts,
   preparation results, uncertain file commands and file obligations block activation.
   Available draft text and baselines remain unchanged when disk files diverge.
   Resolve uncertainty externally against preserved evidence; do not delete or rotate
   receipt journals to make this check pass. This utility does not fabricate outcomes.
7. Only a successful report removes quarantine. With escode stopped, preserve the
   original user-data tree elsewhere and select the recovered SQLite directory at
   the application's expected path, retaining its establishment marker and receipts.
   Keep the export and report. Spool is retained in the export for inspection, not
   installed as live output. Startup creates fresh admission epochs and rejects old
   unknown commands; retained known outcomes remain evidence. Explicit new work
   still requires ordinary authenticated admission. Never combine recovered SQLite
   with newer receipts or resubmit pending commands with replacement IDs.

## Durability and qualification

WAL synchronous NORMAL may lose recent acknowledged metadata after OS crash or
power loss. Checkpoint full flushing does not provide per-commit FULL durability.
Copies cannot undo external effects or recreate provider history. Hashes detect
content damage, not a malicious owner rewriting both content and manifest. External
filesystem writers can race observations; normal execution revalidates authority.

Executed: recovery utility tests (6), tools/protocol tests (24), and related real
SQLite/authenticated Send/control/file recovery suites (34): 64 tests total after
the final additional writer-lock test. Red/green was observed for receipt coverage
and the production adapter. Tests include concurrent SQLite writes, receipt bytes
and original preservation, missing spool quarantine, divergent external files,
provider unavailability/mismatched identity, and stale authenticated Send with zero
effects until explicit new admission. Protocol fixtures exercise the production
adapter through a real subprocess; they do not certify installed-provider history.
No physical power-loss, actual saved live-provider history or human UI qualification
is claimed. No renderer UI changed.

Final checks: repository typecheck, lint, build and macOS arm64 package passed.
The packaged Electron executable, with `ELECTRON_RUN_AS_NODE=1`, ran the bundled
`app.asar/dist/host/recovery-admin.cjs` through copy, recover and reconcile against
a real temporary worker-created SQLite store and external receipt journal. The
manifest was complete, reconciliation ready, and original database retained. This
empty-store packaged check does not establish saved live-provider compatibility.
Integration tip `a118742` was merged (already an ancestor); `0a9c981` remains an
ancestor. No issue closure, PR or integration-branch merge was performed.
