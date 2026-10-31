# File-tab review corrections — spec 92

This follow-up addresses all four reported review findings against integration `implement/file-tabs-92` at `e2007f549dcfb902395e9df82e5e121fd0f8ef8f`. The clean isolated branch `t3/fix-spec92-findings` started exactly at that integration commit; `50bfe77416182f2e4f7fa5356f2864746f8cecdc` is its ancestor (and the merge base with that specified baseline). The open-map query returned no map; completed map #87 and README record implementation authorization. README, tracker, glossary, accepted file-tab specification and prior slice evidence were read. No issue, PR, integration branch or other worktree is edited. Product concepts and contracts are unchanged.

## Corrections

- **P1, operation completion and conflict targeting:** completion selects captured affected files through the existing internal selection path while retaining the operation serialization lock. External opening and mutation gates remain in place. Save-before-Trash selects the captured conflict file before presenting its actions. Compare activates its exact target; Overwrite supplies the conflict path explicitly, independent of the active file; Reload already reads and updates the conflict path. No operation replay or automatic destructive retry is added.
- **P2, clean remembered conflict view:** restoration refreshes both text and disk baseline of an existing clean buffer from the current disk read, matching normal/comparison restoration. Dirty buffers retain text and their original baseline, and repeat save conflicts remain detectable.
- **P2, delayed conflict-view selection:** conflict restoration holds the existing opening counter across its read, releasing it in `finally`. Status refresh cannot refresh the preceding comparison while that explicit selection is pending; generation checks still reject obsolete responses.
- **P3, host validation:** `openFiles` uses the existing `validFile` predicate. Duplicate membership and active-file membership validation remain intact, as do malformed-path tests.

## Regression evidence

The user requested the Electron UI/real-filesystem seam. Tests exercise visible controls in real temporary repositories; the delayed-read regression holds a real host WebSocket response while status responses continue. It does not replace editor or selection internals.

Red/green evidence on 2026-10-31:

- Both inactive Save-before-Trash cases failed because A's tab remained unselected while B was active. The Open affected files transfer case failed because the source remained selected. After repair, the cases verify Compare/Overwrite/Reload against A, preserved dirty B text, and the actual disk bytes of both files. A and B deliberately have equal disk bytes/content hashes, exposing wrong-target overwrite risk. Overwrite is exercised directly; the Reload case also checks Compare.
- Extending the existing dirty recovery/conflict restoration journey with Reload, navigation away and an external change failed with a false conflict banner. After repair, the clean buffer has current disk text, no unsaved marker or conflict, and a subsequent edited Save succeeds against the refreshed baseline. The original dirty-recovery/repeat-conflict assertions are retained.
- With A's conflict-view read delayed across two status responses while B's comparison was active, A failed to become selected. After the opening-guard repair, A's exact tab and remembered conflict view win and show current disk contents.

Fixture/run qualifications are retained: the initial inactive-file fixture tried a row action unavailable for an inactive row and timed out; it now uses the row context menu. A green attempt briefly matched the old diff's multiple Monaco elements during tab activation; the test now waits for B's named editor. The first clean-buffer assertion expected a literal false unsaved attribute, whereas clean tabs omit it; the assertion now checks absence of the true marker. A combined run timed out in cleanup after the final Save; the fixture now waits for the visible Saved completion before Quit. That run was interrupted and its fixture process stopped. The subsequent five-test run passed 5/5. These fixture corrections are not product fixes. Other-worktree Electron/unit runs were observed and left untouched.

## Checks and limits

Frozen dependency installation, typecheck, lint, renderer/host build and macOS arm64 packaging passed. The full unit suite passed 268 tests with four skipped (29 passing files, one skipped), including existing workspace malformed-metadata checks. Packaging retains the bundle-size warning, default icon and unsigned local development configuration.

Final unpackaged development Electron run: **53/54 passed** across `editable-diff`, `file-operations`, `file-tabs-close`, `file-tabs-restore`, `file-tabs` and `files-trash-handoffs`, with only `--grep-invert 'mutation IPC'` excluded. All five focused regressions also passed in this broader run. The existing cursor/scroll restoration test timed out during shutdown; its actual fixture disk contained both `line030DIFF` and final `line080NORMALRESTORED` text. The stuck fixture process was stopped so the remaining tests could run. The test and its cleanup were left unchanged; the timeout is not counted as passing and no clean broad run is claimed.

Final packaged Electron run: **21/21 passed** in one serial run of `file-tabs-restore.spec.ts` and `files-trash-handoffs.spec.ts` with `ESCODE_PACKAGED=1` and the harness's restricted PATH. This includes all five focused regressions, missing-file/current-source Retry, replaced-checkout identity, recovery restart, partial saves and pending operation authority through navigation/close/Quit. Final typecheck and lint passed after the test fixture corrections.

Earlier mixed-run records remain unchanged in [operations](file-tabs-operations.md), [restoration](file-tabs-restoration.md), [integration](file-tabs-integration.md), [comparisons](file-tabs-comparisons.md), [previews](file-tabs-previews.md) and [reopen](file-tabs-reopen.md). This follow-up does not diagnose earlier provider startup uncertainty.

The baseline sender-rejection message assertion remains unchanged: bootstrap/preload/client error wrapping and its assertion are not changed by these fixes. Broader runs explicitly exclude only `mutation IPC`, whose error-text mismatch was reproduced against the original integration renderer in the prior operation evidence. The exclusion is not a passing result for that test.

No live provider turn, manual VoiceOver session, exhaustive desktop suite or complete parent-spec acceptance is claimed. Manual accessibility sign-off is excluded by the accepted user amendment. Recovery remains best effort and saving retains its check-before-save limits.

The latest local integration was merged before completion and remained `e2007f549dcfb902395e9df82e5e121fd0f8ef8f` (already up to date). Final whitespace and conflict-marker checks passed. Only this isolated branch/worktree is changed.

## Final integration qualification

On 2026-10-31, the clean integration branch `implement/file-tabs-92` at `e2007f549dcfb902395e9df82e5e121fd0f8ef8f` merged `t3/fix-spec92-findings` at `cfbf9d985c4cb75386108b94515250fa6201bbb9` with `--no-ff`, without conflicts, producing merge commit `75e3c89a6b9f792c6e2dc64487dbdb3aaf34ccab`. This section qualifies the final integration; the isolated-branch statements above describe the source work.

Source and regression-assertion review confirmed all four corrections: captured conflict targets for Compare/Overwrite/Reload and internal completion opening while the serialization gate remains held; current text and baseline reload for clean remembered conflict buffers while dirty recovery remains intact; the pending-opening counter with `finally` release and generation checks; and shared `validFile` validation retaining duplicate/active membership checks. The five focused regression cases cover the first three corrections; existing malformed-workspace assertions cover validation.

Fresh integration checks passed: `bun run typecheck`, `bun run lint`, `bun run --cwd apps/desktop test -- host/workspace.test.ts` (9/9), merge-diff whitespace and conflict-marker scans. The source-reported 268 passing units (four skipped), 5/5 focused development tests, 21/21 packaged tests and broader 53/54 development result above were reviewed, not rerun during final integration. The cursor/scroll shutdown timeout and excluded `mutation IPC` assertion remain limits; no full-suite or complete parent acceptance is claimed. No issue, PR or other worktree was edited.
