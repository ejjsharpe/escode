# File-tab foundation — issue 94

Scope: initial ordered visible file set and exact checkout/file reuse under [file tabs](https://github.com/ejjsharpe/escode/issues/92). This does not certify the complete parent specification. The accepted [checkout/search handoff](../specifications/checkout-tabs-file-lookup.md) is integrated as documentation only. Its fixed top-level checkout tabs, chat changes, lookup and search implementation remain owned by issue 93.

## Shared opening contract

`src/workspace.ts` exports `openFile({ root, path, view, intent })`, returning success only after the requested editor has opened. `root` is the exact already-mounted validated checkout root, `path` is checkout-relative, `view` is `file`, `staged`, `unstaged` or `untracked`, and `intent` is `preview` or `keep`. Missing mounted roots reject; they never fall back to another workspace. Callers composing top-level navigation must first mount/activate that exact checkout and select Files or Source Control as appropriate. Lookup must validate its current scope before calling and focus the editor only on success. This client function adds no filesystem authority: all reads still pass through the existing authenticated host checks.

Files, new files, transfer-result opens, comparisons and tab activation use this path. Both intents currently retain tabs; preview replacement/promotion and tree intent refinements belong to the next slice. That foundation initially opened the normal file view on tab activation. The subsequent [shared-view slice](file-tabs-comparisons.md) implements remembered comparison views and editor/sidebar independence.

`views[root].openFiles` holds visual order; existing `views[root].path` holds active identity. Neither represents MRU. One checkout-owned Monaco buffer registry still owns text and loaded disk baselines. A new identity inserts right of the active identity; reuse activates without moving. Read failures preserve the current presentation; stale responses cannot insert or activate tabs. Restored metadata does not grant filesystem authority. Existing host/client ownership and storage version 1 rejection remain intact. Open-file paths reject malformed, duplicate, absolute and traversal identities; metadata persists through the existing workspace transport. Successful close and journalled move/Trash reconcile the added references with existing gates.

## Verification

The existing Electron harness `tests/file-tabs.spec.ts` covers dirty reuse, right insertion, reuse without reorder, persisted order/active selection, delayed responses and failed normal/comparison opens. `tests/navigation.spec.ts` covers independent original/worktree buffers and branch-label changes. Existing host workspace tests cover malformed metadata and retained data on rejection; the real move fixture checks ordered identities alongside dirty text and conflict baselines.

The first Electron test failed because there was no tab row, then passed with implementation. Workspace validation failed on traversal metadata before validation was added. The move fixture failed on retained old paths before journal reconciliation was extended. The failed-comparison assertion also failed against the old behavior that cleared the diff, then passed after retaining the current presentation. Final check results are recorded after execution below.

The user's 2026-10-31 amendment excludes manual VoiceOver sessions and accessibility sign-off; it does not remove accessible controls. Broader preview, close/MRU/reopen, unavailable-restoration and full parent-spec qualification remain subsequent slices. Comparison positions are covered by the subsequent shared-view slice.

Final results on 2026-10-31:

- Desktop typecheck, lint and `git diff --check`: passed.
- Full existing unit suite: 265 passed, four skipped (29 passing test files, one skipped). Focused workspace/operation suite: 39 passed.
- Development Electron: 39 passed across `file-tabs`, `navigation`, `editable-diff`, `lifecycle`, `agents-files-recovery`, `files-inline` and `files-trash-handoffs`.
- Build and macOS arm64 package: passed with the existing bundle-size warning and unsigned development-package configuration.
- Packaged Electron (`ESCODE_PACKAGED=1`): four passed across `file-tabs`, `navigation` and `editable-diff`, using the harness's restricted packaged PATH.

No live provider turns, manual VoiceOver session, full desktop suite or complete parent-spec qualification were run for this slice. The package is a local development artifact, not a release.
