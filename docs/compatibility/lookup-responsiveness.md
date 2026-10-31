# Integrated lookup qualification (#115)

Qualification for [checkout/search specification #93](https://github.com/ejjsharpe/escode/issues/93) and [responsiveness #115](https://github.com/ejjsharpe/escode/issues/115), on 2026-10-31. Isolated worktree `t3-42193d35`, delivered on branch `t3/lookup-performance-qualification`, starts at integration `b76b765b5980ceb002b33e2b6065b6fbf616b207`; functional tickets #103–114 are ancestors. No new product concepts or application APIs are introduced. The accepted host authority, recovery, Save, operation-journal and provider-control contracts remain unchanged.

## Method and reproduction

Run from `apps/desktop` after `bun install`, root `bun run build` and `bun run package`:

```sh
ESCODE_LOOKUP_MEASURE=1 ESCODE_LOOKUP_FILES=12000 ESCODE_LOOKUP_DEV=1 node_modules/.bin/playwright test lookup.spec.ts
ESCODE_LOOKUP_MEASURE=1 ESCODE_LOOKUP_FILES=12000 ESCODE_PACKAGED=1 node_modules/.bin/playwright test lookup.spec.ts
ESCODE_LOOKUP_MEASURE=1 ESCODE_LOOKUP_FILES=12000 node_modules/.bin/playwright test concurrency.spec.ts
ESCODE_LOOKUP_MEASURE=1 ESCODE_LOOKUP_FILES=12000 ESCODE_PACKAGED=1 node_modules/.bin/playwright test concurrency.spec.ts
```

These parameterize existing owners, not a second acceptance suite. Without the measurement flag ordinary journeys keep their original fixture and assertions. The lookup fixture adds 12,000 seven-byte files (`fixture`) in 120 directories, plus its existing linked-checkout targets, ignored history and policy files. Its linked worktree receives the same tracked dataset. The nine-root scope fixture has 17 files per root; eight roots contribute 136 matches capped to 100, while the ninth is excluded explicitly. The final local exhaustion fixture adds 21,000 files in 210 directories to one of these roots. Native preflight checks directory entries, so it can stop before enumerating any eligible candidates. The client retains 200 seeded recent metadata entries including a closed root, excluded names and deliberately opened ignored files. One root is physically removed during multi-root lookup.

Latency is Playwright action-to-observable-result wall time, including the 120 ms debounce, IPC, ranking, React and assertion polling. “First discovery” means the first typed search after app launch; OS disk caches are not flushed. Warm search repeats native discovery; there is no retained index. Typing uses seven replacement queries 140 ms apart, allowing prior work to start. Ten popup cycles start a query then Escape after 140 ms. The cold/warm numbers are individual observations, not percentile SLOs. Policy hide samples include write-to-visible convergence; the larger policy/file duration includes the entire existing mutation/retry sequence.

The main-process `monitorEventLoopDelay` histogram uses 10 ms resolution. Renderer samples are actual intervals of a requested 20 ms timer (reported gaps include the nominal 20 ms). Electron working-set samples every 250 ms include Browser, Tab, GPU and Utility processes, excluding transient native children, filesystem cache and the test runner. They are resident working sets, not retained-heap/leak estimates. OS `lsof` counts numeric main-process descriptors; `ps` checks direct native helper/ripgrep children after a 750 ms settle. Equal-root before/after cancellation checkpoints distinguish popup cleanup from descriptors owned by newly opened checkouts. Host observation and transport interruption tests retain their distinct watcher/admission/disconnect contracts.

Chat measurements reuse the existing fake-provider concurrency journey. During its existing approval/reply/Stop checks the renderer replaces a real authenticated 12,000-file lookup every 150 ms. Stop latency ends at visible Ready. The approval/reply duration includes the journey's deliberate persistence barrier and duplicate-response checks; it is not isolated provider/network latency. No paid provider is used.

## Runtime identity

macOS 26.3.1 (25D2128), arm64; shell Node 26.13.0, Bun 1.4.4, ripgrep 15.2.0. Electron 45.1.0 uses Node 24.22.1, Chromium 156.0.8078.49 and V8 15.6.75.19-electron.0. The actual `.app` runs with PATH `/usr/bin:/bin`; bundled ripgrep and native ignore preflight execute outside ASAR. Development uses the real Vite server and Electron host. Build inputs are the integration application code above; this ticket changes only tests and evidence.

SHA-256 of built host: `e96932e006bf34e728d49c4393386f8d148526814354ad66d14a86f936b8eafb`.
Native helper in both dist and package: `98d2fd6d8c261645c15113bdb4e3008dae0b10cbc35fc2260540cfdf2e3fae13`.
Ripgrep in both: `db94328a1765b7d5fd4ee6a94442ebf24a78d1fce246fe3219b578561ab3dfc1`.
Packaged `app.asar`: `bf833e0aac170b4d31a120d7728a1710714977a8684732b79fe0a972f5fda731`.

Installed ripgrep is a build prerequisite (`ESCODE_RIPGREP` selects its executable); packaging copies it, so runtime does not consult PATH for rg. A new distinct fault case in the existing native lookup owner copies the native helper without its rg sibling: discovery must return explicit incomplete/unavailable coverage, exact reads still work, and restoring the sibling lets the same checkout search successfully. This verifies the real executable failure/retry path without mutating the application package or weakening authority.

## Concrete limits

Existing [recursive lookup](recursive-file-lookup.md) and [recents](recent-files.md) budgets remain authoritative: eight roots, one sequential scan per popup; two concurrent native scans and sixteen observation subscriptions host-wide (at most 32 native watches); five-second native deadline; 20,000 candidate paths, 4 MiB stdout and 16 KiB unfinished record; policy preflight 20,000 entries and 128 levels; query 256 units, path 4096; scoring 16 Mi cells with yields every 32 candidates; 100 results and approximately 512 KiB response/aggregation; 200 history pairs and 32,768 units. History raises the search-frame allowance to 256 KiB; the earlier 8 KiB no-history limit in the historical #110 section is superseded by #112. Existing editor binary/UTF-8/no-follow/2 MiB rules still apply.

The operational 21,000-file fixture intentionally produces incomplete coverage with no false exhaustive “No matches”. Refining a query cannot overcome native preflight's entry cap: reducing/pruning the dataset or a later bounded enumerator design is needed. Large ignored subtrees other than fixed prunes still count toward preflight. Policy reads are non-atomic; notifications are best effort, and continuous churn can postpone a settled result. Refresh/reopen retries failed observation. Working-set growth includes Monaco/editor initialization and multi-workspace navigation; these short runs do not prove a steady-state memory plateau or exhaustive capacity qualification.

## Ownership of the twelve accepted examples

| Accepted example | Existing primary owners and evidence |
| --- | --- |
| 1 Fixed/deduplicated tabs, branch identity, scoped Chats | #103 `navigation.spec.ts`, `project.spec.ts`; checkout navigation evidence in README |
| 2 Same-path buffers and normal/comparison sharing | #94/#95 `file-tabs.spec.ts`, `editable-diff.spec.ts`; #111 lookup linked-root activation in `lookup.spec.ts`; [file-tab integration](file-tabs-integration.md) |
| 3 Local/Agents/open-tab scope and closure | #109 navigation lookup case; #111 lookup and held-wire navigation case; [recursive lookup](recursive-file-lookup.md) |
| 4 Unloaded files, matching, ranking, highlights | #110 `lookup.spec.ts`; single scorer corpus `host/lookup.test.ts`; recursive evidence |
| 5 Exclusions, history/exact exceptions and authority | #110 native lookup fixture; #112 owning popup history case; #109 `file-workflows.test.ts` and navigation; [exact lookup](exact-file-lookup.md), [recents](recent-files.md) |
| 6 Escape, focus, dirty/composer text and delayed activation | #109 both `navigation.spec.ts` journeys; #94/#96 shared kept-open behavior; exact lookup evidence |
| 7 Persisted scoped recents and deduplication | #112 existing `lookup.spec.ts` restart/history journey and `workspace.test.ts` validation; recents evidence |
| 8 Captured local context, Agents picker/defaults | #106 `project-drafts.spec.ts`; #107 `agents.spec.ts`; #108 `agents.spec.ts` and `workspace.test.ts`; [drafts](checkout-drafts.md), [defaults](project-defaults.md) |
| 9 Draft handoff and first-Send reservation lifecycle | #106 `project-drafts.spec.ts`, `worktree-drafts.spec.ts`; host draft/worktree/command fault seams; drafts evidence |
| 10 Scoped close and recovery without stopping chat | #104 `lifecycle-races.spec.ts`; #105 `availability.spec.ts`; #98 file close and #99/#101 recovery/operation owners; [close](checkout-close.md), [recovery](checkout-recovery.md) |
| 11 Missing/replaced identities and partial healthy roots | #105 availability; #109 exact navigation/workflow seam; #111 missing-root lookup case; recovery and recursive evidence |
| 12 Cancellation, bounds, freshness, cleanup, keyboard announcements | #110–114 existing lookup/native/host-client/navigation owners; this ticket parameterizes their runtime measurements; recursive evidence. Manual VoiceOver excluded by the accepted amendment. |

## Retained failure history and root repairs

Prior observations remain evidence, not erased by a faster repeat: #108 worktree-draft journey timed out at 120 s and then passed unchanged with tracing in 18.4 s; #107 had a 42.8 s run against a 45 s budget. #110's full parallel host run failed three timing checks, then its affected 21 serial checks passed. #114's earlier combined popup run was 46.2 s. These are whole journeys, not lookup query measurements.

Known root fixes are retained: #107's project-draft fixture now waits for the displayed exact checkout after native opening before acting on its Chats controls. #105's denied watcher acquisition now reports a stream error without defecting an unrelated authenticated workspace write (the prior Quit teardown retained state correctly). #114 filters irrelevant `.git/` status/index churn while retaining `info/exclude` and repository replacement invalidations; otherwise the combined cap journey repeatedly restarted discovery. Native policy preflight also rejects symlinked ignore files. See [checkout drafts](checkout-drafts.md), [checkout recovery](checkout-recovery.md) and the integration section of [recursive lookup](recursive-file-lookup.md) for red/green evidence and earlier failures.

This ticket's first instrumented Vite run overlapped packaging, which triggered Vite reloads. It passed, but is retained as a disturbed sample. Initial timing labeled the first measured `wkb` search “cold” even though three prior queries had run; final instrumentation instead measures the first typed query after launch and labels `wkb` warm. Earlier samples remain labeled as originally emitted in the raw evidence, not used to claim a cold result.

The first loaded chat-control run failed before measurement at its old expectation that closing Alpha selects Agents. Beta remained open, so the accepted #104 adjacent-tab rule correctly selected Beta. The owning concurrency journey now asserts Beta's header, explicitly navigates to Agents and retains its existing pending request/text/provider identity assertions. This is a fixture repair at the approved Electron seam: observed red first, then the smallest correction. No application close behavior or timeout was changed.

The broader regression run also exposed the existing file-operation unauthorized-sender diagnostic assertion: denial occurred, but `Effect.tryPromise` wrapped the original bootstrap rejection in `Cause.UnknownError`. A new approved host-client seam case failed on that generic message and requires a second rejected call to bootstrap afresh. The shared query failure path now closes its failed session as before, then unwraps only Effect's known UnknownError wrapper. The focused six-test host-client suite passed. Domain errors, cancellation, admission, authentication and file-operation behavior are unchanged; the security journey's original diagnostic and disk-byte assertions remain intact. The initial 281-test pass predates this minimal runtime repair; final build/runtime hashes and reruns are reported separately below.

The cursor/restoration journey timed out twice (broad run and unchanged traced repeat). Its trace completed the editor/restoration, disk-byte and index assertions in about four seconds and then stalled at `app.close()`. The fixture observed bytes before the Save action's recovery/status reconciliation had completed; the established closer vetoes Quit during an in-flight Save. Waiting for the existing Save control to be enabled before teardown repaired that synchronization without changing product preservation gates or timeouts. The unchanged authority journey and repaired cursor journey then both passed (1.8 s and 3.9 s). No new private test API was added.

A later packaged measurement overlapped replacement of the package during the diagnostic repair's rebuild and failed while opening a linked checkout after restart. This run is retained as disturbed, not attributed to a search regression; delivery measurements run against the completed stable bundle. Local test and other worktree activity were present during qualification, so timings are observations under this machine's workload rather than controlled microbenchmarks. Memory sums may count shared resident mappings more than once. Eight large roots and long-duration heap/native-memory plateau are not qualified by the two-large-root/four-root scope and eight-small-root cap fixtures.

## Delivery measurements

The [raw samples](lookup-responsiveness-samples.json) retain initial, disturbed and delivery runs with their original labels, runtime versions, per-phase memory and descriptor snapshots. Delivery Vite and packaged journeys both passed in about 1.1 minutes each. These delivery measurements include the diagnostic repair; `main.cjs`, filesystem helper and ripgrep hashes above remain unchanged. Delivery preload SHA-256 is `7a155c749c6ba3f4c1cb2b8c07e9eca010233417db40802d4171a635fc946cbe`; delivery `app.asar` is `4a2eff5e24bc6a854e70375c8d7583c5c707f41f359572eb18d8e3a658180f43`.

| Observed phase | Vite development | Packaged, restricted PATH |
| --- | ---: | ---: |
| First typed discovery after launch | 797 ms | 822 ms |
| Warm `wkb` / `workbench` | 298 / 807 ms | 296 / 346 ms |
| Seven queries with 140 ms spacing, final result visible | 1,295 ms | 1,272 ms |
| Ten popup query/Escape cycles | 2,023 ms | 2,031 ms |
| Each root/nested policy hide, settled empty search | 788–863 ms | 788–842 ms |
| External create to visible result | 820 ms | 793 ms |
| Complete policy/file mutation/retry segment | 27.95 s | 28.54 s |
| Restart blank recents | 598 ms | 609 ms |
| Four-root scope, two 12k-file roots and one missing root | 873 ms | 934 ms |
| Nine small roots, eight-root/100-result disclosure | 871 ms | 848 ms |
| 21k-file preflight exhaustion with explicit incomplete coverage | 336 ms | 343 ms |
| Main loop p99 / maximum, before restart | 65.5 / 188.7 ms | 54.4 / 113.5 ms |
| Main loop p99 / maximum, restart/navigation/exhaustion segment | 85.3 / 221.1 ms | 81.2 / 258.5 ms |
| Renderer timer p99 / maximum gap, before restart | 22.5 / 64.2 ms | 22.6 / 62.9 ms |
| Renderer timer p99 / maximum gap, after restart | 26.9 / 48.0 ms | 25.4 / 57.2 ms |
| Peak summed Electron working sets, before / after restart | 727 / 746 MiB | 741 / 648 MiB |

Both delivery cancellation checkpoints held 75 numeric main-process descriptors before and after ten cycles, with no direct native search child at either checkpoint. The initial no-project-to-open-project snapshot rises 73→75; the restart-to-nine-open-checkouts snapshot rises 72→86 and is not an equal-scope leak comparison. All settled snapshots have no native search child. The owning host tests verify release/re-admission and disconnected stream cleanup separately. No score/candidate index survives a request.

The fake-provider chat journey passed in built Electron (10.3 s) and restricted-PATH packaged Electron (11.3 s). With 12k-file lookup replacement every 150 ms, approval/reply journey time was 957 / 692 ms and Stop-to-Ready was 211 / 210 ms respectively. Those measurements preceded the diagnostic-only repair, which changes failed-query reporting rather than successful control or discovery; the final packaged authority and navigation checks exercise the repaired client. The longest observed main-loop pause is a reason to retain asynchronous discovery/yields and bounded admission, not a claim of frame-perfect responsiveness.

The native budget can consume up to five seconds per root, sequentially across up to eight roots; there is no separate whole-popup deadline. Cancellation stops the current scan and prevents the rest of the obsolete scope from launching. The measured subsecond scope results do not promise that latency at every cap or under continuous filesystem churn.

## Verification and remaining findings

Typecheck, lint, desktop build, macOS directory packaging and whitespace validation passed. The final complete one-worker host run passed **282 tests**, with four existing skips, in 175.27 s. The initial pre-repair run passed 281 with four skips in 153.53 s. The new bootstrap diagnostic case was observed red, then the six-test host-client file passed after the shared repair.

The broad Electron command ran navigation, availability, Agents/file recovery, file operations, file tabs/close, lifecycle/races, project Save/conflict, captured drafts and deferred worktrees: **38 passed, four failed**, with three teardown errors in 8.2 minutes. Failures were the original unauthorized-bootstrap message (fixed and rerun), cursor Save/teardown race (fixture fixed and rerun), and both old project Save/conflict cases. Tracing the latter located an ambiguous status locator: the integrated file-tab UI can show both “No changes” and the editor status. The fixture now targets its existing focusable editor status. Its old implicit sidebar→file-view expectations are updated to choose the explicit File view selector, retaining comparison persistence, Save/conflict/overwrite/reload/disk/index assertions. Timeouts and product behavior are unchanged.

The final focused packaged regression batch passed nine cases (all five availability/identity/recovery/capability cases, authority, cursor restoration and both navigation/race cases); its remaining smoke case exposed an outdated exact preload capability list. That owning smoke assertion now includes the three already-integrated authenticated lookup methods (`observeFiles`, `searchFiles`, `lookupFile`), preserving the exact capability allowlist and absence of Node `require`.

The project fixture also explicitly selects normal view after conflict Reload (the accepted comparison-view contract retains that view), and uses `untracked` for this uncommitted repository's comparison. Final existing project cases passed in development and package (5.6 s each), alongside the retained-project close/removal case (10.5 s). The updated packaged smoke check passed (2.8 s). These are fixture alignment repairs; save, conflict and comparison implementation was not altered.

Additional Agents runs exposed two findings. The unrelated long-history/composer geometry assertion sees a stable composer bottom at 800.5 px in an 800 px viewport. A polling diagnostic confirmed it persists rather than merely settling late; that diagnostic was reverted, and the original strict assertion is retained. This is a remaining baseline layout failure, not a lookup latency or authority pass, and no full Agents-suite pass is claimed.

The picker/default journey passed once and then failed its retained alternate prompt repeatedly (three traced repeats included). Diagnostics showed that at the fixture's alternate-prompt fill the newly requested draft was not yet in the row list and local composer storage still contained only the original prompt. Its context-text assertion could match a checkout option in the old conversation before creation completed. The fixture now waits for the existing picker to close and the fifth row to appear before filling the alternate composer, using the same completion seam as its first creation. All prompt/context/MRU/restart/unavailable-default assertions remain intact. Temporary storage diagnostics were removed; no composer implementation or persistence guarantee was changed.

Final focused follow-up: the repaired picker/default journey passed three consecutive development runs (24.8 s total, individual final two 7.4/7.7 s) and restricted-PATH packaged (7.5 s). The unchanged captured-project-draft journey passed three development repeats (13.8, 13.5, 12.8 s; 41.8 s total). The broad run's deferred-worktree case passed in 12.2 s without changing its 120-second allowance. Earlier 120-second/42.8-second observations above remain; these shorter samples do not prove arbitrary-load timing.

The delivered runtime's fake-provider concurrency journey also passed again: built 10.5 s, packaged 10.2 s. Approval/reply segment was 974 / 963 ms and Stop-to-Ready was 201 / 93 ms, replacing a real 12k-file search every 150 ms. Raw delivery records include these values alongside the earlier observations. Successful chat lifecycle, shared prompts and provider single-dispatch assertions were preserved.

Latest integration `b76b765b5980ceb002b33e2b6065b6fbf616b207` was merged into this isolated branch before return (`Already up to date`); neither integration nor issues nor PRs were mutated. No live provider turn, manual VoiceOver, long-duration soak, native-child peak-memory estimate or exhaustive eight-large-root capacity claim is made. The outstanding Agents fractional-pixel layout assertion is explicitly retained; all four failures from the broad 42-case batch have focused passing reruns after the repairs above, without claiming a new whole-batch green run.
