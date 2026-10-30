# Reconnect without duplicating work

Implements [Reconnect without duplicating work](https://github.com/ejjsharpe/escode/issues/72)
under the approved fresh-state prerelease amendment. No store import or deletion is introduced.

The shared client releases failed transport sessions and obtains a new authenticated
bootstrap bound to the persisted desktop client and host. Domain query failures retain
the connection. Live observation rebuilds its bounded cache from revision one after
connection failure, gaps, incomplete appends or epoch changes. Duplicate revisions are
ignored; application/validation completes before advancing coverage. Each observation
allows three automatic retries, spaced 500 ms apart, then reports explicit unavailability.
Three seconds without a live batch also initiates recovery (the host emits every 100 ms).
Unsubscribe interrupts observation; socket cleanup never owns provider execution.

Both automatic observation recovery and explicit Open/Retry inspect any locally retained
Send ID through authorized receipt lookup and provider history. They never submit that
command, allocate a replacement ID or clear its text. Missing/expired/nonaccepted receipts
remain explicit warnings, with history still accessible. Retry opens the existing host
session without disconnecting the provider and reloads the visible saved-history page.
Ordinary snapshots do not erase command warnings. Explicit resolution remains the existing
user-confirmed action; accepted pending IDs remain available to the existing Send reconciler.

## Verification

On 2026-10-30, protocol fault tests in `host/reconnect.test.ts` exercise socket loss during
live observation, terminal resnapshot, renewed bootstrap and socket cleanup; and socket
loss after Send dispatch before response delivery, original receipt and history lookup,
missing receipt, stable client identity and exactly one dispatch callback. Existing durable
Send tests cover actual fixture-provider turn counts, retained composer text and explicit
resolution. Existing receipt tests cover old admission epochs and restart uncertainty.

Typecheck, lint, build, packaging and the focused packaged Send workflow passed.
The final full host suite passed 191 tests (four skipped), including both reconnect fault tests.
Early live-disconnect tests failed intermittently before the bounded live timeout was
added; failed runs are not acceptance evidence.

Manual VoiceOver for changed reconnect/error behavior was not performed. The installed
provider live-output opt-in test was skipped; packaged Send uses the existing deterministic
provider fixture. Exhaustive duplicate/reorder/epoch fault injection, multi-client and
revocation qualification remain unperformed; this is bounded full resnapshot, not retained
replay. No production capacity or exactly-once external-effect guarantee is claimed.

Standards review found no violations. Spec review identified missing receipt/history
reconciliation, domain-error disruption and hidden uncertainty warnings; these were
addressed in the final change. Static review does not replace runtime evidence.
