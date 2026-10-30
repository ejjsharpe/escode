# Scoped native import foundation

Implements [Import native files through scoped references](https://github.com/ejjsharpe/escode/issues/83)
on the authenticated transfer foundation delivered by issue 82. Native import uses
`transferAction` and its complete per-item intent/persistence facts, host recovery
journal, preservation gate and consent-aware request lifetime. There is no separate
native-import domain RPC or legacy project-IPC transfer route.

Electron retains narrow platform capture capabilities: genuine native-backed Files
resolve in isolated preload; native clipboard file URLs resolve in main. Both issue
opaque, single-use 60-second tokens. At most 16 pending captures are retained;
exhaustion rejects additional capture before opening descriptors. Navigation,
renderer loss, expiry and window disposal release pending descriptors; consumed
references are released by the shared transfer handler, including failures. Tokens
are scoped to this host/window client, never remote source paths or Project approval.
Source and ancestor identity validation, recursive preflight and asynchronous native
byte copying reuse the existing importer. Originals and unrelated source drafts
remain untouched. No stores or provider history are imported or removed.

## Verification on 2026-10-30

Actual installation: macOS 26.3.1 (25D2128), arm64; Electron 45.1.0;
embedded Node 24.22.1; Bun 1.4.4; Git 2.50.1 (Apple Git-155); installed Codex 0.163.0.
No live provider turn was required.

- Typecheck, lint, build and macOS directory packaging passed after integration
  with main at `5baf943`.
- Full unit suite: 210 passed, four skipped (22 files passed, one skipped).
- Prior focused native-import, native-race and directory tests: 29 passed.
- Native Files UI scenarios exercise actual binary/folder disk copies, partial
  unsupported batches, source replacement during collision consent, original
  retention, source-draft exclusion, dirty destinations, case/Unicode aliases and
  unsupported basenames. The native-backed File fixture also checks consumed-token
  rejection, the 16-reference limit, and navigation invalidation.
- Exhaustion fixture passed in development and packaged execution. Sequential full
  native-import UI reruns passed all nine scenarios in development (26.8 seconds)
  and packaged execution (27.0 seconds), including the added exhaustion assertion.

The initial concurrent development/packaged UI reruns each failed one clipboard
scenario (bulk-copy start observation and unsupported-basename outcome). They shared
the macOS clipboard; the sequential reruns qualify the final result independently.

Historical exclusions in [native import evidence](files-import.md) and
[Files acceptance](files-acceptance.md) remain: synthetic native-backed File drops
and programmatic clipboard writes do not establish manual Finder gesture acceptance.
Keyboard-driven paste is exercised; no layout, focus or accessible-name changes were
introduced. No new manual Finder, native Trash or VoiceOver pass is claimed.
Broad multi-client/revocation and capacity qualification remain deferred under the
approved prerelease amendment. The generated 500 MiB copy is a responsiveness
fixture, not production capacity evidence. Interrupted copies retain the existing
best-effort intent/staging reconciliation and filesystem race limits.

Standards and Spec reviews of the integrated implementation reported no remaining
findings. The separate preliminary RPC was removed in favor of issue 82’s shared
transfer route, retaining complete recovery facts and long consent lifetimes.
