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

## Acceptance-gap follow-up (2026-10-31)

Started with a clean isolated checkout at `841498a`, verified the accepted `0a9c981` ancestor, and fast-forward merged `implement/119-sqlite-send` at `694d307a77c9835c6aec5c9969f1fc418b09dda2`. No #122 files or product terminology changed.

- **Deliberately lost response:** the WebSocket fixture intercepts and discards the incoming accepted receipt frame before the RPC client sees it, then terminates the socket. The original Send rejects. A fresh authenticated connection retrieves accepted status and repeats the immutable identity with exactly one provider `turn/start`.
- **Crash after actual effect:** a bundled Node subprocess runs the authenticated host/client, real SQLite worker, Chats and ChatService. Its deterministic provider appends one external effect record when handling `turn/start`, then blocks before returning. The parent waits for that completed append, sends SIGKILL, and opens the same SQLite directory through a new authenticated host. Status and duplicate Send return uncertain; a missing identity with the old epoch rejects. The external effect file remains exactly one record. The recovered dispatch callback would append another record if replay occurred.
- **Concurrent independent client revisions:** two separate authenticated RPC connections and ChatClient instances, with separate recovery adapters, submit distinct identities against the same saved association. Both dispatches remain blocked while each client edits its composer. Completing the first preserves the other pending identity. Both newer composers survive completion and client recreation, including editing away from and back to the originally submitted text. The fixture exercises independent client instances under the existing host-issued installation identity; it does not claim remote/multiple principal authorization coverage.
- The revision case initially failed: the earlier completion erased newer text that happened to equal the submitted text. Each composer edit now persists a fresh revision token; completion clears text only while both its captured revision and submitted text still match. No new dependency or host storage path was needed.
- Typecheck, lint, build and unsigned macOS arm64 packaging pass. Full host suite: 307 passed, four skipped (33 files passed, one skipped). Focused Send/client suite: 23 passed; the strengthened ChatService subprocess fixture subsequently passed all five Send tests. Electron `tests/send.spec.ts`: one passed.

The final full-suite rerun after strengthening the ChatService subprocess case had 306 passes, four skips and one unchanged worktree test timeout (15 seconds: “creation uses the displayed commit and preserves every category of local edits; reuse discovers real metadata”). The earlier full run passed all 307 tests. Rerunning the unchanged worktree file together with the final Send and client-composer suites passed all 40 tests (three files).

These checks close the previously listed deterministic verification gaps for criteria 4–5. They do not establish live-provider behavior, physical power-loss durability or the deferred exhaustive multi-client matrix. The WAL NORMAL qualification limits above remain applicable.
