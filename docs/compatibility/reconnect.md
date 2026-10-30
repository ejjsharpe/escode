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

## Shared-session admission and failure isolation

On 2026-10-30, `host/host-client.test.ts` reproduced two failures through the
production `createHostClient` / `startHost` loopback path: twenty held directory
listings rejected an unrelated `sendState` request at ordinary admission, and a
summary domain failure interrupted an unrelated in-flight query. Both tests failed
before the correction and passed afterward.

Directory rescans now have their own four permits and 10,000-request admission
bound; ordinary queries retain four permits and their 16-request bound. Thus at
most eight unary requests execute concurrently through the same authenticated
session. A held four-listing batch no longer prevents control-state queries from
progressing. Listings retain their ten-second timeout; ordinary queries retain
35 seconds, with native-consent operations exempt as before. This does not reserve
control capacity against other ordinary queries or change the host's total
request/stream admission limit.

Unary, listing, directory-watch and summary execution share Effect-cause handling:
contract domain failures retain the connection; non-domain failures retire only
the session on which they occurred. Live chat recovery uses the same domain
classification and retains its existing resnapshot policy. Summary observation
still retries at 500 ms; neither mutations nor prompts are replayed. Observation
cancellation releases subscriptions without closing healthy unrelated traffic.

Bounded fixtures cover held listings against a real temporary directory, in-flight
query survival and summary recovery on one socket, actual socket loss and renewed
summary authentication, watch cleanup and watch transport failure. These are local
loopback checks, not production capacity, remote trust or provider qualification.

Validation for this correction: the focused host-client/reconnect/client-chat/
client-recovery/Send run passed 34 tests in five files (before the final standalone
watch-failure test); the host-client/directories/git-observation run then passed
20 tests in three files, including all four new host-client tests. Both runs used
`--maxWorkers=2`. `bun run typecheck`, `bun run lint` and `git diff --check` passed.
Integrated build/package/Electron checks are left to the parent integration run;
no real provider turns or manual accessibility checks were performed here.

## Combined host/client integration

On 2026-10-30, combined code commit
`6ecb8180d4a4db4e6344f7c9cc8e5da1a4063cf9` merged host Chat ownership
(`671746e31425ec3cea975743b4933329c6864b35`) and client admission/failure isolation
(`2d2fe8ec10f5319910b22fc09d819f8558714906`) without conflicts. Each implementation
received an independent GPT-6.1 Sol extra-high review with a Ship verdict at its
exact commit. The separate Files recovery investigation and independent review
found no justified change to the existing persistence/acknowledgement handoff.

Validation in a dedicated integration worktree passed:

- Full host suite: 264 passed, four opt-in provider checks skipped, using
  `bun run --cwd apps/desktop test -- --maxWorkers=2`.
- Desktop typecheck, lint, build, macOS arm64 packaging and baseline-to-HEAD
  whitespace checks.
- Thirteen development Electron scenarios across `send`, `history`,
  `project-drafts`, `worktree-drafts`, `scratch`, `concurrency`, `files-watch`
  and `files-tree`.
- Eight packaged scenarios across `send`, `history`, `project-drafts`,
  `worktree-drafts` and `files-watch`, using `ESCODE_PACKAGED=1` and the fixture's
  restricted PATH. All app checks used temporary state and controlled providers.

The first host attempt in the shared root checkout was invalidated by checkout
switches during execution: the runner loaded mixed old/new files and lost the new
transport test file. Its failures are not counted as a coherent regression result;
the dedicated-worktree full run above passed without source changes.

The first thirteen-scenario Electron run passed twelve and timed out once waiting
five seconds for the generated tree's 200 root rows (zero observed). That scenario
then passed alone. All nine scenarios in three complete Files-watch repetitions
passed on both unchanged baseline `fc8643912b79fab9279256cde75e9af0843bf9a1` and the
combined code, followed by the full thirteen-scenario rerun and eight packaged
checks above. The timeout's cause remains unclassified; no source change or timeout
relaxation was used to obtain the passing runs.

No real provider turns, new manual accessibility check, exhaustive multi-client
test or production capacity qualification is claimed. Synchronous Git remains
noncancellable; started preparation retains possibly partial resources. Ordinary
queries can still contend for control admission. Existing best-effort recovery,
cross-process filesystem races and absence of exactly-once external-effect
guarantees remain. Packaging retains the existing default icon, unsigned-build
and large renderer-chunk notices.
