# Fresh foundation state

Delivery for [Initialize fresh versioned host/client state](https://github.com/ejjsharpe/escode/issues/64), under the [approved prerelease amendment](https://github.com/ejjsharpe/escode/issues/61#approved-scope-amendment).

Desktop main opens `userData/foundation` before creating a window or registering domain handlers. Its single host-owned `state.json` contains storage version 1, stable host and desktop-client UUIDs, and new-format context records. No endpoint is published by this slice; later bootstrap must use these persisted identities. Existing feature stores continue through their existing paths until their replacement tickets land. This store never reads/imports those stores or changes project files, worktrees or provider history.

Records bind to this host and client and preserve exact paths, provider identity, ownership and decimal-string filesystem identities (including integers beyond JavaScript's safe-number range). The store does not grant path authority or start providers; consumers must validate filesystem identity and authorization before effects. Later slices extend the record schema for their domain state rather than dispatching through a legacy adapter.

A new directory is initialized once. An existing directory without valid state is an error, never permission to generate new identities. One exclusive `owner.lock` prevents simultaneous store owners. Snapshots use exclusive temporary creation, file fsync, directory fsync, rename and directory fsync before returning success. A write error makes the open owner unavailable. Incomplete/unknown records, unsupported versions, unexpected files, symbolic links, unreadable files and interrupted writes block startup. Snapshots have an initial 1 MiB limit, including validation before writes; this is a metadata bound, not measured production capacity.

## Explicit recovery

A crash can leave `owner.lock` or `state.json.tmp`. Startup deliberately stops rather than guessing whether effects occurred. Stop all app instances, preserve a copy of the entire foundation directory, and inspect the retained snapshot and temporary evidence before any manual recovery. Removing a stale owner lock is appropriate only after confirming there is no live owner. Never delete/recreate identities or copy older metadata over newer filesystem/provider effects to bypass an error. This ticket supplies no automatic recovery or identity-rebinding UI. Ordinary clean Quit releases the owner lock and restart retains identities.

## Checks

`host/foundation-state.test.ts` covers empty/second startup, exact owned-record persistence, competing owners, missing and malformed state, unsupported versions, invalid identities, interrupted writes, ENOSPC fault injection, metadata limit, unreadable file shape, symbolic links and abandoned owner evidence. Legacy and external-file byte preservation are asserted in isolated directories. Filesystem/provider effects and legacy conversion are absent.

`tests/foundation-state.spec.ts` launches the built desktop twice against isolated user data and checks that identities exist before the UI becomes usable and remain byte-identical after clean relaunch. Run with `ESCODE_PACKAGED=1` for the packaged app and restricted PATH.

Qualification is limited to this installation, focused desktop startup and isolated storage tests. No live provider turn, remote/multi-client/revocation, full capacity qualification, physical power-loss test or automatic crash repair is claimed.

Verified on 2026-10-30: typecheck, lint, build and packaging passed; all 11 focused storage tests passed; development and restricted-PATH packaged two-launch checks passed. The final serial full suite passed with 163 tests and four existing opt-in skips. An earlier parallel run timed out waiting for native watcher readiness in an unchanged test; that file passed independently, followed by successful serial full-suite runs. Separate Standards and Spec reviews reported zero remaining findings after fixing coercible UUID types and preserving failure evidence after initialization/update publication errors. Physical power-loss behavior remains unmeasured.
