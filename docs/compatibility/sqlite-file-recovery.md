# SQLite file recovery (#122)

The desktop host now passes the existing chat SQLite worker to Workspace and the file-operation journal. Workspace snapshots (including available text and loaded disk baselines) and operation records are keyed by client identity with independently incrementing revisions. A stale writer is rejected. Each replacement is transactional; required Save intent commits before filesystem mutation. Completed Save facts remain recoverable while the existing workspace handoff runs. Filesystem effects remain outside SQLite; recovery never replays Save. Existing checkout identity validation and Save conflict behavior remain in FileOperations/Checkout.

The worker uses the #118 database and durability settings. Recovery bodies are capped at 16 MiB per record, with the existing 64-request worker queue. These are admission limits, not production capacity qualification. Database/WAL/SHM and establishment-marker paths are added to project file-operation protection. The desktop does not read or write the previous client workspace/journal JSON stores. Project approvals remain in their existing host-owned store. No old bytes are imported or deleted.

## Executed evidence (2026-10-31)

- Typecheck, lint and desktop build pass. Full host suite: 33 files passed, one skipped; 305 tests passed, four skipped (before the final stale-writer test).
- Focused SQLite/draft/file-operation/workflow/workspace run: 59 tests passed before the final stale-writer test; the final four-test SQLite recovery suite passes separately.
- Real on-disk SQLite tests preserve independent clients and reject stale same-client writers. Existing JSON sentinel bytes remain unchanged.
- Authenticated host/client Save and workspace routes exercise real files and SQLite trigger-injected intent/outcome failures: failed intent leaves disk unchanged; a failed outcome write reports persistencePending; conflicting Save retains available text and baseline; subsequent external disk changes remain unchanged on uncertain recovery. A counting provider boundary records zero dispatches.
- A Node subprocess commits text, baseline and interrupted Save intent, acknowledges, and is killed with SIGKILL. Reopen retains host/client identities, available text/baseline and operation evidence, with disk unchanged. This checks process-crash storage, not power loss or every possible crash boundary.

## Outstanding qualification and acceptance limits

This is a partial implementation handoff, not completed #122 acceptance. The existing no-database Workspace/journal paths remain for older fixtures; removing that alternate persistence path and converting all affected fixtures is outstanding under the direct-replacement criterion. Packaged Electron fixtures that seed/read client-workspace-v1.json or inject JSON-write failures have not been converted or qualified against SQLite. The new authenticated test wires the real FileOperations boundary, rather than booting the full Electron workflow.

A focused SQLite test of late renderer snapshots following a successful Save remains outstanding (existing late-snapshot tests exercise the older persistence path). Independent client snapshot ownership is tested, but cross-client Save/acknowledgement through a multi-client authenticated host is not qualified. The subprocess test commits interrupted intent without performing the actual native Save in the child; native mutation/outcome SIGKILL windows remain outstanding. No human/native/accessibility checks, physical full-disk simulation, physical power-loss survival, latency measurements or production capacity claims are made. WAL NORMAL may lose recent transactions on OS failure or power loss.

Integration started at 841498a, preserving accepted baseline 0a9c981. Merging the local integration/spec-117-durable-state tip before handoff reported already up to date. No integration branch was modified and no issue/PR operation was performed.
