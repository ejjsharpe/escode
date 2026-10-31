# SPEC review — R3

Pinned scope: `git diff 0a9c981c9b41d0a6bdf6890cff5a301fdc76ffbb...e3e0437cc7b83b511ea449b80ba3a3b1c0272b70`; HEAD verified. Reviewed against #117, supplied native #118–141 graph, accepted durable-state specification, README/AGENTS/GLOSSARY/tracker and ADRs 0001–0003. Read all four R1/R2 reports and the complete implementation responses. Standalone authorization applies.

**Findings: no additional confirmed missing, incorrect or unasked behavior in the inspected implementation.** This is not complete #117 acceptance.

**Prior objections:**

- **R2 restoration P2 closed.** `apps/desktop/host/restore-checkpoint.ts:33–105` preflights coverage, deletes eligible leaves before removing empty directories, then writes captured leaves. This satisfies “Restore the selected captured saved-file state within declared coverage” for both reported transitions. An independent real-Git reproduction using the current capture/restoration helpers restored exact bytes in both directions (`/tmp/escode-117-spec-repro-r3.ts`). The authenticated restoration fixture additionally passes excluded ignored-file/symlink/nested-repository collisions, original/shared refusal, stale selection, source/index preservation, retained unsaved text and loaded baseline, partial failure and duplicate/restart no replay.
- **R2 structured safety objection closed.** `host/durable-send.ts:33–46`, `host/preload.ts:68–81`, `src/chat-state.ts:197–207` and `packages/contracts/index.ts:97,176` carry explicit Stop eligibility and transfer uncertainty across the boundary. Cancellation remains explicit, authority/target checks remain intact, and uncertain transfer identities remain retained. Neither fallback is newly persisted as a terminal receipt; the expiry classification therefore does not silently change.
- **R1 objections remain closed.** `host/sqlite-worker.cjs:108–116` separates terminal receipts from unresolved evidence without deleting deduplication records; branch copies remain independently retained. `host/historical-files.ts:17–51` orders type transitions; `host/checkpoint-files.ts:2–11` validates shared content before effects; named historical actions preserve receipt identities and dispatch behavior.

Fresh verification: **32/32 passed**, six host suites, one worker/no file parallelism, 162.01 seconds: boundaries, expiry, historical-files, SQLite controls, creation/transfers and emergency preparation. Independent transition reproduction also passed. Other machine workloads were active; this does not establish concurrent reliability. Full-range whitespace checking flags retained evidence logs, not a SPEC finding.

No repository edits, issue writes or PR operations. Full/package/live-provider/manual reruns were skipped; supplied serial/full and packaged evidence is not fresh verification here. Earlier concurrent timeouts remain qualification limits; #141/#117 human VoiceOver/native gates remain open.
