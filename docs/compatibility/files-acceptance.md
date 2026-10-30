# Integrated Files acceptance

Issue: [Complete the Files acceptance gates](https://github.com/ejjsharpe/escode/issues/48), against the ten scenarios in [Specification: IDE-style Files view](https://github.com/ejjsharpe/escode/issues/38).

The user removed Finder/native Trash and VoiceOver checks from issue 48 acceptance on 2026-10-30 and will handle them separately. These remain unverified follow-up checks, not conditions for closing this ticket. Automated results below do not certify physical Finder gestures or VoiceOver. Earlier bounded manual passes remain scoped to their original builds and journeys.

## Candidate and reproduction

Verification date: 2026-10-30. Application source: `c272243` (follow-up changes affect tests and documentation only). macOS 26.3.1 (25D2128), arm64; Bun 1.4.4, Node 26.13.0. Locked Electron 45.1.0, Monaco 0.57.0, TypeScript 7.0.2, Playwright 1.64.1. Package: unsigned `apps/desktop/release/mac-arm64/escode.app`.

Run from the repository root:

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun run package
bun run smoke
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- --grep-invert "StyleX updates during development"
```

The development HMR journey intentionally starts a development server; exclude it from packaged verification. Authenticated-provider workflows are opt-in and are not enabled by these commands. Test repositories and Electron user-data directories are temporary and isolated.

## Scenario evidence map

The following maps existing reproducible checks to each requirement; execution results are recorded separately below.

1. Nested navigation and migration: `tests/files-tree.spec.ts`, `tests/navigation.spec.ts`, and `host/workspace.test.ts` exercise lazy nesting, per-checkout state, restart, old memory migration and retained drafts. See [tree evidence](files-tree.md).
2. Inline actions: `tests/files-inline.spec.ts` covers create/rename, validation, cancellation, keyboard/menu controls and case-only rename. See [inline evidence](files-inline.md).
3. Dirty moves: `tests/file-operations.spec.ts` checks dirty descendants, moved disk paths, conflict baselines, SIGKILL/relaunch recovery, destination saves, Monaco URI/language and subsequent undo. It asserts disclosure that earlier undo history resets. Host operation/workspace tests exercise interrupted handoffs in fresh stores. See [first-gate compatibility evidence](file-operations.md).
4. Trash: `tests/file-operations.spec.ts` and `tests/files-trash-handoffs.spec.ts` cover dirty choices, cancellation, conflicts, mixed per-item outcomes, native failures and recovery. Automated native calls do not establish Finder Put Back usability. See [Trash evidence](files-trash.md).
5. Clipboard batches: `tests/files-transfer.spec.ts` covers dirty source duplication, collision choices, dirty destinations, partial cut results, retained origin and copied destination recovery after a fresh Electron process. Real bytes and save baselines are asserted. See [transfer evidence](files-transfer.md).
6. Drag and imports: `tests/files-drag.spec.ts` and `tests/files-import.spec.ts` exercise captured targets, move confirmation, copies, native-reference validation, originals, unsupported contents and binary/large files. Physical Finder drop/file paste remains pending. See [drag](files-drag.md) and [import evidence](files-import.md).
7. Authority: the operation, transfer, import, reveal and Trash-handoff suites exercise sender validation, protected metadata/app state, traversal, symlink/root/parent replacement and pending operations across project/editor changes. Renderer selection never grants filesystem authority.
8. External changes: `tests/files-watch.spec.ts` and `tests/files-reveal.spec.ts` exercise loaded/collapsed changes, focus rescan, unavailable watch retry, retained dirty missing paths, ignore filtering and reveal. See [watch](files-watch.md) and [reveal evidence](files-reveal.md).
9. Accessibility: keyboard journeys and `tests/accessibility.spec.ts` cover semantics, focus, menus and shortcut isolation. Integrated VoiceOver verification of later controls, error recovery and focus restoration remains pending; automated assertions do not replace it.
10. Scale and concurrent work: generated-tree and recursive-copy journeys in `files-watch.spec.ts` and `files-transfer.spec.ts` measure a 20,000-file tree independently. The follow-up transfer journey expands 8,000 files and uses arrow navigation while a controlled protocol chat runs, captures then removes a cut source, verifies a visible failed-paste result and absent destination while the chat stays busy, and then performs a 500 MiB copy with Agents navigation and the visible Stop button before copy completion. This is fixture-provider evidence, not an authenticated Codex turn. Baseline Electron suites cover editor/save, navigation, recovery, Agents, chat protocol and worktrees.

## User-owned manual follow-up and limits

- User-owned follow-up (removed from ticket acceptance): physical Finder file/folder drop and file-copy/Paste, target/modifier feedback, Finder reveal, native Trash recovery on this candidate, and integrated VoiceOver navigation/selection/menus/inline/conflict/Trash/error/focus checks.
- Authenticated-provider concurrency during long copy was not repeated; the specified application seam uses a controlled provider fixture. No live turn is inferred from it.
- No signing/notarization, cross-volume acceptance or release distribution is claimed.
- Explicit save, practical check-before-save and best-effort draft recovery remain unchanged. Cross-process final-check races remain possible. Batches and replacement are nontransactional; partial successes remain committed and reported. Earlier text undo resets on move with disclosure; subsequent text undo is supported. No file-operation undo stack or directory merge is added.

## Execution results

- Root `typecheck`, `lint`, `build` and `package`: passed. The unsigned arm64 package was produced locally. Build retains the existing renderer chunk-size warning.
- Root `smoke`: **110 passed, 2 opt-in skips**, 5.5 minutes of Electron execution (5m38s including Nx dependencies). This includes the development HMR journey; its existing duplicate-createRoot console warning remains.
- Initial root `test`: **151 passed, 1 failed, 4 skipped**; shutdown initialization did not publish child PIDs within the polling window. Focused `bun run --cwd apps/desktop test -- host/shutdown.test.ts`: **4 passed**. A full retry, overlapping Electron execution, instead failed the watcher-readiness event assertion: **151 passed, 1 failed, 4 skipped**. These are observed failures; a passing isolated test does not erase them.
- Generated tree: 200 directories / 20,000 files, fixture generation 1247 ms; root visible 682 ms, expansion 67 ms, two arrow keys 9 ms, external update visible 227 ms. The test asserts only loaded-directory watches.
- Standalone long-copy journey: 500 MiB across 8,000 binary files, native copy **1846 ms**, bridge Stop **1 ms**, Agents navigation completed before copy finished. All destination bytes are checked. These are one-run measurements, not performance guarantees; the chat provider is a controlled protocol fixture.

Session logs: `/tmp/escode-48-{typecheck,lint,test,test-retry,shutdown,build,package,smoke}.log`. Nx prints summary logs; the full successful Electron output is `/Users/elliotsharpe/.nx/47c07d4a09270f1f/cache/terminalOutputs/4512391267364706699`. Local logs and generated packages are not versioned.

Independent documentation review: Standards found no actionable violations. Spec found an overstatement of scenario 10; the mapping now explicitly records separate tree/copy measurements, bridge Stop and the missing concurrent-failure/visible-Stop checks. Neither review certifies final acceptance.

Serial host verification, without competing Electron execution: `bun run --cwd apps/desktop test -- --maxWorkers=1` passed **152 tests, 4 opt-in skips** in 58.42 seconds. No product/test code was changed to obtain this result.

Packaged measurements: 20,000-file tree generation 1151 ms, root visible 698 ms, expansion 59 ms, two arrow keys 10 ms, external update 199 ms. Standalone 500 MiB copy 1837 ms, bridge Stop 2 ms, with Agents navigation completed during copying. These retain the same fixture-provider and one-run measurement limits. Packaged output: `/tmp/escode-48-packaged-smoke.log`; serial host output: `/tmp/escode-48-test-serial.log`.

Final packaged suite: **109 passed, 2 opt-in skips**, 5.2 minutes, using `ESCODE_PACKAGED=1` and excluding only the development HMR test. The shared launch seam honors packaged mode; `project.spec.ts` also deliberately exercises both unpackaged and packaged launches. Together with the separate full smoke run, this verifies the package without claiming every launch in that suite is packaged.

The initial handoff left issue 48 open for manual checks and scenario 10 coverage gaps. The follow-up below records the user-authorized acceptance exception and additional automated coverage.

## Completion under the revised ticket conditions

The user requested continued unattended work and explicitly removed Finder/native Trash and VoiceOver from issue 48 acceptance; those checks remain their responsibility. The issue body records this exception without claiming a manual pass or rewriting the historical parent specification.

The remaining scenario 10 gaps are covered by the extended `files-transfer.spec.ts` journey: a running protocol-fixture chat coexists with expansion of 8,000 files and two arrow moves, each asserting the expected focused file. A captured cut source is removed before Paste; the visible result identifies the failed source, no destination exists and the chat remains busy. A subsequent 500 MiB copy leaves Agents navigation and the visible Stop button usable; copy remains running after Stop and every copied file's bytes are checked.

Final follow-up checks:

- Typecheck and lint: passed.
- Full serial host suite: **152 passed, 4 opt-in skips**, 57.28 seconds.
- Packaged transfer suite after focused-item assertions: **12 passed**, 35.5 seconds.
- Packaged concurrent expansion plus two verified arrow moves: **1048 ms** for 8,000 files; native copy **3499 ms**; visible Stop click **81 ms**. These are individual fixture measurements, not performance guarantees.
- Fresh independent Standards and Spec reviews found no actionable findings after adding focused-item assertions. The earlier review objection and bridge-Stop coverage gap are resolved.

Reproduce follow-up checks from the repository root:

```sh
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
bun run --cwd apps/desktop test -- --maxWorkers=1
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-transfer.spec.ts
```

Logs: `/tmp/escode-48-follow-{typecheck-final,lint-final,host,packaged-final}.log`. The application package remains the previously tested `c272243` source; follow-up changes affect tests/documentation only. Remote main's separate UI work at `31c14a7` was not integrated or certified by this session. Acceptance evidence is published on `acceptance/files-48` to preserve this exact scope.

All issue 48 conditions remaining after the user's manual-check exception are satisfied. Finder/native Trash and VoiceOver remain unverified user-owned follow-up. Existing explicit-save, nontransactional batch and best-effort recovery limitations remain unchanged.
