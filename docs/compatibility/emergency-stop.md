# Emergency Stop (#125, spec #117)

Implemented on isolated branch `t3/issue-125-emergency-stop`, starting at
`e1fc441` with `0a9c981` retained in ancestry. No changes to concurrent #123/#124.

Ordinary Stop admission/dispatch-intent write failure offers a separate explicit
Emergency Stop button. The renderer retains the target captured before the failed
Stop, independently of later snapshots. The host keeps a session-local eligibility
record, checks the current admission epoch, and consumes eligibility on execution.
The existing authenticated Send route still authorizes the chat before dispatch;
the existing Stop executor rechecks the exact connection/turn/preparation target.
Emergency cancellation performs no receipt write and returns a visible uncertain,
non-durable result even when the provider acknowledges cancellation. Failed and
superseded cancellation is disclosed. Original command evidence and preparation
reservations are never cleared by this path. No automatic emergency retry occurs.

Verification on 2026-10-31:

- Real temporary SQLite triggers reject ordinary Stop inserts and all outcome
  updates. Authenticated turn checks count cancellation, reject wrong project,
  expired epoch, non-Stop emergency commands, duplicate emergency attempts and a
  superseded target; existing approval/input failures dispatch no response.
- Authenticated scratch preparation with all submission inserts/updates failing:
  one connection and provider preparation, zero turns, retained exact reservation
  and prompt, original dispatching Send evidence intact.
- Focused regression: SQLite controls/crash/lost-response, preparation and chat
  commands: 24 tests passed. Typecheck and lint passed.
- Build and unsigned macOS arm64 package passed. Packaged SQLite restart and
  visible emergency Stop checks: 2 passed, using a counted deterministic provider
  and real failing SQLite writes under the restricted packaged PATH.

Limits: no live Codex or human VoiceOver qualification was performed. Cancellation
cannot undo external effects. Eligibility is intentionally memory-only and does not
survive host restart; restart never replays it. These checks inject real SQLite
statement failures, not physical disk exhaustion or power loss. A wholly unavailable
storage worker may also prevent chat authority reads; this evidence qualifies receipt
write failure, not recovery of a failed execution host.
