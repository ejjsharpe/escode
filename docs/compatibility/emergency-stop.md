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

## Integration qualification follow-up (2026-10-31)

Isolated branch `t3/issue-125-qualification`, worktree
`/private/tmp/escode-125-qualification`, starts at integration
`d7fd5586a4f428438ca3a58ff00c429d66c0b5bf`; `0a9c981` remains an ancestor.
Integration was merged again before reporting (already up to date).

The merger's retained `test-results/.../error-context.md` contains only
`Test timeout of 45000ms exceeded.` It has no failing operation or cleanup stack.
That exact timeout/cleanup stall was **not reproduced or conclusively diagnosed**.
No timeout was increased and no product behavior was changed.

A fresh unsigned arm64 build/package reproduced a different intermittent failure:
the final effects assertion expected `turn\nstop\n` but received `turn\n` after
both uncertainty disclosures appeared. An unchanged rerun passed in 3.5 seconds.
The fixture previously injected faults immediately after the provider received
`turn/start`, before proving Send had settled. That permits a race with Send
completion and target snapshots; attribution of the observed failure to that race
is an inference, since the initial run did not retain the full alert text.
The regression now waits for the empty composer and visible Running status before
fault injection, and requires `Cancellation requested.` in the alert in addition
to uncertainty/external-effects disclosure and exactly one interrupt. Thus a stale
rejection or failed cancellation can no longer satisfy the disclosure assertions.

Checks in this worktree:

- Fresh renderer/host build and unsigned macOS arm64 package: passed.
- Packaged visible receipt-write-failure test: five consecutive runs passed
  (14.4 seconds total), with normal cleanup and the existing 45-second timeout.
- Final combined packaged SQLite restart and visible emergency Stop: 2 passed
  (5.4 seconds).
- Focused SQLite controls/crash, emergency preparation, chat commands and
  preparation: 24 tests passed across five files.
- TypeScript no-emit check, lint and `git diff --check`: passed.

The focused authenticated tests retain the captured-target, supersession,
authority, no unrecorded non-Stop effects, preparation reservation and prior
command evidence coverage described above. No definite unmet #125 acceptance
criterion was found for receipt-write failure. Complete-worker failure remains
unqualified: authority reads can fail before cancellation. This does not establish
physical full-disk behavior, live Codex behavior or human VoiceOver acceptance.
The earlier merger timeout remains an unresolved qualification limit, rather than
an asserted product defect or an asserted fix.

Environment: installed Bun 1.3.14 rejects this repository's lockfile version 2.
Build/checks reused the integration checkout's installed dependencies via local
node_modules symlinks; no lockfile or dependency changes were made.
