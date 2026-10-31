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
shrink is claimed. This exercises active history without expiry. After merging integration
`6f036e0` (#138), the same exhaustion test selects Never, proves cleanup retains
all available files, rejects another capture, then selects 30 days and reclaims
eligible payloads.

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

## Combined-tip checks

Merged integration `6f036e0` into this branch; `0a9c981` remains an ancestor.
Final focused capacity/expiry/durable-Send suite: **15/15 passed** (27.57 s).
Typecheck, lint, build and unsigned packaging passed on that merged source.
The broader boundary run passed its boundary and capacity/Send files but began
before the integration merge and loaded #138 expiry tests against already-imported
pre-merge service/client code (two missing-method failures). That mixed-source
run is not a final combined-tip pass; the clean 15-test rerun above passed both
#138 expiry cases. Prior boundary results are supporting regression evidence only.

Rebuilt combined-tip packaged follow-up: **2/2 passed** (17.5 s). Editing
157.6 / 76.3 ms; Save 807.8 / 892.2 ms; Send 890.9 ms; Stop 877.1 ms;
emergency control 36.6 ms. Full fill/cleanup cycles 2.35–2.75 s; main database
plateau 51,601,408 bytes; WAL zero at observed cleanup boundaries. Earlier slower
measurements above remain part of the record. No known criterion remains unmet
at these bounded automated seams; no human/live-provider or production-capacity
acceptance is claimed. Reclamation deliberately retains reusable main-file pages
and all protected evidence rather than promising disk shrink or deduplicating
protected live history. No issue closure, PR or merge into integration was done.

## Load qualification follow-up: acceptance remains open

Fresh isolated checkout at `7a37f9f`, preserving `0a9c981`; merged current
integration `0ba393e` before reporting. This supersedes the earlier statement
that no known criterion remains unmet. No production change, admission bypass,
protected-data deletion, issue closure, PR or integration merge was made.

The original loaded packaged control fixture failed **2/3** repetitions with
`database is locked` while installing its fault triggers, before Emergency Stop.
Its external SQLite connection had no busy timeout while the load connection
continuously wrote. Fixture setup now acquires a writer transaction with a bounded
3-second SQLite busy timeout and installs both denial triggers atomically. It
never retries Stop or a failed effect. Three subsequent loaded control repetitions
passed; setup lock acquisition took 1610.3 / 10.5 / 0.8 ms. This is setup time,
not emergency cancellation latency. Failure beyond the bound still fails the test.

Save now records click-to-enabled completion in the renderer separately from the
outer Playwright disk/assertion timer. The test still verifies exact disk bytes.
Test-only main-process worker instrumentation records request round trips without
changing request payloads or routing. Three final loaded editing repetitions and
three control repetitions passed (**6/6**, 1.1 minutes):

- Editing: 53.6–142.2 ms (six samples).
- Renderer Save: 2288.9 / 2796.2 / 1946.0 / 7071.3 / 1227.3 / 2022.5 ms.
- Outer Save including automation/polling: 1779.2–7670.9 ms.
- Send: 905.7 / 1891.0 / 2905.8 ms.
- Ordinary Stop: 116.7 / 1875.0 / 130.8 ms.
- Emergency Stop: 52.3 / 29.0 / 86.8 ms.

App-worker requests reached 3831.3 ms (recoveryRead) and 2864.7 ms
(recoveryWrite). Thus polling overhead alone does not explain the Save stalls.
The load fixture uses a second database worker/connection, continuously fills
47–48 one-MiB payloads and repeatedly tries expiry even when recovery protection
prevents progress. This differs from production's one host worker and 60-second
cleanup timer. No-progress fixture cycles can spin dozens of times. Measured
contention under this harness cannot establish production responsiveness or its
root cause. No blind retry or reduced load was used to turn the timing result
into an acceptance claim.

Two additional packaged editing tests without checkpoint load passed (17.1 s).
Their four renderer Save samples were 1705.2 / 1219.6 / 881.5 / 497.3 ms;
outer timers were 2799.2 / 1495.8 / 1796.8 / 628.5 ms. Other agents were running
checks on this installation; these are observations under shared-machine load,
not isolated benchmarks. The packaged binary was built at `7a37f9f`; final source
includes integration `0ba393e` (client reconnect changes), so these are not a
packaged qualification of that merged tip.

Build, unsigned packaging, typecheck and lint completed (lint retains existing
warnings). Final merged-source focused host run with one worker: **33/34 passed**
(58.52 s), including capacity, expiry, SQLite recovery and controls. The durable
Send dropped-response/reconnect case timed out at 15 seconds. An earlier concurrent
run passed 32/34 with that timeout and an inactivity assertion failure; the
one-worker run passed the inactivity case. These failures are retained, not
represented as clean qualification.

Exact unmet work: explain and fix actual multi-second Save latency at the
production authenticated seam; qualify capture/cleanup through the production
single-worker scheduling path; resolve the dropped-response host regression;
rebuild/requalify the merged tip. Human accessibility/native checks, live-provider
work, physical ENOSPC/power loss and production capacity remain unperformed.
Issue #139 is not complete on this evidence.

## Save root cause and single-worker follow-up

Isolated `fix/139-save-rootcause` started at integration `0ba393e`, then merged
exact partial qualification `1aa09cf495eaf19a44bb0bba858fc24800ffda99` and
integration `298b243` (#140). `0a9c981` remains an ancestor. Standalone #117
implementation and its confirmed host/client and packaged test seams apply.

The competing-connection fixture reproduced a 1,591.9 ms renderer Save with a
1,388.6 ms recovery write. Native Save helper operations were approximately
3–5 ms each; neither their sum nor assertion polling explains that stall.
Moving load to the actual app worker removed the competing SQLite writer, but
exposed a production cleanup stall: three full-store cleanup requests took
602.6–743.9 ms and queued recovery reads reached 609.0 ms. This distinguishes
external lock contention from production worker scheduling.

The cleanup candidate query correlated a pending-completion scan with every
candidate checkpoint. With 47 one-MiB JSON payloads it repeatedly parsed the
same large bodies. The minimal production change selects pending chat identities
once with an uncorrelated subquery. Checkpoint chat identities are NOT NULL;
all existing activity, pending completion, recovery, branch, uncertain receipt,
capacity, intent and admission protections remain. There is no effect retry,
validation bypass or protected evidence eviction.

TDD: the existing real-worker capacity seam now requires full-store cleanup
under 300 ms on this local qualification workload. Before the query change it
failed at 1,403.7 ms; afterward it passed at 106.0 ms. Main database remained
50,466,816 bytes before/after reclamation (reusable pages, no shrink claim).
The latency budget is a regression guard for this workload, not a production SLA.

The packaged fixture injects one request at a time into the app worker mailbox
using separate negative test request IDs, rather than opening another writer.
It waits for an initial complete fill/reclaim cycle before interaction and pauses
100 ms after no progress. This exercises the production worker and SQLite query,
not real Git capture scheduling or DurableState queue admission; those remain
covered separately by host tests. Production cleanup remains periodic. Native
helper and worker timings are test instrumentation only. Prior failures and
multi-second results above are retained.

Merged-source checks: typecheck, lint (existing warnings), build and unsigned
packaging passed. Sequential host suite (capacity, expiry, durable Send, recovery,
controls and recovery copies): **41/41 passed**, 23.59 seconds. The formerly
failing dropped-response/reconnect case passes; no reconnect production change
was needed on the current history-cancellation-fixed integration source.

Final packaged verification on merged production source `55a5a2c` (including
#140): **6/6 passed**, 35.6 seconds, one Playwright worker, after the host run
finished. No other Playwright/test-runner process was observed at the handoff
between those runs; this is still a shared installation, not controlled hardware.
Every test completed an initial 47 x 1 MiB fill/reclaim cycle (2.26–2.70 seconds)
before interaction. Observed WAL was zero at successful cleanup boundaries.

- Renderer Save: 328.2 / 391.1 / 356.9 / 354.2 / 360.8 / 389.5 ms.
- Outer Save: 432.9–585.7 ms; editing: 98.6–171.8 ms.
- Send: 398.5 / 396.0 / 407.1 ms.
- Ordinary Stop: 143.9 / 168.5 / 142.5 ms.
- Emergency Stop: 107.1 / 63.7 / 145.9 ms.
- Slowest observed cleanup request across editing runs: 198.9 ms;
  recovery requests in those slowest-request lists reached 72.2 ms.

These are bounded samples, not percentile or general production responsiveness
claims. No known implementation gap remains for the measured workload. Human
accessibility/native validation, live-provider work, physical ENOSPC/power loss,
and wider production capacity remain unperformed. No issue closure, PR or merge
into integration was made. The final fixture/evidence commit does not change
the packaged production source just qualified.
