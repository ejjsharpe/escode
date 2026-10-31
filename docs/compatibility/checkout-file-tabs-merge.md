# Checkout lookup and file-tab integration

On 2026-10-31 the isolated `t3/merge-checkout-lookup` worktree started clean at checkout/search integration `b131de14dcd8474de0fad298f57db6af3ae9739a`. That commit is the integration ancestor of this merge. Fetching `origin main` before merging, and again before final qualification, returned `07bfaa4d46e0210456081cb640b413993921c20a`, containing the completed file-tab restoration, recent navigation, reopening, operation reconciliation and final review corrections. This merges that exact main commit without changing either integration branch or another worktree. README, glossary, tracker conventions, both accepted specifications, their implementation issues and the host-authority/recovery ADRs informed resolution; the open-map query returned no map.

## Resolutions

- Keep one client workspace, shared opener and working-buffer registry. The normal-file selection path combines file-tab restoration/reuse flags with lookup's current-invocation callback. Existing callers retain their respective arguments; a delayed cancelled lookup cannot activate a file, while restoration refreshes clean current-source text/baselines and retains dirty buffers.
- Preserve main's opening counter and generation guard for conflict restoration, captured conflict path for Overwrite/Compare/Reload, and internal operation completion selection while the external mutation/open gate stays held. Keep its move/Trash reconciliation of open tabs, recent navigation and complete close-history batches.
- Preserve checkout/search's canonical-path and native directory-identity checks, strict identity syntax, and refusal to replace a recorded approval even through native opening. Retain main's `validateCheckout` method and restart/membership validation assertions; its explicit replacement-approval test now asserts refusal, matching the existing checkout recovery contract. The mismatch explanation directs users to restore the original directory. Path-only approvals still require explicit approval of the original directory.
- Retain checkout/search's seeded-workspace-only fixture stamping. Remove the automatically merged duplicate unconditional approval-stamping block from main, which would otherwise mutate approvals on ordinary fixture restarts and duplicate a declaration.
- Combine native-dialog shortcut guards with main's close/reopen and recent/visual navigation. Extend the owning delayed-lookup journey: while Refresh has native lookup-dialog focus, Cmd+Shift+T, Ctrl+Tab and Cmd+Option+Right leave file membership unchanged and create no recent picker; after Escape, Reopen Closed still restores the exact closed file. Existing Cmd+W, text-entry, stale validation/read, scope closure and focus assertions remain.
- Retain the checkout/search editable-diff fixture's explicit comparison-load wait and file-tab Keep Open action, plus Save completion synchronization. Preserve both sets of README evidence links, glossary concepts, host ownership and malformed-metadata checks. No dependencies, contracts or FFF behavior are added.

## Verification

Frozen dependency installation, typecheck, lint, renderer/host build and macOS directory packaging passed. The complete serial unit run (`node scripts/filesystem.mjs && node_modules/.bin/vp test run --maxWorkers=1`, from `apps/desktop`) passed **284 tests, four skipped**, with 30 passing files and one skipped, in 155.50 seconds.

The built Electron batch passed **52/52** in 4.4 minutes:

```sh
bun run --cwd apps/desktop smoke -- tests/lookup.spec.ts tests/navigation.spec.ts tests/availability.spec.ts tests/file-tabs-restore.spec.ts tests/file-tabs-recent.spec.ts tests/file-tabs-close.spec.ts tests/files-trash-handoffs.spec.ts tests/editable-diff.spec.ts
```

This covers recursive ranking/highlights and file/ignore freshness; exact local/global activation, retained buffers and stale activation; checkout recovery including replaced directories and no-Git operation; missing-file and conflict-view restoration; close failure/persistence gates, bounded batch reopening and discarded-text behavior; recent/visual navigation and keyboard scope; move/Trash history and journal handoffs; both inactive Save-before-Trash conflict targets and Open affected files. The final host message-only correction was rebuilt before packaging.

The final restricted-PATH packaged batch passed **17/17** in 1.8 minutes:

```sh
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/lookup.spec.ts tests/navigation.spec.ts tests/availability.spec.ts:212 tests/file-tabs-restore.spec.ts tests/file-tabs-recent.spec.ts tests/file-tabs-close.spec.ts:244 tests/files-trash-handoffs.spec.ts:552 tests/files-trash-handoffs.spec.ts:579 tests/packaged.spec.ts
```

This repeats lookup freshness and exact navigation, the extended native-dialog shortcut assertions, unavailable checkout recovery, all four restoration cases, all four recent-navigation cases, single-close reopening, all three final operation-targeting regressions and packaged CSS/Monaco/tool/capability loading. No case was excluded from either batch above.

Additional deliberate project-default, captured-draft and arrangement checks used:

```sh
bun run --cwd apps/desktop smoke -- tests/agents.spec.ts:521 tests/project-drafts.spec.ts tests/file-tabs-arrangement.spec.ts
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/agents.spec.ts:521 tests/project-drafts.spec.ts tests/file-tabs-arrangement.spec.ts
```

The built follow-up passed **4/5**, with one 30-second locator timeout at arrangement line 87, looking for `long-file-name-8.txt` in Files after the 650px resize and successful active-tab reveal assertions. Project-default/lookup-recency restoration, captured draft/single provider binding, drag ordering and strip/menu focus passed. A temporary diagnostic rerun showed all expected tree paths and passed in 2.8 seconds; diagnostics were removed. The unchanged overflow test then passed **three consecutive built repeats** (2.6 seconds each, 9.4 seconds total). No assertion, timeout, product code or fixture behavior was changed for this observation; its cause is not established. The complete five-case follow-up then passed **5/5 packaged** in 29.9 seconds, including the unchanged overflow case. This does not turn the initial mixed built batch into a clean passing batch.

Final conflict-marker and whitespace checks passed. Only this assigned branch/worktree is committed; pushing is reserved for the parent after review.

Final built `main.cjs` SHA-256: `1113166caea4c9c5b01c2532ef78467195ca8fb64b2809c1874ad2780fdc556b`. Packaged `app.asar`: `b56853d72fcba42222d2035f600c6c3dff7100891093c465de213ecb57be1f30`.

## Limits

This is focused merger qualification, not a new exhaustive desktop-suite or capacity claim. Existing [lookup responsiveness measurements and timing history](lookup-responsiveness.md), [file-tab review qualification](file-tabs-review.md), and their original intermittent navigation/provider-startup, cursor/scroll shutdown and excluded mutation-IPC assertion evidence remain unchanged. No large dataset benchmark, live provider turn, manual VoiceOver session or long-duration soak was repeated. Manual accessibility sign-off remains excluded by the accepted user amendment. Recovery remains best effort with the existing check-before-save and external filesystem race limits; the package is an unsigned local development build. No FFF investigation changes, issue mutations, PRs or pushes are included. Other worktrees and the running development app were left untouched.
