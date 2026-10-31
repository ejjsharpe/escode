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
Filename rows now use fixed 28 px single-line labels with ellipsis. Full names remain
available on hover and through accessibility; only inline fields and diagnostics need
height measurements. The user selected this behavior after the original wrapping qualification. Navigation takes precedence over anchor correction.
An optional validated scroll anchor persists entry identity and within-row offset; known
move/Trash outcomes reconcile it alongside existing Files memory.

Recursive JSX, the renderer cache and pending-load map were replaced. Existing creation,
rename, transfer, Trash, dirty-buffer and journal authority remain in their prior workflows.

## Intentional differences and scope

- Cached reopening uses resolved data until invalidated, replacing unconditional reads.
  Watch readiness, observation, focus/checkout return and Refresh recover stale data.
- Results publish immediately. Only loading feedback waits 800 ms. There is no 150 ms
  result-batching window. Remembered descendants can appear in successive complete levels.
- Labels use one line with ellipsis following the user’s 2026-10-31 decision; no
  compact-folder presentation, file nesting or configurable VS Code sorting was added. Existing escode shortcuts, selection and Git-ignore semantics remain.
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

## Stabilization follow-up (2026-10-31, PR #143)

Verified the supplied worktree `/Users/elliotsharpe/.t3/worktrees/escode/t3-6880fb8f`,
branch `feat/async-files-tree`, HEAD `0801c9dc9814296ab029d95675d4639c0c3dabd3`
and clean working tree before editing. No open `wayfinder:map` issues were returned.
Implementation, commits and pushing this draft PR were explicitly authorized.

### Diagnosis and repairs

- **Startup/transport product defect:** two simultaneous 20,000-entry Git status
  replies through `startHost`/`createHostClient` reproduce `SocketCloseError: 1006`
  in 48 ms, independently of Files mounting. `BoundedWebSocket.send` terminated
  when a previously queued reply exceeded 1 MiB, although the RPC response budget
  admits ordinary replies up to 2 MiB and file replies up to 32 MiB. The physical
  output guard now checks queued bytes **plus the new write** against the existing
  32 MiB file-frame bound. RPC per-response and unacknowledged-stream budgets,
  incoming frame validation and admission limits remain enforced. The regression
  test asserts both complete status replies and a subsequent Files listing; it
  failed before the repair and passes after it. No timeout changed.
- **Early-open destination product defect (also observed on main):** the shared
  opener rejected all opens while a transfer held `closeInFlight`, despite file-tab
  navigation remaining available. It now admits opens during transfer progress;
  mutation, save and close gates remain. The Electron scenario verifies destination
  disk text before delivery, copied unsaved text after delivery, model URI/language,
  undo/redo, restart and external-save conflict baseline.
- **Clipboard fixture race (also observed on main):** deleting a source immediately
  after Cmd+X raced asynchronous host identity capture. Wait for successful Cut
  status before deleting; also await completion of the preceding transfer before
  capture. Partial-result, retry, destination-byte and no-extra-copy assertions remain.
- **Recursive-copy fixture race (also observed on main):** a failure status arrives
  before transfer reconciliation releases the renderer gate. Starting Duplicate
  then could be rejected before native spawn (`copyRunning` stayed undefined).
  Await disappearance of the preceding transfer's progress indicator. The repaired
  run observed native copy for 3856 ms and visible Stop for 21 ms while copy was
  running, and checked every destination binary file.
- **Linked-worktree fixture:** Chats is checkout-scoped; `Chat 2` in the originating
  checkout no longer selects a linked checkout. Open that existing linked checkout
  through the native chooser during pending drag confirmation. Keep both checkout
  identities, exact destination bytes and no foreign mutation assertions.
- **Root-replacement fixture:** the directory RPC intentionally maps adapter
  exceptions to `Directory unavailable. Refresh to retry.`. Assert that exact
  diagnostic; retain the separate replaced/quitting context denial, empty Finder
  targets and watch-denial checks.

The initial follow-up serial development transfer/watch run passed 12/15: it
reproduced recursive-copy, early-open and generated-checkout startup failures;
clipboard partial results passed that run. After repairs, the same run passed
15/15. Logs: `/tmp/escode-stabilize-focus.log`; transport red/green logs:
`/tmp/escode-stabilize-transport-{red,green}.log`.

The next complete development run passed **49/49**. Its corresponding packaged run
passed **47/49**, exposing two additional intermittent inline cases: creation's
shared opener scheduled Monaco focus after Files restored tree focus (product race),
and the selected-entry fault was armed after Refresh could successfully resolve the
cached directory (fixture race). Inline creation now activates its kept-open file
without scheduling an editor focus request; Files retains focus ownership. The
fault is armed before explicit Refresh. Both scenarios then passed **6/6** serial
development repetitions. The first complete development run also exposed an asynchronous Copy Path
fixture race; clipboard/Finder assertions now await their exact expected results.
The earlier 47/49 development run additionally caught an overbroad diagnostic fixture
edit: Quit still returns its specific quitting denial; only root replacement uses
the generic directory diagnostic. That edit was corrected before the 49/49 run.

Before the final inline repair, Option-drag Replace, hidden-toolbar rename,
transfer navigation and 20,000-file startup each passed three additional serial
packaged repetitions (**12/12**). No further product defect was established for
those historical Option-drag/hidden-toolbar/transfer-navigation failures; finite
passing runs do not establish their historical cause or eliminate all flakiness.

A later full development pass was **48/49**: dirty-destination transfer copied
`target baseline` instead of `source baseline`. Its initial `.nth(0)` basename
selector raced child listing publication and could edit the root source as the
"destination", then copy the actual destination. The fixture now selects exact
`data-path` rows and asserts each editor model URI before typing. No byte, dirty
collision, persistence or restart assertion was relaxed.

The complete final-code development run passed **49/49**. The packaged run then
caught a persistence fixture race: its poll dereferenced `views[root].files` before
that view's first durable snapshot existed, throwing instead of retrying. Optional
access now returns undefined until the same exact `b.txt` focus assertion succeeds.
This changes readiness handling only, not the asserted restoration or disk contents.

### Final results and reproducible commands

These results supersede the historical qualification limits above for automated checks:

| Check | Result |
| --- | --- |
| Eight host/model/workspace/operation files listed in the original commands | 107/107 |
| `host/editor-transactions.test.ts` | 9/9 |
| Complete development Electron suite, final product code | 49/49 (4.6 min) |
| Development tree restoration after the final polling guard | 3/3 repetitions |
| Complete packaged Electron suite, final product code and fixtures | 49/49 (2.7 min) |
| Packaged Option Replace, hidden-toolbar rename, transfer navigation, large startup | 12/12 repetitions |
| Development / packaged repaired inline cases | 6/6 / 6/6 repetitions |
| Packaged exact-path dirty-destination transfer | 3/3 repetitions |
| Typecheck, lint, build, unsigned arm64 package, whitespace | Passed |

The complete development run preceded only the final fixture's optional polling access;
that updated fixture passed all three subsequent development runs. Both complete suites
selected all eight files without skipping or filtering failures. Repetitions were separate,
serial runs with temporary repositories/profiles. The last package has `app.asar` SHA-256
`cad86d3c54a7681039b168aca9122a8043c0bd27d149d0ebb52531b05d43fc78`.
The application was not installed; the user's running app/profile was not targeted.
No live provider turns or dependency additions were used.

Use the eight-file host and complete Electron commands above. Additional commands:

```sh
bun run --cwd apps/desktop test -- host/editor-transactions.test.ts
bun run --cwd apps/desktop smoke -- tests/files-tree.spec.ts -g 'lazy tree keyboard' --repeat-each=3
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-drag.spec.ts tests/files-inline.spec.ts tests/files-transfer.spec.ts tests/files-watch.spec.ts -g 'Option-drag Replace|hidden selected entry renames through toolbar|pending transfer preserves its origin across navigation|generated tree loads only' --repeat-each=3
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-inline.spec.ts -g 'inline create and rename:|restored hidden selection' --repeat-each=3
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-transfer.spec.ts -g 'dirty destination blocks Replace' --repeat-each=3
```

Final logs are `/tmp/escode-stabilize-host.log`, `-activation.log`,
`-complete-development.log`, `-tree-repeat-development.log`, `-accepted-packaged.log`,
`-repeat-packaged.log`, `-inline-repeat.log`, `-qualified-repeat-packaged.log`,
`-transfer-repeat-packaged.log`, and `-final-{typecheck,lint,build,package}.log`,
all with the `/tmp/escode-stabilize` prefix. Earlier failed logs remain alongside them.

### Remaining validation

Integrated acceptance is not claimed. Manual VoiceOver must still verify logical
navigation/selection, active-descendant announcements, complete single-line label names, recycled rows,
inline editing and reveal/focus restoration in this build. Native Finder import/drag,
Finder reveal and Trash recovery still need their user-owned manual validation.
Historical Option-drag/hidden-toolbar/transfer-navigation flakiness was not reproduced
in the repeated final checks; its exact original cause remains unestablished.
Existing capacity limits and cache/watch limitations above still apply. The physical
socket output bound is now 32 MiB including the next write, while smaller RPC admission,
response and stream budgets remain in force. Passing fixtures do not establish unlimited
checkout capacity or exhaustive timing coverage.


## Single-line filename follow-up (2026-10-31)

The user reported a fast visual ripple on the first expansion of Bluesky folders,
including `plugins` and `src`, and then explicitly selected single-line labels instead
of filename wrapping. This supersedes the wrapping preservation requirement above.

A real-mouse cold/warm probe used the actual Bluesky checkout in a separate temporary
profile, without editing its files. In `plugins`, all nine siblings arrived together;
the first sampled visible frame at 65.8 ms used 28 px offsets for filenames whose
actual wrapped height was 45 px. Rows overlapped until the 72.2 ms sample. Cached
reopening retained measurements and did not overlap. `src` published all 18 children
together and did not show overlap in that probe. These observations establish a cold
wrapping defect; they do not establish serial directory-result streaming or explain
every possible visual symptom in every folder.

A regression at the actual Electron interface failed before repair on first-frame
overlap. An interim pre-paint measurement repair passed three repetitions; the user
then removed the need for wrapping. The final change uses fixed 28 px filename rows,
CSS ellipsis, full-name titles and unchanged complete accessible labels. Filename rows
are excluded from ResizeObserver measurement. Inline fields and diagnostics retain
variable height and pre-paint measurement; leaving inline edit restores the normal
28 px geometry. Reveal, keyboard navigation and restoration no longer wait for a
filename measurement. No delay, batching window, preload or dependency was added.

The revised real-checkout cold/warm probe reported zero overlap frames and zero
filename height measurements in `plugins` and `src`. Visual inspection confirmed
ellipsis and stable single-line rows. The viewport regression now asserts complete
siblings, fixed height and no overlap from their first visible frame. The long-name
viewport test retains full-name accessibility, title, truncation, restoration,
selection and mounted active-descendant assertions. The prior wrapped-height
expectation is replaced by the user-authorized exact 28 px requirement.

Focused verification: 12/12 model/viewport tests, 18/18 Electron viewport/inline tests,
typecheck, lint, build and unsigned packaging passed. The scoped Impeccable mechanical
detector reported no findings. The interrupted wrapping-only full suite did not
complete and is not counted as passing. Full single-line results follow below.

Final single-line validation:

- Complete serial development Electron run: **50/50 passed** (2.8 min).
- Initial complete serial packaged run: **49/50 passed** (3.3 min). The existing
  inline-create/rename scenario lost its input after reporting an occupied-name
  collision, while the fixture took screenshots; the subsequent fill timed out.
  Its exact cause remains unestablished. No assertion was removed or weakened.
- That unchanged inline scenario passed **3/3 isolated packaged repetitions** with
  tracing (13.6 s). A fresh unfiltered packaged run then passed **50/50** (2.7 min).
  This confirms the final run; it does not erase the intermittent failure above.
- 12/12 module tests, 18/18 focused development viewport/inline tests, typecheck,
  lint, build, unsigned arm64 packaging, whitespace and the scoped design detector
  passed. The package's `app.asar` SHA-256 is
  `564ec29d8d4a76c4a31020ffe12d4df0685ddb6aa7e550b546c341e9390e9826`.

The complete runs used the same eight-file command above, with the new viewport
regression increasing the total from 49 to 50. Additional commands:

```sh
bun run --cwd apps/desktop test -- host/files-modules.test.ts
bun run --cwd apps/desktop smoke -- tests/files-viewport.spec.ts tests/files-inline.spec.ts
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-inline.spec.ts -g 'inline create and rename:' --repeat-each=3 --trace on
```

Logs: `/tmp/escode-single-line-{modules,focused,development,packaged,inline-repeat,final-packaged,typecheck,lint,build,package}.log`.
The initial packaged failure is also preserved at
`/tmp/escode-single-line-inline-failure.md`; the real-checkout probe and visual capture
are `/tmp/escode-single-line-bluesky.log` and `/tmp/escode-single-line-plugins.png`.
The selected labels are available in the existing temporary-profile dev window via
the restored local dev server. No installation or live provider turn was used.
Manual VoiceOver/Finder validation and the exact cause of the intermittent inline
failure remain outstanding; integrated acceptance is not claimed.

## Main merge conflict resolution (2026-10-31)

Merged `origin/main` at `37bb837` into the PR branch from `76adbf1`, without rewriting
branch history. The checkout was clean before merging. Four textual conflicts were
resolved: workspace tests, the renderer file opener, transfer fixtures and tree fixtures.
Both scroll-anchor validation and fresh SQLite approval tests are retained. Main's
`transferNavigation` ref keeps transfer-time opening available while closing the gate
during reconciliation; Files inline creation retains its focus-preserving activation.
The single-line viewport, host output guard and optional scroll-anchor contract remain.

Main's JSON-to-SQLite cutover required adapting PR-added recovery readers and restart
fixtures. They now use the existing `readRecoveryFixture` helper and tolerate absence
of the superseded receipt-lock file after confirmed fixture process exit. The linked
worktree fixture selects the tab by its exact checkout path and pressed-state attribute,
then scopes Files navigation to the visible checkout. The forged-drop assertion is
scoped to the Files alert so Monaco's two alert nodes cannot cause a strict-selector
failure. Original byte, no-mutation, recovery, selection and focus assertions remain.

The first development pass was 44/50 while these fixture adaptations were incomplete;
the first packaged pass was 49/50 before the exact tab selector was corrected. The
corrected linked-worktree scenario passed its dedicated development run (1/1).
Host/module/workspace/file-operation/editor tests passed 117/117 across nine files;
typecheck and build passed. Lint passed with four pre-existing warnings from unchanged
main files. Whitespace checks against `origin/main` passed; imported evidence logs
retain main's original whitespace rather than altering unrelated evidence bytes.

Final merged-tree validation: **50/50 development** and **50/50 packaged** Electron
checks passed (2.7 min each), unfiltered and serial with temporary repositories/profiles.
All 117 focused host tests passed. Typecheck, lint (the four existing main warnings),
build and unsigned packaging passed. The PR diff against main passes whitespace checks.
Logs are `/tmp/escode-143-merge-{host,typecheck,lint,build,package,linked}.log` and
`/tmp/escode-143-merge-final-{development,packaged}.log`; initial failed runs remain in
`/tmp/escode-143-merge-{development,packaged}.log`. No assertions were skipped or
removed. No installation, live provider turn, manual VoiceOver or native Finder
validation was performed. The user had already marked the PR ready; its status is
preserved, and merging the PR itself is not part of this action.
