# Effect foundation: local runtime target

Inventory recorded on 2026-10-30 for [Record the local runtime target](https://github.com/ejjsharpe/escode/issues/61), against checkout `6f06813638920eb4bbd110d9e4aac87e4d0dd2b1`. This records the actual installation targeted by subsequent delivery slices. It does not certify the unimplemented Effect foundation or support for other installations or versions.

## Observed installation

| Component | Observed value | Source |
| --- | --- | --- |
| macOS | 26.3.1, build 25D2128 | `sw_vers` |
| Hardware | MacBook Pro, MacBookPro18,3; Apple M1 Pro; 10 CPU cores (8 performance, 2 efficiency); 16 GB memory | `system_profiler SPHardwareDataType` (identifiers omitted) |
| Architecture | arm64 | `uname -m` and Electron `process.arch` |
| Electron | 45.1.0 | Installed Electron binary, `process.versions.electron` |
| Embedded Node | 24.22.1 | Installed Electron binary, `process.versions.node` |
| Chromium | 156.0.8078.49 | Installed Electron binary, `process.versions.chrome` |
| Shell Node | v26.13.0 | `node --version`; separate from embedded Node |
| Bun | 1.4.4 | `bun --version` |
| Git | 2.50.1 (Apple Git-155) | `/usr/bin/git --version` |
| Installed Codex CLI | 0.165.0 | `codex --version` via `~/.bun/bin/codex` |

The locked dependencies were installed with `bun install --frozen-lockfile`. Electron and its embedded runtimes were queried directly, rather than inferred from the manifest or shell Node:

```sh
ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -p 'JSON.stringify({electron:process.versions.electron,node:process.versions.node,chrome:process.versions.chrome,arch:process.arch,platform:process.platform})'
```

This binary query is not a development UI launch or packaged application acceptance check. Each feature slice must record its relevant development and packaged execution evidence on this installation, including installed-tool discovery and restricted-PATH behavior where applicable. The earlier application's Codex minimum-version policy and acceptance records do not establish compatibility for the new foundation. No live provider turn was needed for this inventory.

## Approved delivery scope and precedence

The [approved scope amendment](https://github.com/ejjsharpe/escode/issues/61#approved-scope-amendment) governs this fresh-state prerelease replacement under [Specification: Effect host and client foundation](https://github.com/ejjsharpe/escode/issues/60). It supersedes conflicting legacy migration, broad qualification and separate domain-acceptance gates in the [original pinned handoff](https://github.com/ejjsharpe/escode/blob/6f06813638920eb4bbd110d9e4aac87e4d0dd2b1/docs/specifications/effect-foundation.md) and its pinned investigations. The handoff, ADRs and source inventories continue to supply the architecture and unaffected requirements.

Fresh escode state imports no old chats, composers, recovery drafts, context associations or reservations. Initializing the new store must neither import nor delete old escode stores, project files, existing worktrees or provider history. There is no upgrade/downgrade support, legacy-writer coordination, storage conversion or backward-compatible transport in this delivery. Preserving old state does not mean making it available in the new application.

Replace internal feature paths directly and remove their superseded domain routes as each slice lands. No compatibility adapters, dual dispatch or automatic fallback are permitted. Unreplaced features may use their existing paths during development under the same authority; this is not a supported transition release.

## Required local checks in subsequent slices

- Verify initialization leaves old stores, project files, existing worktrees and provider history untouched. Use disposable fixtures for destructive/failure checks.
- Retain exact execution-context identities, uncertain-command protection, scoped replies and Stop, explicit-save conflicts and file-operation preservation.
- Exercise restart/crash recovery within the new format, storage version checks and safe rejection of unsupported stores. This recovery is required independently of the excluded legacy import.
- Retain stable client ownership, host-bound identities, command serialization and authority boundaries.
- Record a practical local baseline, explicit bounded queues/history/storage, resource cleanup and basic exhaustion tests, including stalled delivery and disk failure. Document initial limits and observed behavior.
- Each feature ticket owns its focused tests, packaged evidence, replaced-route removal and changed accessibility evidence. Fold first-milestone, chat and Files acceptance into delivery tickets, followed by one final integrated acceptance ticket. Confirm phase outcomes from delivery evidence before starting the next phase.

These are future delivery obligations, not passed checks in this inventory.

## Deferred qualification

- Broader installation and provider-version compatibility matrices.
- Exhaustive multi-client arbitration/recovery and device-revocation qualification, until a second client approaches. No multi-client or revocation acceptance is claimed.
- Full capacity benchmark matrices, five-run cold/warm sampling, prolonged steady-load and the specified overload qualification. No measured production capacity or improvement percentages are claimed.

No application implementation, migration experiment, packaged foundation run or capacity qualification is established by this record.
