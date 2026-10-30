# Durable live control

Issue: [Answer live requests and Stop exact active work](https://github.com/ejjsharpe/escode/issues/71).

Replies and Stop use the authenticated WebSocket and the existing durable command
receipt boundary. Control payloads retain operation, selected target and exact request
token/answer. Repeated identities return receipts; a missing receipt can only retry
the same identity and admission epoch. Restart does not replay controls. Replaced
answer/Stop IPC handlers are removed. The existing Send protocol names now also
carry control payloads; no parallel command journal or dispatch adapter is added.

Snapshots expose a provider-session/turn/preparation target. Stop rejects stale
targets before interruption, works without execution-directory validation, and cancels
preparation before provider startup. Native preparation already in progress can finish;
its reserved paths/branches and any partial results remain attached. Cancellation
reports that limitation and never removes resources. Request tokens are consumed
before responding. Session callbacks remain epoch guarded; reused provider wire IDs
invalidate any original token before capacity checks. Effective request presentation
and answer validation are retained.

## Verification (2026-10-30)

- Host chat tests cover duplicate replies, stale targets, reused request IDs at
  capacity, delayed/replaced callbacks and cancellation before provider startup.
- Receipt tests cover exact control payload retention, changed-payload rejection and
  one dispatch per command identity. Existing restart/storage fault checks are reused.
- Availability tests retain missing-directory Stop coverage.
- Full host suite passes after integration with the parallel lifecycle changes; focused
  chat/receipt/availability checks also pass. Typecheck, lint, build and macOS packaging pass.
- Request-identity tracking is capped at 4,096 IDs per provider session; reaching the
  cap retains Stop and requires explicit reconnection before more requests.
- Packaged `tests/concurrency.spec.ts` and `tests/packaged.spec.ts` pass: replies,
  input, scoped Stop, unavailable sibling project, connection loss, focus retention,
  CSS/Monaco and restricted-PATH tools. Development workflow uses the same fixtures.
- Packaged workflow fixtures now allocate distinct wire IDs and await asynchronous
  Stop completion. The packaged API-surface assertion includes the existing socket methods.

Integration with reconnect defers history reads while a Send receipt is admitted or
dispatching, so live requests remain observable before Send acknowledgement. The
packaged delayed-Send/remount workflow exercises this boundary.

Independent Standards review found no required changes. Spec review identified and
resolved preparation self-invalidation of Send, request-ID reuse at capacity, missing
cancellation disclosure and recovery of unadmitted control identities; re-review
found no remaining blockers.

The Stop button now enables for preparation as well as an active turn; its existing
button semantics and focus behavior remain. Manual VoiceOver for preparation Stop
has not been performed. No live Codex turn was consumed. Exhaustive revocation,
multi-device races, process-kill matrices and capacity qualification remain deferred.
