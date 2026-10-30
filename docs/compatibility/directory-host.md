# Authenticated directory listings

Implements [Browse directories through the authenticated host](https://github.com/ejjsharpe/escode/issues/65) under the approved fresh-state delivery amendment. Directory queries use portable Effect Schema/RPC contracts, a host transport independent of Electron/React, and a portable client runtime. Electron supplies validated bootstrap, the existing approved-project authority and native descriptor-checked filesystem adapter. Files no longer has a directory-listing IPC route or fallback. Directory watches now share that connection as recorded below; other domains retain their current paths.

The persistent foundation host/client identities exist before endpoint publication. The server binds only `127.0.0.1` on an ephemeral port. Bootstrap IPC checks sender, main frame, exact document URL and arity. Bootstrap validates wire revision, literal-loopback endpoint, identity binding, credential shape and expiry. Upgrade checks exact Host, `/directories`, Origin (`file://` for this installation's Chromium file pages, exact development origin otherwise), host identity and wire revision. Random 256-bit tickets expire after ten seconds and are single use. Credentials never enter logs or persistent storage. CSP admits only the actual local socket origin (plus development HMR).

Only already-open approved checkout objects reach the existing native adapter; project session, checkout identity, removal and quit are rechecked. Traversal, `.git`, absolute paths, protected state and symlink escapes cannot produce listings. Contracts distinguish available, denied, unavailable and overflow; existing Files error presentation retains retry through Refresh. Existing tree, ignore filtering, reveal, keyboard/focus and platform actions remain in place.

Initial defensive limits: eight outstanding bootstrap tickets, eight active sockets, sixteen pending requests per socket, sixteen concurrent handlers, 1 MiB incoming frames and 512 KiB encoded listing data, 2 MiB total encoded responses per socket and a fifteen-second server connection lifetime. Client queries run four at a time with at most 10,000 admitted queries, so normal tree rescans do not exhaust bootstrap admission. Exhaustion rejects admission rather than queuing unbounded requests. Invalid envelopes poison that connection with one defect response; later frames are ignored until disconnect. Read queries have a ten-second client deadline, release their socket scope and do not retry automatically. Listings currently use one scoped connection per query; persistent shared sessions and directory subscriptions belong to subsequent synchronization work. Native listing/filter calls retain their existing synchronous helper execution; no event-loop performance improvement is claimed.

## Reproduce

```sh
bun run --cwd apps/desktop test -- host/directories.test.ts
bun run typecheck
bun run lint
bun run --cwd apps/desktop test -- --maxWorkers=1
bun run build
bun run --cwd apps/desktop smoke -- tests/directory-host.spec.ts tests/files-reveal.spec.ts tests/file-operations.spec.ts tests/foundation-state.spec.ts
bun run package
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/directory-host.spec.ts tests/files-reveal.spec.ts tests/foundation-state.spec.ts
```

Protocol tests exercise credential/header/path/identity/revision rejection, expiry, replay, malformed payload/envelope rejection, oversized frames and ticket exhaustion, stalled-adapter request exhaustion and stalled-receiver response exhaustion, followed by healthy dispatch. Packaged Files tests exercise actual listing, denied roots/path escapes, removed IPC, tree memory, filtering and reveal/focus behavior. Crash/relaunch fixtures explicitly remove only their test-owned stale foundation lock after confirming process death, matching the storage slice's explicit recovery requirement; production never steals a stale lock.

## Source and distribution

Composition adapts the qualified disposable probe at `36ed63490fa2fa3e1fd0573540a334ca92fc2e32`, following T3 pin `305a90dce44b8b7813d951662f13ce8510a3c669`. No Codex vendor source enters this directory slice. T3 MIT attribution is retained in `packages/host/T3-LICENSE`. Effect/core and Node adapters remain exactly 4.1.0 with ws 8.22.0 and the probe's installed Redis/Undici peer closure; bun.lock pins it. Host build derives dependency versions/licenses and notices from emitted bundle inputs, packaging them under `dist/host/foundation-{dependencies.json,NOTICES.txt}`. Portable contracts/client are bundled into the sandboxed preload; only Electron is external there.

## Evidence and limits

Recorded installation is the same macOS 26.3.1 arm64, Electron 45.1.0 / Node 24.22.1 / Chromium 156.0.8078.49 installation qualified in the prerequisite probe. No live provider turn is required by this read-only slice. New manual VoiceOver evidence is not claimed; unchanged native Finder/clipboard and user-owned manual limits remain in the Files acceptance record. Keyboard/focus checks are automated, not VoiceOver validation. Broad provider/platform, multi-client/revocation and capacity qualification remain deferred. Existing legacy stores and external resources are neither imported into the foundation store nor deleted by this slice.

Verification on 2026-10-30 at `b203007`:

- Typecheck, desktop/workspace lint, diff whitespace, frozen Bun 1.4.4 install, build and package passed.
- Full serial host suite: **168 passed, four existing opt-in skips** (63.21 seconds).
- Five focused protocol tests passed, including request admission while the adapter stalls and output exhaustion while a receiver pauses reading. Healthy clients still complete after exhaustion.
- All sixteen focused development desktop tests passed (44.6 seconds), exercising the actual WebSocket, twenty simultaneous listing calls, path/root denial, IPC removal, reveal/filter memory and focus, explicit-recovery relaunch, protected state and Files preservation.
- All seven focused packaged ASAR/restricted-PATH tests passed (19.2 seconds), including actual directory contracts, reveal/filter controls, unavailable/replaced checkout and quit handling, and persistent identities across relaunch.
- Independent final Standards and Spec reviews each reported zero findings. Initial Spec findings about rescan fanout and stalled delivery were fixed and covered before acceptance.

Runtime changes do not introduce new controls or keyboard interactions. Existing automated focus/reveal assertions were rerun through the new path; new manual VoiceOver operation remains unverified. Generated test outputs and abandoned disposable test processes/directories were cleaned; current build/package outputs remain available for inspection.


## Authenticated directory watches

[Keep loaded directories current through host watches](https://github.com/ejjsharpe/escode/issues/66)
replaces the `files-watch`/`files-changed` IPC domain. The preload creates one scoped
RPC client for directory queries and streams, closes it on unload, and never falls
back to IPC. Refresh/focus can establish a new connection after failure; subscriptions
are cancelled on view disposal. Bootstrap remains the native authorization boundary.

`watchDirectories` validates root and up to 10,000 relative paths. Composition checks
approved checkout, session, protected app-state paths, removal and quit; the existing
Project adapter checks exact directory identity, no-follow ancestors and metadata.
It shares each physical watch across interested views and closes it after the final
release. Stream scope releases the adapter on interrupt, disconnect and host shutdown.

Subscription readiness triggers revalidation after installation, closing the gap
between an earlier listing and watch setup. Files rebinds after ordinary changes to
follow replaced directory identities. Readiness itself does not trigger another
subscription. Refresh/focus retries degraded watches and rescans loaded folders;
expansion still revalidates cached folders. Epoch/context guards reject old listings
and reveal results. Notifications wait for inline editing or an active reveal to
finish, retaining text, focus and available unsaved buffers.

The former fifteen-second socket lifetime is removed for subscriptions. Each stream
has one sliding pending invalidation, retaining a watch failure until resubscription.
The 2 MiB encoded response budget applies to unacknowledged stream delivery, resetting
on ACK; consumed unary replies do not accumulate against a lifetime quota. Individual
responses and physical socket buffering remain bounded. Eight socket/ticket admission,
sixteen pending requests per connection, four client listing permits, 10,000 admitted
queries, 1 MiB frames, 512 KiB desktop listing payloads and ten-second read deadlines
remain. Admission rejection ends the offending connection and releases its watches.
These are defensive limits, not measured capacity claims.

Reproduce with the protocol and native-watch host tests, the full serial host suite,
typecheck/lint/build/package, then `tests/directory-host.spec.ts`, `tests/files-watch.spec.ts`,
`tests/files-tree.spec.ts` and `tests/files-reveal.spec.ts` in development and with
`ESCODE_PACKAGED=1`. The tests cover listing and streaming on one authenticated socket,
watch failure, interrupt/disconnect release, cumulative healthy listings over 2 MiB,
shared physical watches, loaded/collapsed convergence, directory replacement followed
by another external write, final-view resource release, dirty edits, inline-edit and
reveal focus, missed-event recovery, and forced RPC disconnect/Refresh recovery.

The installation remains macOS 26.3.1 arm64, Electron 45.1.0 / embedded Node 24.22.1,
Bun 1.4.4, Git 2.50.1 and installed Codex 0.165.0 as recorded in the prerequisite
installation evidence. No live provider turn is needed for this slice. New manual
VoiceOver is unverified; automated keyboard/focus checks are not VoiceOver evidence.
Existing native Finder/clipboard exclusions and practical external-writer race limits
remain. No old stores, project files, provider history or existing worktrees are
imported or deleted. Broad compatibility, exhaustive multi-client/revocation and
capacity qualification remain deferred under the approved amendment.

Initial verification exposed a readiness/reveal race, old IPC interception fixtures,
and crash fixtures missing explicit test-store lock recovery. Those were corrected.
The Spec review also identified cumulative unary response accounting and missing
client disconnect recovery coverage; both were corrected and given regression checks.
The Standards review found no rule violations and one optional suggestion to share
small native-event suppression fixtures; those remain local to their scenarios.

Verification on 2026-10-30, runtime source `44076ef` with the final test-fixture
emitter-restoration correction committed alongside this record:

- Typecheck, lint, whitespace checks, build and unsigned macOS arm64 package passed.
- Full serial host suite: **170 passed, four existing opt-in skips**, 65.65 seconds.
- Seven protocol tests passed, including healthy cumulative unary traffic over 2 MiB;
  combined protocol/native-watch checks passed before that final regression was added.
- All **eleven focused development** scenarios passed, 58.6 seconds, and all
  **eleven packaged** scenarios passed, 40.8 seconds.
- Final Files watch suite reruns after restoring the fixture's suppressed native
  emitter: **three development passes** (12.1 seconds) and **three packaged passes**
  (11.9 seconds). These include actual forced-disconnect recovery with retained
  dirty text and subsequent automatic listing convergence, replacement-directory
  delivery and final-view physical-watch release. The earlier fixture attempt failed
  its post-disconnect convergence assertion; it is not counted as acceptance.
- The final development generated fixture (200 folders / 20,000 files) observed root
  display at 676 ms, expansion at 48 ms, two arrow keys at 63 ms, external convergence
  at 171 ms; packaged observations were 678/110/9/251 ms respectively. These single
  observations are diagnostics, not performance budgets or improvement claims.

### Standards review

No documented-rule violations. One P3 judgement call suggested sharing duplicated
native-event suppression setup; the small process-local fault injections remain in
scenario fixtures. No outstanding required Standards correction.

### Spec review

The initial cumulative-unary-budget and missing-disconnect-coverage findings are
resolved. Follow-up review found no additional production-code defects and identified
that the disconnect fixture must restore native delivery first; the final committed
fixture does so, with development and packaged reruns above. No outstanding Spec
correction. Manual VoiceOver and deferred qualification remain unverified.
