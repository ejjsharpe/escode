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
- Typecheck, lint, build and macOS packaging pass on the local installation.

The Stop button now enables for preparation as well as an active turn; its existing
button semantics and focus behavior remain. Manual VoiceOver for preparation Stop
has not been performed. No live Codex turn was consumed. Exhaustive revocation,
multi-device races, process-kill matrices and capacity qualification remain deferred.
