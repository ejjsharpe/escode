# Checkpoint capacity and reclamation (#139)

Isolated implementation starts at integration `8edb20e`, preserving `0a9c981`.
Uses the existing host SQLite authority, capture and inactivity protection rules.
No dependency or application storage format change.

## Selected bounds

Keep the measured existing 48 MiB available-checkpoint budget with 64 MiB total
checkpoint metadata budget (the difference leaves missing-coverage headroom).
Retained rewind/branch copies now have a separate 64 MiB aggregate body budget,
in addition to the existing 1,000 record limit. Replacement charges only the new
body, including completion replacement. No protected record is evicted on failure.
At most two Git/file captures run concurrently; excess captures record an unavailable
boundary immediately rather than waiting in another queue. Capture retains 10,000
file, 8 MiB raw-file, 15 second deadline and 4 MiB Git-output limits. SQLite requests
retain the existing 64 pending / 32 MiB serialized queued-byte admission limits.
These are operational guardrails, not a physical disk or production capacity guarantee.

Expiry removes at most 100 eligible file payloads per transaction. The existing
activity/live/preparation/recovery/uncertain protections remain. Branch copies are
independent protected payloads and are never deleted. After expiry, an opportunistic
SQLite WAL checkpoint uses zero busy timeout: readers may prevent truncation and a
later cleanup retries. Freed main-database pages are reused, not VACUUMed; apparent
snapshot size is not a promise of released filesystem bytes. There are no synthetic
Git checkpoint objects in this implementation: no Git GC, project-object deletion,
worktree deletion or provider-history mutation is authorized by this cleanup.

## Executed local qualification

TDD failures before changes: expiry left a 4,321,912-byte WAL; retained branch
copies exceeded the new 64 MiB budget; three simultaneous Git scans all ran.
Each passed after the corresponding implementation. Tests use the real worker,
SQLite, filesystem and Git. Existing expiry tests cover a controlled clock,
recovery drafts, retained branch copies, pending completions, uncertain receipts,
100-record batches and rollback on deterministic failure. Durable Send tests
retain fail-closed ordinary admission and captured-target emergency cancellation.

Local 47 x 1 MiB serialized file-payload growth/exhaustion/reclamation run took
2,090 ms; main database was 50,462,720 bytes before and after expiry and reuse.
The WAL truncated to zero; the retained branch copy survived. No physical main-file
shrink is claimed. This exercises active history without expiry; Never-specific
configuration qualification depends on concurrent #138 integration.

Unsigned packaged Electron build with real SQLite load repeatedly filled available
capacity and reclaimed eligible payloads while exercising the actual editor and
command controls. Two packaged tests passed (24.9 s). Fill/cleanup cycles took
2.22–3.25 s; observed main files plateaued around 49–52 MB, WAL zero after successful
unblocked cleanup. Recovery drafts temporarily prevented reclamation and capture
remained exhausted until protection cleared. Journey timings under load:

- Edit: 180.7 / 57.5 ms.
- Save: 3,028.9 / 2,372.8 ms.
- Send: 890.8 ms; ordinary Stop: 1,881.7 ms; emergency Stop: 29.6 ms.

These are one local run per scenario, not percentile claims. The opt-in
`ESCODE_CHECKPOINT_LOAD=1` helper runs against the packaged app's actual store.
Provider protocol is deterministic; no paid/live provider capacity is inferred.
Save latency of roughly three seconds is an observed qualification limit, not an
assertion that every workload is responsive. No physical ENOSPC, power-loss,
manual accessibility or production capacity qualification was performed here.
