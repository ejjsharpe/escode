# Standards review — R3

Pinned comparison: `git diff 0a9c981c9b41d0a6bdf6890cff5a301fdc76ffbb...e3e0437cc7b83b511ea449b80ba3a3b1c0272b70`; HEAD verified. Scope: entire #117/native #118–141 implementation, including `bc68195`. Read all four R1/R2 reports and all responses in `docs/compatibility/durable-state-review-fixes.md`.

Sources: AGENTS, README, GLOSSARY, tracker, ADRs 0001–0003, foundation/durable-state specifications, #117 and supplied native graph. Standalone authorization applies. No additional CODING_STANDARDS/CONTRIBUTING found. Applied the supplied smell baseline as heuristics; excluded tooling-enforced style and non-substantive preferences.

**Hard documented-standard breaches: none established. Additional actionable smell findings: none established.** No introduced regression was confirmed in the inspected paths.

Prior objections checked:

- **R1 action classification:** `packages/contracts/index.ts:229`, `host/chat-service.ts:529` and `src/boundaries.tsx:9` retain one named `HistoricalAction`; dispatch derives its flags from that action.
- **R1 validation drift:** `host/checkpoint-files.ts:2` supplies canonical content/mode/path/capacity checks before historical branch effects and to restoration/recovery validation. Malformed-content tests assert unchanged files/index.
- **R1 expiry and branching:** `host/sqlite-worker.cjs:113` distinguishes completed receipts from unresolved evidence without deleting deduplication records; `host/historical-files.ts:18` orders covered deletions before replacements. This preserves the specification’s “nonterminal/uncertain receipts” protection while allowing ordinary completed commands to expire checkpoints.
- **R2 restoration:** `host/restore-checkpoint.ts:39–90` preflights excluded contents, deletes covered leaves, removes only empty directories and applies replacements. The authenticated fixture exercises both transition directions, ignored/symlink/nested-repository refusal, preserved source/index/client recovery, and duplicate/restart no replay.
- **R2 message-driven safety:** `host/durable-send.ts:36,46`, `host/preload.ts:68,81`, `src/chat-state.ts:201` and validated contracts now carry explicit emergency eligibility/transfer uncertainty. Human wording no longer decides either safety action, consistent with foundation guidance for “typed unavailable/conflict/stale/denied/incompatible/overflow/uncertain results.”

Fresh verification: **32/32 passed**, six focused host suites, 163.46s; log `/tmp/escode-117-standards-r3-tests.log`. This run used one worker/no file parallelism but overlapped another review’s suite; it is not isolated serial qualification.

No repository edits or issue/PR operations. Skipped full/package/manual reruns. Supplied serial passes do not settle concurrent reliability; #141/#117 human VoiceOver/native gates remain open. This is not complete acceptance.
