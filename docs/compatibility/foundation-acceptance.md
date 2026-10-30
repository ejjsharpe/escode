# Integrated local foundation qualification

See the [follow-up repairs and qualification](foundation-acceptance-followup.md)
for the subsequent implementation fixes, passing rerun results and user-confirmed
manual checks on 2026-10-30.
The record below preserves the original failed run.

Tracks [Accept the complete local foundation](https://github.com/ejjsharpe/escode/issues/86).
Qualification target: combined main commit `6a5e1d0`, 2026-10-30, isolated
`acceptance/issue-86` worktree. **Acceptance remains pending.** This record does
not convert historical feature passes or failed integrated checks into acceptance.

## Installation and commands

macOS 26.3.1 (25D2128), arm64; Electron 45.1.0, embedded Node 24.22.1;
shell Node 26.13.0; Git 2.50.1 (Apple Git-155). Frozen installation used
`/tmp/escode-bun-1.4.4/bun-darwin-aarch64/bun` (1.4.4). Default Bun 1.3.14
failed to parse lockfile version 2; no dependency or lockfile changes were made.
Shell Codex reports 0.163.0; packaged installed-tool discovery actually selected
`/Users/elliotsharpe/.bun/bin/codex`, version 0.166.0. These are different
executables, not a provider compatibility matrix.

`bun run typecheck`, `lint`, `test`, `build` and `package` each exited zero.
The [unit output](foundation-acceptance/unit.log) records 212 passed and 4 skipped.
The full `bun run smoke` exited 1: 100 passed, 16 failed, 3 skipped, and
3 errors outside individual tests (12.5 minutes). Tests use generated temporary
repositories and fresh versioned state; no legacy user store was imported.

`ESCODE_LIVE_CHAT=1 ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/chat.spec.ts`
passed both installed-provider checks in 25.0 seconds: saved streaming/reopen with
retained composer and no duplicate user message; scratch and deferred worktree
first Send, settings and fresh history. See [raw output](foundation-acceptance/live-provider.log).
This consumes real provider turns but makes no claim about other versions.

## Coverage and authority

Feature records provide the detailed scenario inventories:

- Chats/Agents: [summaries](chat-summaries.md), [history](saved-history.md),
  [live output](live-output.md), [Send](durable-send.md), [reconnect](reconnect.md),
  [control](live-control.md), [project drafts](foundation-project-drafts.md).
- Files: [directory/watch](directory-host.md), [save/recovery](foundation-files.md),
  [move](foundation-moves.md), [create](foundation-create.md),
  [Trash](files-trash.md), [transfers](foundation-transfers.md),
  [native import](foundation-native-import.md). Tree, reveal/filter and recovery
  UI checks remain in the integrated Electron suite, whose failures are not waived.
- Source Control: [observations](git-observations.md) and [shared-buffer diffs](foundation-diffs.md).
- Lifecycle: [window retention](window-lifecycle.md), [Quit](quit.md).

Static audit of `host/main.ts`, preload and `packages/host/index.ts` found one
Electron-main composition authority. Superseded status/worktree-options/diff,
read/save/list/filter/create/Trash/capture/transfer project IPC requests reject;
chat IPC retains native uncertainty confirmation, target discovery and existing
setup/disconnect operations. Native project approval, clipboard/Finder, managed
worktree removal and lifecycle bridges remain. These are platform/composition
operations; no automatic domain fallback or dual dispatch was found. Git status
and worktree observation retain the visible two-second polling fallback.
The listener explicitly binds `127.0.0.1`; request authentication checks Host,
Origin, endpoint, host identity, wire revision and one-use tickets before dispatch.
The passing unit suite includes trust rejection and healthy-client recovery.

The actual packaged ASAR contains `dist/host/codex-extraction.json` (4,415 bytes),
`foundation-NOTICES.txt` (17,864 bytes) and `foundation-dependencies.json` (341 bytes).
The build derives dependency notices from bundled inputs and retains T3 MIT and
Codex license/NOTICE sources. Packaging remains unsigned with a default icon.

## Bounds and practical observations

The passing unit command includes `directories.test.ts` stalled delivery,
admission exhaustion, ACK timeout/reset and healthy connection control;
`send.test.ts` receipt exhaustion and injected persistence failure;
`history.test.ts` bounded/partial history and unavailable spool storage;
`live-spool.test.ts` quota, interrupted writes and corruption;
`foundation-state.test.ts` injected ENOSPC and safe restart rejection.
These are focused injected faults, not a full-volume disk fill or sustained-load
qualification. Watch tests check shared ownership and release.

A separate fresh empty packaged launch, restricted to `/usr/bin:/bin`, reached the
Open project control in 778 ms. Electron reported main private memory 62,260 KiB;
Browser and Tab working sets were 196,896 and 174,864 KiB. GPU and Utility samples
and embedded versions are in the [raw sample](foundation-acceptance/idle-package.json).
This is one immediate startup sample with no open project/provider, no forced GC
and no soak. It cannot establish retained-memory growth or savings.

The [original baseline](https://github.com/ejjsharpe/escode/blob/6e0abfd41796d083208e976b4336d15f6a20f1ab/docs/research/foundation-baseline/README.md)
explicitly lacked comparable production startup/retained-memory measurements.
Its small Bun heap deltas are not comparable to these Electron working sets.
The integrated generated-tree sample (20,000 files/200 directories) measured root
visible 723 ms, expansion 122 ms, two arrow keys 9 ms and external update 260 ms.
Historical samples were 698/59/10/199 ms respectively: broadly similar single
observations with slower expansion/update in this run, without enough samples for
a regression conclusion. The 500 MiB/8,000-file copy measured 3,376 ms with visible
Stop at 27 ms (historical 3,499/81 ms). These UI runs used controlled providers.
Historical packaged Files timing samples remain useful context, but no percentage
improvement or measured production capacity is claimed.

## Manual and excluded qualification

The user volunteered to test this package with VoiceOver. Current-build results
for close/reopen, reconnect, conflicts, Needs input and Quit are pending. Automated
keyboard/focus results must remain distinct from VoiceOver. Historical manual
passes do not certify changed failure messages or this build. Existing user-owned
Finder/drop/clipboard/native Trash limits remain outstanding.

Legacy import, upgrades/downgrades, broad installation/provider compatibility,
exhaustive multi-client/revocation and sustained-load/full capacity qualification
are excluded by the approved prerelease amendment. No pass is claimed for them.

## Integrated failure inventory

[Full raw Electron output](foundation-acceptance/integrated-smoke.log) retains
assertions, locations, timing samples and the three runner errors. Failed cases:

- Accessible diff viewer keyboard activation.
- Two Agents/move recovery fixtures expect literal `null` instead of the new
  versioned cleared journal envelope.
- Agents restored composer text, newest-first selection composer text, and global
  creation/live-summary ordering.
- Legacy draft restoration; secondary-checkout recovery without Git; unavailable
  provider/authentication presentation.
- Summary detail-observation count during navigation.
- Development StyleX update timeout.
- Restored hidden Files selection/type availability.
- Closing an editor with active work and confirmed Quit cleanup.
- Both packaged and unpackaged baseline edit/conflict/Compare/Overwrite journeys.
- No project/local text-bearing draft movement through Agents.

These require diagnosis and fresh-state fixture reconciliation before acceptance.
Journal serialization and legacy-import expectations visibly differ from the new
format/scope; that does not prove the remaining assertions or product behavior pass.
No failed test was removed, weakened or declared an accepted exception. The live
provider check and empty-package sample briefly overlapped the full suite; focus
and timing failures require serial reproduction before assigning root causes.
The overlapping live run also reset the shared test-results directory, so the raw
full-suite output is the durable failure inventory, not that directory's contents.

Current-build VoiceOver results remain pending from the user. No new product
terminology, architecture decision or application implementation is introduced.
