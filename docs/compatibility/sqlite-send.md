# SQLite Send recovery (#119)

Ordinary Send now admits immutable submissions in the host SQLite worker. The admission transaction stores the submitted command, receipt and exact saved chat/provider association together. A duplicate returns existing status; changed payload/target rejects. Missing identities from a previous admission epoch cannot dispatch. Receipts are retained, with a 1,000-submission admission bound and no automatic pruning. Dispatching is committed before provider work; provider effects are outside the transaction. Failed outcome persistence attempts to retain uncertainty and propagates the error. Restart converts admitted/dispatching submissions to uncertain and never dispatches them.

This directly replaces ordinary Send's JSON receipt path. Approval/Stop and file operations retain their existing storage, for their own slices. No old JSON Send receipts are imported or consulted for ordinary Send status. SQLite schema 2 adds the submission table transactionally to the #118 database without changing established identities, chats or revision; missing schema-2 tables fail startup. Provider transcripts and independent client composer recovery retain their existing owners. No product concepts were renamed.

## Executed evidence (2026-10-31)

- Started clean at integration `841498a48c9fb80bf247e583b5bb7144763662d6`, preserving ancestor `0a9c981`. Merging the integration tip reported already up to date.
- Typecheck and lint pass. Full host suite: 306 passed, four skipped (33 files passed, one skipped). The focused four-test SQLite Send suite passed again after outcome-failure handling was strengthened.
- Real on-disk SQLite tests verify immutable duplicate status, changed payload refusal, stale missing identity refusal, admission failure with zero dispatches, and outcome-write failure with retained uncertainty after reopen. SQL triggers inject actual database write failures; assertions use recovered public status and effect counts.
- Authenticated host/client reconnect test runs ChatService against a deterministic provider boundary and observes exactly one `turn/start` across duplicate Send and status recovery. This is fixture-provider evidence, not installed Codex qualification.
- A real Node subprocess persists admission/dispatching evidence, is killed with SIGKILL and reopens uncertain. Re-executing the same identity dispatches zero turns. This process test kills after dispatch evidence, not an actual provider side effect.
- Build and unsigned macOS arm64 package pass. Electron `tests/send.spec.ts`: one passed. Its executable protocol fixture counts actual turn requests and exercises retained submitted text, newer composer text and independent pending text through the app's authenticated boundary.

## Qualification limits

No human checks, live Codex turns, physical power loss, disk capacity measurement or exhaustive multi-client qualification were performed. WAL NORMAL retains #118's OS-crash/power-loss trade-off. No #122 recovery/Save code was changed.

Remaining verification: a combined subprocess crash after an actual external provider turn, a deliberately dropped response at the socket boundary (the host/client test reconnects after receipt), and two independent clients concurrently completing submissions with newer composer revisions. Existing Electron composer tests and independent crash/provider-count tests do not establish those combined cases. These are unqualified portions of #119 acceptance criteria 4–5 and its verification paragraph; full acceptance is not claimed.
