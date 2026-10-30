# Durable Send identity

Implements [Send messages with durable command identity](https://github.com/ejjsharpe/escode/issues/70)
under the [approved prerelease scope](https://github.com/ejjsharpe/escode/issues/61#approved-scope-amendment).

Send uses the authenticated Effect WebSocket. The Electron chat bridge retains its
public Send action but no longer invokes a Send IPC handler. There is one provider
dispatch path. Bootstrap binds sockets to the persisted host and local desktop
principal; receipts bind both identities, command ID, project/chat, admission epoch,
expected state and canonical text payload. Status and repeated submissions recheck
project authorization. Changed payloads/targets conflict before provider dispatch.

The existing fsynced foundation store records admission and dispatch intent before
calling chat preparation/provider work. Its atomic writes fail closed. Existing-chat
Send checks context and a monotonic per-chat operation revision inside the existing
context lock. A successful provider result records acceptance; explicit provider
rejection retains that classification; unknown results remain uncertain. Restart
converts admitted/dispatching receipts to uncertainty and creates a new admission
epoch. No recovery path dispatches stored work. Receipts are never pruned: the shared
1 MiB store ceiling rejects new admission before effects. Capacity management beyond
that ceiling is deferred; uncertainty is never evicted to make room.

The client Chat module persists the command ID and payload through the preload's
owning-origin local-storage adapter before submitting. Failed status/transport results
retain this identity and composer text. A later Send checks the existing ID rather than replacing it. After
inspecting reloaded history, **Resolve previous Send…** offers native confirmation
before releasing that local pending identity. It retains host receipts and unsent
text, dispatches nothing, and warns that a subsequent explicit Send can duplicate
external effects when history remains inconclusive. This is recovery evidence, not
an exactly-once provider guarantee. Local storage and the host's retained receipt
provide independent recovery references; crash-latest-keystroke guarantees are not
introduced. Fresh-state stores, project files and provider history are not imported
or deleted. Existing foundation owner-lock/incomplete-write recovery remains explicit.

## Provider extraction

[The manifest](../../apps/desktop/host/vendor/extraction.json) records the coherent
T3 `effect-codex-app-server` unit qualified on `probe/effect-t3-path`, its upstream
commit, file hashes, generator metadata, schema source and licenses. Production uses
its patched protocol rather than escode's removed handwritten JSONL/RPC transport.
The adapter retains escode domain response/notification handling for provider-version
compatibility, native stream backpressure, the existing 1 MiB ingress bound, timeout,
installation diagnostics, and explicit SIGTERM/SIGKILL process-group cleanup.
Generated typed client/schema sources remain tracked; the generator is excluded from
application typechecking and requires its upstream generation environment.

## Verification (2026-10-30)

- Typecheck, lint, build, package and full host suite passed during implementation;
  final reruns are recorded on the issue resolution.
- `host/send.test.ts`: retained command identity across reopen, old-epoch rejection,
  changed-payload conflicts, actual dispatch callback counts on repeated uncertain and
  accepted commands, injected writes failing at admission/dispatch/result boundaries,
  and store exhaustion before another effect. Restart tests cover admitted, dispatching
  and accepted durable states without redispatch.
- `host/tools.test.ts`: extracted transport initialization, explicit rejection,
  split UTF-8 frames, malformed JSON, oversize ingress and installation diagnostics.
  Existing shutdown tests retain descendant-cleanup coverage. Packaged notices include
  the T3 license, Codex license/notice and the extraction manifest.
- Development Send/history: three passes. Rebuilt packaged Send/history/exact-context
  recovery: four passes. Send fixture records **two actual provider turn/start effects**
  for first Send and one new existing-chat Send; repeat ID, changed payload and stale
  expected state produce no additional effect. It checks explicit local recovery
  retaining text and verifies the authenticated old IPC Send request is rejected.
- Real packaged installed Codex 0.165.0 on Electron 45.1.0 / embedded Node 24.22.1:
  one turn passed through the extracted transport and authenticated live-output path;
  120 observed batches, maximum decoded detail 1,483 bytes, 26 spool files / 7,409 bytes.
  These are single-run observations, not capacity budgets or improvement claims.

The first revision of the monotonic token included ephemeral session allocation and
rejected its own first Send. Development and packaged checks caught this; removing
that allocation-dependent token component fixed it. Failed attempts are not counted
as passing acceptance. The final token changes across serialized context operations
and Send, while admission epochs separately protect host restarts/restores.

The new resolution button uses the existing button/focus pattern and native warning
dialog; existing Retry/Send keyboard paths were exercised by workflow tests. Manual
VoiceOver for this new button/dialog is **not performed**. Exhaustive process-kill
matrices, multi-client/revocation, backup restoration, and broad capacity/provider
qualification remain deferred. Storage fault tests exercise durable boundaries and
fail-closed behavior; they do not claim a full hardware power-loss simulation.

## Standards review

The initial review found one validation defect (false/zero/empty-string receipt
collections bypassed a truthiness guard), now fixed by validating whenever the
property is present. Two judgment calls concerned duplicated schema/receipt handling
and the raw RPC bridge surface. Schema and receipt handling now share their existing
definitions. The raw methods remain the authenticated protocol acceptance seam used
by the provider-effect test. No outstanding required Standards correction.

## Spec review

Three separate review rounds identified and resolved expected-state ABA, receipt
authorization, explicit uncertainty recovery, production T3 reuse, session-allocation
self-invalidation and lost provider-rejection classification. The final independent
review found no remaining substantive Spec defects and approved shipping within the
amended scope. Test execution and manual accessibility limits remain separately
reported above; static review does not establish runtime acceptance.

## Client recovery deepening (2026-10-30)

[`createChatClient`](../../packages/client-runtime/chat.ts) owns pending Send identity,
composer persistence, receipt/history reconciliation and explicit local resolution.
Preload supplies storage, Electron flushing and native confirmation; the shared
transport invokes the module's reconciliation before each live subscription attempt.
Storage keys and command formats are unchanged. Stop, replies and Files commands
retain their existing paths.

Send returns the remaining composer text to React, which preserves any newer local
edit rather than clearing unconditionally. Accepted identity release waits for the
composer flush request to succeed; a failed flush retains the original identity for
a status-only retry. Resolution preserves text recovered solely from an existing
stored Send. Overlapping Send/resolution calls and invalid retained commands fail
without redispatch or deletion of the retained identity.

Resolution also preserves an explicitly empty saved composer; pending text is used
only when the composer key is absent. The regression test first reproduced deleted
text returning, then passed with the shared composer fallback corrected. All 26
focused client Chat and host Send tests, typecheck and lint passed after this fix;
the broader checks below were not repeated.

Verification: typecheck, lint, build and packaging passed; the full host suite passed
248 tests with four opt-in skips. Seventeen `host/client-chat.test.ts` cases exercise
the module interface with storage/transport failures and delayed results. The real
socket tests in `host/reconnect.test.ts` now exercise module-owned recovery, including
receipt/history lookup on automatic reconnect and a lost accepted Send response.
Seven focused Electron scenarios passed across Send, history, project drafts, scratch
chats and concurrent controls; Send and both history scenarios also passed packaged.
The Send scenario retains newer text through delayed acceptance and app restart and
still observes exactly two fixture-provider turns despite repeated receipt queries.

The initial Electron run found outdated void-return assertions and a test racing the
restored chat's startup. Updating the return assertions and awaiting composer readiness
resolved those failures. Real-provider opt-in checks and manual VoiceOver were not run.
Electron flushing remains best effort; these checks do not establish crash-latest-text
or exactly-once external-effect guarantees.
