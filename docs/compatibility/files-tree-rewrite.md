# Asynchronous Files tree rewrite

Work began on main at `0a9c981c9b41d0a6bdf6890cff5a301fdc76ffbb` on 2026-10-31.
During implementation qualification, no commits, pushes, PRs, installations or live provider
turns were requested or performed. The user subsequently authorized publishing this work
as a draft PR; that publication does not change the acceptance limits below.
All Electron fixtures use temporary repositories and profiles. The user's running app was
not targeted. The two historical expansion records remain unchanged and are not acceptance
for this rewrite. The tracked baseline was already clean; the prior experiment's archive
was present outside the checkout at `/tmp/escode-files-expansion-final.patch`.

## Architecture

[Design comparison and pinned source observations](../agents/files-tree-design.md) distinguish
VS Code source facts from design inferences. The reference commit is
`c198526d8e64ba6f9944e9f7bcc079ed1f6d7fcc`.

`FilesModel` owns complete sorted directory publication, exact-path node reuse, cached
listings, request sharing, stale-result rejection, cancellation, explicit invalidation,
watch-generation guards, deferred automatic refresh and lazy expanded-row projection.
Its production Adapter retains the existing authenticated directory/watch contracts.
Controlled promises exercise the same Interface in deterministic tests. A failed refresh
retains its previous contents with diagnostics; only fresh successful parent listings
justify pruning selection or expansion. Explicit Refresh can re-read during an inline edit;
automatic observation defers until the edit or target-resolution operation finishes.

`FilesViewport` owns measured heights, offsets, binary range lookup, overscan, pinned rows,
reveal positioning and identity-based scroll anchoring. The renderer consumes a complete
logical row sequence and mounts only the viewport plus overscan and required focus/edit/
reveal/drag-source rows. Keyboard ranges, select-all and typeahead use the logical sequence.
Filename wrapping remains enabled. Navigation takes precedence over anchor correction.
An optional validated scroll anchor persists entry identity and within-row offset; known
move/Trash outcomes reconcile it alongside existing Files memory.

Recursive JSX, the renderer cache and pending-load map were replaced. Existing creation,
rename, transfer, Trash, dirty-buffer and journal authority remain in their prior workflows.

## Intentional differences and scope

- Cached reopening uses resolved data until invalidated, replacing unconditional reads.
  Watch readiness, observation, focus/checkout return and Refresh recover stale data.
- Results publish immediately. Only loading feedback waits 800 ms. There is no 150 ms
  result-batching window. Remembered descendants can appear in successive complete levels.
- Labels wrap; no compact-folder presentation, file nesting or configurable VS Code sorting
  was added. Existing escode shortcuts, selection and Git-ignore semantics remain.
- Failure retains stale contents with diagnostics. External rename is removal/addition;
  the directory contract does not expose persistent filesystem object identity.
- Cancellation is logical: obsolete results cannot publish, but already issued transport
  work may finish. The shared host connection is not cancelled.
- Refresh retains resolved data while revalidating, unlike the old clearing behavior.
  Tests needing a cold model restart/remount explicitly. Virtualization tests assert full
  logical counts plus bounded DOM, rather than treating DOM count as directory completeness.
- After restart, estimated unmounted heights can change the numeric scroll offset. The
  visible entry and within-row offset are preserved and tested instead of pixel-total equality.

## Measurements

Animation-frame observations use real Electron rendering and the authenticated host path.
These are diagnostic samples, not statistical speedup claims or pixel paint traces.
Baseline and after observations ran serially for comparison; earlier overlapping baseline
suite runs are retained only as failure evidence. No VS Code runtime benchmark was run.

Baseline serial sample, milliseconds:

- Cold 30 siblings: first content 58.9; rows `0,30`; max mounted 33; longest frame 9.4;
  seven frames contained loading text.
- Cached reopen: first content 3.0; 30 children retained; max mounted 33; longest frame 9.9.
- Large 1,000 siblings: first content 102.9; rows `0,1000`; max mounted 1,003;
  longest frame 12.8; twelve frames contained loading text.
- Cold remembered descendants: first content 52.4; child counts `0,1,2,7`; max mounted 10;
  longest frame 9.4; 35 frames contained loading text.

Final development sample: cold **33.5 ms**, cached **3.3 ms**, large **94.2 ms**.
Cold/large model counts were exactly `3→33` and `3→1003`; mounted rows peaked at **27**
for both, and no loading frames occurred. Longest sampled frames were 9.5/9.4/9.4 ms.
Cold remembered descendants first appeared at **164.5 ms**, completed at **1664.4 ms**,
and progressed `3→4→5→10` logical rows. Eleven frames showed delayed loading text.
This slower chain sample illustrates that no result-batching window hides descendant latency.

Final packaged sample: cold **36.2 ms**, cached **1.6 ms**, large **99.6 ms**;
maximum mounted rows **27**, with complete sibling publication and no loading frames.
Longest frames were **9.6/9.3/14.4 ms** respectively. Cold remembered descendants first
appeared at **28.3 ms**, completed at **295.7 ms**, and progressed `3→4→5→10` logical rows,
with ten mounted rows, a 9.4 ms longest frame and no loading frames. Baseline remembered
completion time was not captured. Baseline used Refresh to obtain a cold collapsed subtree;
the rewrite remounts Files to obtain that same cold model while preserving expansion memory.
The samples differ in machine load and do not establish a latency improvement or frame budget.

## Validation record

Untouched baseline: typecheck/lint/build passed; 48 focused host tests passed.
Development Electron: 29/35 passed. Packaged Electron: 31/35 passed. These initial suites
partly overlapped, so timing/focus failures require isolated confirmation. Both reproduced
the stale `Chat 2` label in linked-worktree drag and root-replacement diagnostic mismatch
(expected `replaced|quitting`, received `Directory unavailable. Refresh to retry.`).
Development also failed initial inline focus, refresh/restart tree, scroll restart and
large-tree startup; packaged also failed drag hover and initial inline focus.

The first rewrite run passed 27/36. It exposed explicit Refresh/edit deferral, stale-cache
pruning, reveal/anchor ordering and fixtures assuming Refresh discards caches. These were
repaired without removing origin, preservation, failure or cancellation assertions.
A subsequent optional-anchor schema failure affected recovery acknowledgements; the fix
is covered through the actual workspace contract and move/Trash reconciliation.

Current host/module/workspace/file-operation pass: **106/106 passed** across eight files.
Typecheck and lint passed. Deterministic checks cover sorting, identity, delayed feedback,
shared loads, cancellation, stale success/error replies, failed refresh, lazy discovery,
watch readiness/retired callbacks, edit deferral/explicit Refresh, reserved filenames,
10,000-row viewport bounds, wrapping, anchor correction, restoration and contract validation.
Final focused module/workspace verification: **25/25 passed**, including twelve tests in
`host/files-modules.test.ts`. Final typecheck, lint, build, unsigned arm64 packaging and
`git diff --check` passed.

Final combined development run: **39/49 passed**. Combined packaged run: **41/49 passed**.
The same eight test files were selected: `files-viewport`, `files-tree`, `files-watch`,
`files-reveal`, `files-drag`, `files-inline`, `directory-host`, and `files-transfer`.
No failed scenarios were filtered out of those final combined runs.

The eight packaged failures were:

1. Linked-worktree drag: obsolete `Chat 2` label (also fails on untouched main).
2. Option-drag Replace: collision callback absent; passed the later isolated packaged rerun.
3. Restored hidden selection: fixture assumed clearing cached data and exact read counts.
   The final fixture uses explicit failure toggles, verifies retained root rows, and captures
   the context target before successful observation prunes the vanished selection. All error,
   no-retargeting and no-mutation assertions remain. Its final packaged rerun passed.
4. Root-replacement reveal: diagnostic regex mismatch (also fails on untouched main).
5. Clipboard partial-result transfer: expected `b.ts`, received prior copied-source status.
6. Recursive copy responsiveness: fixture `copyRunning` flag remains undefined.
7. Early-open copy destination: editor remains on source text instead of destination disk text.
8. Generated 20,000-file checkout: startup sometimes loses the host socket before mounting
   Files (`SocketCloseError: 1006`). Main's development baseline also failed before any root
   rows appeared. The rewrite scenario passed earlier isolated development runs, but failed
   both final combined runs and the final packaged rerun. No assertion timeout was widened.

Failures 5–7 were reproduced at the same assertions using the untouched main package and
original HEAD transfer tests: **1/4 passed**, with Option-drag Replace passing and all three
transfer cases failing. The preserved baseline app is `/tmp/escode-files-main-baseline.app`;
its `app.asar` SHA-256 is
`9ca21636877a2f0218503abc4c3a88010be8ee02c3b56f4f46c0d4f89f7de397`.
The temporary executable override and original-test copy were removed after comparison.

Development additionally failed hidden-toolbar rename (test-level timeout) and transfer
navigation; both passed in the packaged run. The final focused packaged sequence passed
Option-drag Replace and, after fixture correction, restored-hidden-selection recovery;
the generated-checkout startup remained failing. Both new viewport scenarios passed in the
combined development and packaged runs. The pending-entry and reveal-origin tests passed
their final dedicated run (**2/2**) and the final combined runs.

Complete integrated acceptance is **not claimed**. Baseline failures and intermittent
startup/interaction failures remain visible rather than being converted into passing checks.

Reproduction commands (from the workspace root):

```sh
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
bun run --cwd apps/desktop test -- host/files-modules.test.ts host/workspace.test.ts host/project.test.ts host/files-watch.test.ts host/directories.test.ts host/host-client.test.ts host/file-workflow.test.ts host/file-operations.test.ts
bun run --cwd apps/desktop build
bun run --cwd apps/desktop package
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-viewport.spec.ts tests/files-tree.spec.ts tests/files-watch.spec.ts tests/files-reveal.spec.ts tests/files-drag.spec.ts tests/files-inline.spec.ts tests/directory-host.spec.ts tests/files-transfer.spec.ts
```

Full run logs remain in `/tmp/escode-files-*.log`, notably `final-host`, `final-module`,
`final-ui`, `final-packaged-ui`, `transfer-baseline-ui`, `final-focused-packaged` and
`final-recovery-packaged`. At the end of qualification, the branch and HEAD remained main
and `0a9c981c9b41d0a6bdf6890cff5a301fdc76ffbb`, with the rewrite uncommitted.
The subsequent draft PR publishes those changes on `feat/async-files-tree`.

## Limits

Manual VoiceOver and native Finder behavior were not exercised. Existing host directory
payload/entry limits still apply; virtualization does not increase the wire limits. Missing
watch events converge on explicit recovery triggers, not an unconditional polling guarantee.
The model retains previously resolved directories for the lifetime of the Files view;
whole-checkout preloading is absent. The supplied user's exact workload was not available.
