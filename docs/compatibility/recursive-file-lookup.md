# Recursive checkout file lookup

Implements #110 under specification #93, on the accepted exact-path baseline `5f7e897370b8254616e2196a4fd37a5a48cc7b45`. Scope remains one approved checkout; Agents, recents and automatic freshness have separate owners.

The authenticated `searchFiles` RPC enumerates independently of loaded Files rows. The existing native descriptor launcher enters the validated checkout before executing bundled ripgrep. ripgrep runs without following directory symlinks, with hidden files enabled, no parent/global ignore sources, no configuration arguments and one traversal thread. Checkout-local/nested `.gitignore`, `.ignore`, `.rgignore` and repository `info/exclude` rules apply. Fixed negative globs prune `.git`, `.svn`, `.hg`, `.jj`, `.DS_Store`, `Thumbs.db`, `node_modules`, `bower_components`, and `*.code-search` at every depth. Eligible hidden files and build/dist files remain discoverable independently of Files visibility.

Results are path candidates, not authority to read contents. Activation still calls exact lookup and the shared kept-open editor path, revalidating approval and checkout identity with native no-follow reads, UTF-8/binary checks and the existing 2 MiB limit. A removed/replaced checkout cannot silently retarget a completed scan.

The character scorer, item scoring, query preparation and relevance comparator are extracted from Microsoft VS Code `c254b82c637ec4ee275483e6e4dcb31360a8b7d7`, `src/vs/base/common/fuzzyScorer.ts` and `comparers.ts`. Adaptations remove symbol scoring and unbounded caches, fix platform constants to macOS and use eager standard Intl collation. Every query piece must match; individually quoted pieces require contiguous characters. Matching is case insensitive with case, sequence, boundary, basename/prefix and path relevance. Returned UTF-16 positions drive highlights. No typo correction is added. The shared corpus lives once in `host/lookup.test.ts`, for reuse by later picker work. Research was retrieved from pinned report `ac1258ce68e46e7a2624408388bf37b931cafd73:docs/research/fuzzy-search-vscode-t3.md`; research branches remain unmerged. Microsoft and ripgrep MIT license texts ship in the bundled host notices.

## Resource limits

- Fuzzy query: 256 UTF-16 units; root/path: 4096 units. Existing exact-path input retains its 4096-unit limit. Search request frames are limited to 8 KiB before dispatch, within the existing authenticated socket limits.
- Two concurrent native scans host-wide; excess work fails explicitly with Refresh guidance. Existing connection admission remains 16 requests. Typing waits 120 ms and cancels its previous RPC; socket interruption/disconnection aborts native work. Cancellation leaves the shared chat connection intact.
- Enumeration stops at 20,000 candidate paths, 4 MiB of native stdout, a 16 KiB unfinished path record, or five seconds. Only bounded path metadata is retained; no content index is built. Native stderr retained for failure detection is capped at 2048 characters.
- Scoring charges at most 16 Mi query-by-path cells (the scorer can make both label and path passes), yields every 32 candidates and checks cancellation. A single DP matrix is bounded by the 256-by-4096 input limits. Exhausting the scoring allowance discloses partial coverage.
- At most 100 best results and an estimated 512 KiB serialized result allowance, including positions. Retention is bounded while ranking, rather than collecting all matches. Rendering creates text runs and highlighted positions, not one element for every path character.
- No persistent index, score cache or watcher is introduced. Candidate lists, processes, timers and inherited descriptors end with the request; renderer results end with popup closure. Refresh/reopen enumerates current files and rules.

Capped enumeration/scoring/results, native errors and missing ignore coverage return partial state. Loading and unavailable states are announced; partial searches never claim exhaustive No matches. Traversal order can affect coverage at a cap; refining the query or Refresh does not promise exhaustive coverage beyond these budgets. Automatic freshness is deferred to #113/#114; wider responsiveness qualification belongs to #115.

## Verification

TDD began with a missing-scorer failure, then a missing-native-discovery failure, before implementing those seams. One shared scorer corpus covers positions, camel/separator boundaries, case, prefix/short-name relevance, every-piece matching, quoting, path qualification, misspelling rejection and equal-basename path ranking. One real native fixture covers fixed prunes, local/nested ignore sources, repository excludes, disabled parent/global/config sources, hidden/build files, symlinks, invalid queries, cancellation, concurrent admission and result exhaustion. Authenticated wire tests cover malformed/oversized queries and interruption. Existing exact-path approval/traversal/replacement tests remain the authority owner.

The small `tests/lookup.spec.ts` journey searches an unloaded directory, verifies highlights/ranking, Refreshes a newly created file and activates through the shared kept-open opener. The same journey supports the Vite development server (`ESCODE_LOOKUP_DEV=1`) and packaged installation (`ESCODE_PACKAGED=1`, restricted PATH), without duplicate suites. Existing navigation journeys cover popup cancellation, composer preservation and delayed activation. The rendered dark popup was inspected at the harness viewport; the Impeccable detector reported no findings.

Build prerequisites now include an installed ripgrep (`rg`, tested 15.2.0); `ESCODE_RIPGREP` can choose its build-time executable. The build copies it beside the native helper, and packaging places both in Resources. Runtime lookup does not require ripgrep on PATH. No package dependency was added.

Final command results are recorded in the implementer's return. Full-scale latency/memory qualification and manual VoiceOver were not performed here; the former belongs to #115 and the latter is excluded by the accepted testing amendment.

Observed checks on 2026-10-31:

- Typecheck, lint, build, macOS directory package and `git diff --check`: passed.
- Focused scorer/native, authenticated wire and existing file-workflow tests: 20 passed.
- Existing navigation journeys: 2 passed, including delayed exact validation/read cancellation and composer preservation.
- Shared recursive popup journey: passed in built development Electron (2.6 s), Vite development server (19.0 s while packaging also generated reload events), and packaged restricted-PATH Electron (6.5 s). These are whole-test durations, not query latency measurements or responsiveness acceptance.
- Full unit run: 273 passed, 4 skipped, 3 failed (shutdown initialization polling and two worktree 15-second timeouts). Rerunning both affected files with `--maxWorkers=1` passed all 21 tests in 30.23 s. The broad-run failures remain recorded; no blanket full-suite pass is claimed.
