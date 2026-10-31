# SQLite recovery copy (#126)

The administrative host utility `host/recovery-copy.ts` exposes `createRecoveryCopy`,
`recoverCopy` and `reconcileRecovery`. It is not a renderer filesystem API or a
scheduled/remote backup service. It handles only escode's current SQLite format.

## Procedure

1. Preserve the entire original user-data directory and its establishment marker.
   Do not replace a live database, remove its WAL, or delete the original files.
2. In an administrative Node 26 host process call
   `createRecoveryCopy(sqliteDirectory, newCopyDirectory, liveSpoolDirectory)`.
   The current paths under user data are `durable-chats-v1.sqlite-state-v1` and
   `live-spool-v1`. The destination must not exist. SQLite's online backup API
   produces the consistent SQLite cut while ordinary writers remain available.
3. Read `manifest.json`. Its SHA-256 file inventory covers SQLite and captured
   spool indexes and referenced chunks. Missing/corrupt chunks or unavailable
   spool are explicitly incomplete. Spool indexes have their own publication
   boundary and can be newer than SQLite. Provider history and project files are
   external; checkpoint contents are not implemented by this slice.
4. Call `recoverCopy(copyDirectory, newSQLiteDirectory, expectedIdentity)` using
   the known original host/client identity, never an identity guessed from an
   untrusted backup. This verifies checksums, format, integrity and record owners
   before writing a separate recovered directory. Source originals and export
   are retained. A sibling `.recovery-pending` marker prevents application startup.
5. Call `reconcileRecovery(newSQLiteDirectory, expectedIdentity, inspectProvider)`.
   The provider adapter must inspect retained provider history without mutation and
   return true only for the exact thread and checkout; unavailable or uncertain
   history must return false. This is an administrative seam, not permission to
   invent history or start/resume a turn. The report records current file hashes
   alongside retained baselines. Changed or missing files retain unsaved text;
   ordinary save conflict validation still applies. Missing/replaced chat roots,
   uncertain provider context, preparation results and file-operation obligations
   prevent activation. Resolve these externally against retained originals; do
   not delete evidence simply to pass the check. No automatic resolution is provided.
6. Only a successful report removes quarantine. The application must be stopped
   before selecting the recovered directory. Keep the original directory elsewhere;
   never merge a recovered database with newer receipt journals. A new receipt
   directory creates a fresh admission epoch; recovered SQLite submissions retain
   identity and restart uncertainty. No command is replayed. Recovered pending
   client commands must be inspected, not submitted with replacement identities.
   Reopen exact roots and inspect provider history before an explicit new action.

## Scope and limits

External receipt journals are currently **not included**, so the manifest always
reports their coverage as incomplete. Recovery does not reconstruct those journals
or import legacy stores. This is a conservative partial recovery mechanism, not a
claim of complete storage-milestone acceptance. A complete receipt cut and an
operator-facing provider inspection adapter remain required qualification work.
Spool artifacts are preserved in the export for inspection; they are not installed
as a live cache. Recovery never represents them as resurrected live requests.

WAL synchronous NORMAL supports application-crash recovery but may lose recent
acknowledged metadata after OS crash or power loss. Checkpoint full flushing does
not provide per-commit FULL durability. A recovery copy cannot undo external
filesystem/provider effects or recreate provider history. Checksums detect damage;
they are not signatures against an attacker with write access to the copy. Existing
external-writer races remain. No hardware power-loss or live-provider qualification
is claimed.

## Executed checks

`bun run --cwd apps/desktop test -- host/recovery-copy.test.ts` exercises real
on-disk SQLite backup during writes, preserved original identity/state, quarantine,
wrong owner and altered content rejection, missing referenced spool content,
provider-uncertainty refusal, and authenticated stale Send with zero dispatches and
unchanged external file bytes. The provider inspection seam uses deterministic
results; it does not establish actual installed-provider compatibility.
