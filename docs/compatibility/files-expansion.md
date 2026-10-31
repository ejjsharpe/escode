> Historical experiment, rejected for replacement by the asynchronous Files-tree rewrite. The measurements below are reference evidence, not accepted product behavior. Its implementation and tests were archived outside the checkout before removal.

# Files folder expansion

Verified on 2026-10-31 in the shared `main` checkout, starting at
`0a9c981c9b41d0a6bdf6890cff5a301fdc76ffbb` (`origin/main`). No branch switch,
commit, push or PR was made. The open `wayfinder:map` query returned no issues;
the explicit implementation brief authorized this change. The parent's untracked
VS Code research was preserved; its earlier-branch local findings were rechecked.

## Behavior

The host already completes sorting and bulk Git-ignore classification before returning
a directory, and the renderer already publishes complete siblings. Those contracts,
stable path keys, cached visible contents and fresh revalidation remain intact.

Newly loaded listings now resolve only reachable remembered expanded descendants and
publish them together. A timer releases completed listings at most **150 ms after the
first result**, even if another descendant is slow. A leaf with no pending descendants
publishes immediately. Later slow results can still produce additional subtree updates.
Epoch and request-identity checks reject obsolete results and obsolete batch timers.
Rapid collapse/reopen shares a directory request while it remains pending.

The loading row waits **800 ms after its unresolved listing mounts**, following the
[pinned VS Code slow-indicator reference](https://github.com/microsoft/vscode/blob/c198526d8e64ba6f9944e9f7bcc079ed1f6d7fcc/src/vs/base/browser/ui/tree/asyncDataTree.ts#L1141-L1182).
This timer never holds ready data or error feedback. Pending trees/groups expose
`aria-busy` immediately; completion/collapse unmounts and cancels the indicator timer.
The 150 ms batch bound was chosen after 100 ms split the measured three-directory chain.
Neither value is claimed as a universally optimal latency budget.

## Measurements

`tests/files-expansion.spec.ts` uses the real Electron Files component, authenticated
directory path and native helper in a temporary repository/profile. An animation-frame
probe records direct-child and descendant counts, pending/loading state, first content
and completed subtree times. CDP measures renderer script, style and layout work;
separate synchronous helper/Git probes measure native operations without conflating
concurrent directory requests. Temporary production/debug instrumentation was removed.

One baseline/follow-up development comparison, milliseconds rounded to one decimal:

| Scenario | Baseline first / complete | Follow-up first / complete | Baseline → follow-up descendant counts |
| --- | ---: | ---: | --- |
| Cold, 30 siblings | 164.2 / 164.2 | 36.4 / 36.4 | `0,30` → `0,30` |
| Cached reopen, 30 siblings | 6.0 / 6.0 | 0.9 / 0.9 | `30` → `30` |
| Flat, 1,000 siblings | 245.2 / 245.2 | 105.4 / 105.4 | `0,1000` → `0,1000` |
| Remembered chain, 20 ms injected per listing | 65.3 / 864.1 | 156.4 / 156.4 | `0,4,7,9` → `0,9` |

Cold/flat/remembered loading-row frame counts changed from **19/28/104** to **0/0/0**
in those observations. The follow-up flat case recorded **26.7 ms script, 2.9 ms style,
4.3 ms layout** over the observation interval, with a longest sampled frame of **14.5 ms**;
baseline layout was **4.5 ms**, longest frame **13.4 ms**. These are unpaired diagnostics
under variable machine load, with observer and background revalidation work included,
not isolated React commit timings or a speedup claim. RAF observations describe DOM
contents at frame callbacks, not a pixel-level paint trace. An exploratory flat-folder
run also observed a **39.9 ms** frame, so these samples do not establish a frame budget.

The final packaged frame run recorded cold/cached/flat/remembered first content at
**37.6/8.1/101.5/148.0 ms**, with the same atomic row counts and no loading-row frames.
Its flat-folder script/style/layout totals were **23.1/2.9/4.2 ms**, longest sampled frame
**17.1 ms**. Across 39 native reads and 39 bulk-ignore calls, per-operation durations
were **3.6–132.3 ms** and **17.3–23.2 ms** respectively, including the remembered-case
20 ms injected read delays. Native-operation timing excludes transport and queueing.

The forced 1,400 ms descendant case released immediate children at **290.0 ms** in one
follow-up observation, retained accessible pending state, then showed delayed loading
and completed the subtree. This deliberately blocks Electron main; assertions use
renderer timestamps because driver commands are also delayed. Cached reopens retain
their rows throughout revalidation. A collapsed remembered child was never listed.

## Validation

- Typecheck, lint, whitespace checks, development build and unsigned macOS arm64 package passed.
- Focused host checks: **48 passed** across `project`, `files-watch`, `directories`,
  `host-client` and `file-workflow`.
- New expansion checks: complete sorted siblings, cached reopen, remembered descendants,
  1,000-file flat folder, bounded slow descendants, accessible pending/loading feedback,
  rapid collapse/reopen, permission failure/retry and stale replies after Refresh.
- Existing UI checks exercise keyboard/multiple selection, scroll/restart restoration,
  revalidation, ignore filtering, active reveal/focus, inline editing, watch recovery,
  drag hover, cancellation, transfers and authenticated directory boundaries.
- The original 35-scenario development run passed 30. The inline pending-resolution
  interception required preserving the original single listing-completion seam; that
  scenario subsequently passed. Watch focus and generated-tree timeouts passed on rerun.
  A later 36-scenario run passed 35, exposing a stale-row click race in the missing-path
  fixture. That fixture now verifies the unavailable listing and explicit Refresh pruning;
  it no longer races a readiness rescan that correctly removes the missing row.
  Its packaged rerun passed. The persistence poll also now waits for optional Files
  memory instead of throwing before that memory is written; its packaged rerun passed
  (**one scenario, 4.8 seconds**).
- Two pre-existing failures reproduced on the untouched baseline: drag's linked-checkout
  scenario cannot find the old `Chat 2` button label; root-replacement reveal expects
  `/replaced|quitting/` but receives `Directory unavailable. Refresh to retry.` Both were
  excluded from subsequent combined qualification, not represented as passing.
- Combined packaged qualification: **32/36 passed**. The forced slow-descendant case
  initially exceeded the default 5-second final-content assertion. Its final-content
  deadline now accommodates the existing 10-second query/revalidation path; the separate
  early-content and 800 ms feedback assertions remain. It passed in isolation and in the
  final focused run. All **three new scenarios passed** in that final packaged run.
- The final packaged focused run passed **6/8**: new expansion (three), hidden rename,
  reveal and missing-path refresh passed. Its remaining failures were the persistence
  polling exception fixed above, and generated-tree startup with zero root rows. The
  latter also failed in **both** untouched packaged-baseline repetitions. That baseline
  comparison passed **2/6**, also exposing intermittent hidden-rename selection and
  reveal focus failures; the baseline reveal failure was at a different assertion from
  the combined implementation run's scroll timeout. Those two implementation scenarios
  passed on final rerun. Complete combined packaged acceptance is **not claimed**.

The focused host command was:

```sh
bun run --cwd apps/desktop test -- host/project.test.ts host/files-watch.test.ts host/directories.test.ts host/host-client.test.ts host/file-workflow.test.ts
```

Development/packaged UI runs selected `files-expansion`, `files-tree`, `files-watch`,
`files-reveal`, `files-drag`, `files-inline` and `directory-host` Playwright files;
packaged runs used `ESCODE_PACKAGED=1`. The two baseline failures named above were
excluded explicitly with `--grep-invert` after their initial reproduction.

## Limits

The exact user's workload was not supplied: individual siblings appearing one by one
was not reproduced. Remembered subtree rounds and transient loading rows were reproduced.
No VS Code runtime benchmark, live provider turn, live-profile test or manual VoiceOver
check was performed. The fixture uses isolated profiles and no fixed application port.

Virtualization is deferred: the measured flat-folder layout cost does not justify changing
wrapping labels, focus/active-descendant semantics, selection, inline editing, drag targets,
or reveal/scroll restoration. All expanded rows still mount; larger DOMs and deeper/broader
subtrees remain unqualified. No whole-checkout preload, transport change, dependency or
product terminology was introduced.
