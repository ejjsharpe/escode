# Authenticated directory listings

Implements [Browse directories through the authenticated host](https://github.com/ejjsharpe/escode/issues/65) under the approved fresh-state delivery amendment. Directory queries use portable Effect Schema/RPC contracts, a host transport independent of Electron/React, and a portable client runtime. Electron supplies validated bootstrap, the existing approved-project authority and native descriptor-checked filesystem adapter. Files no longer has a directory-listing IPC route or fallback. Watches and other domains retain their current paths for subsequent tickets.

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
