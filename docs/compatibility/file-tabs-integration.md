# File-tab preview and safe-close integration

Scope: merge preview/promotion commit `2c139cce43da6ab126cdc2c33dcda3696da2187d` into safe-close baseline `4fae5561c4ccbac9e688927411c289297b4e40bc`, on `implement/file-tabs-92`. This is bounded integration evidence for #92, preserving [preview evidence](file-tabs-previews.md) and [safe-close evidence](file-tabs-close.md).

The shared tab menu retains Keep Open and all captured close commands, keyboard traversal and context-target focus restoration. Opening retains the in-flight close guard; activation retains preview/promotion and MRU bookkeeping. Explicit close clears a targeted preview in the persisted removal snapshot, retains an untargeted preview, and restores the previous metadata on persistence failure. Single/batch Save/Discard/Cancel, deferred discards, failed-save and failed-persistence vetoes, comparison buffers and contextual Cmd+W retain their shared close path.

The initial combined development Electron run passed 10/14. Three close journeys exposed undefined preview metadata rejected by RPC schema validation; the close snapshot now writes the valid empty identity when no preview exists. The preview menu journey exposed deferred focus restoration dismissing a newly reopened menu; restoration now focuses the existing context tab synchronously. The original failing journeys exercise both fixes. The added combined journey checks batch Cancel retaining promoted dirty text plus a clean preview, single preview close clearing persisted identity, subsequent replacement, batch discard and empty restoration.

## Verification — 2026-10-31

- Typecheck and lint after the fixes: passed. Final full unit suite: 267 passed, four skipped (29 passing files, one skipped).
- Build and macOS arm64 package: passed. Packaging retains the default icon and unsigned development configuration.
- Final development Electron: 14/14 passed across `file-tabs`, `file-tabs-close`, `editable-diff` and `navigation`.
- Final packaged Electron with restricted PATH (`ESCODE_PACKAGED=1`): the same 14/14 passed.
- `git diff --check`, staged whitespace checks and unresolved-conflict checks: passed.

The earlier startup failure before Open project while a rebuild overlapped, intermittent mock-provider Send/Running uncertainty and mixed broad-run results remain recorded in the two slice evidence files. These focused checks do not establish their causes or qualify provider behavior. No live provider turns, manual VoiceOver, exhaustive desktop suite or full parent-spec qualification were run. Recovery remains best effort and saving retains check-before-save limits. No issue or PR writes were made; only the requested integration worktree was changed.
