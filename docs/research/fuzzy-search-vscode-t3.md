# Fuzzy lookup and content search: VS Code and T3 Code

Research for [Specify search throughout escode](https://github.com/ejjsharpe/escode/issues/87), answering its [upstream implementation question](https://github.com/ejjsharpe/escode/issues/88). This is evidence for the subsequent design interview, not an escode specification or library selection.

## Revisions and method

Inspected on **2026-10-30 UTC**. `git ls-remote … HEAD` and shallow checkouts independently confirmed:

- **VS Code:** `c254b82c637ec4ee275483e6e4dcb31360a8b7d7`, committed 2026-10-30 23:18:45 UTC.
- **T3 Code:** `96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3`, committed 2026-10-30 23:31:19 UTC.
- **FFF dependency source:** `95fd777c2529fc7b4d7572dabff64cc07268f2c5`, committed 2026-09-21 04:29:58 UTC. T3 pins `@ff-labs/fff-node` **0.11.0**, with a repository patch; npm's version metadata identifies that source revision as `gitHead`. [T3 dependency][t-package], [lockfile][t-lock], [version metadata](https://registry.npmjs.org/@ff-labs%2ffff-node/0.11.0), [FFF release][f-package].

These are upstream development revisions, not assertions about installed releases or this session's T3 distribution. I traced callers into matchers, services and dependencies, read relevant tests, and browsed primary GitHub/raw sources to verify them. Small utility examples below were actually executed; full applications, native FFF binaries and performance benchmarks were not run.

## Side-by-side findings

“Ordered subsequence” means every query character must appear in order, allowing intervening target characters. It does **not** imply substitution or transposition correction. Literal substring, word-prefix/token matching, typo correction, regex and semantic retrieval are separate behaviors.

| Surface | VS Code | T3 Code |
| --- | --- | --- |
| Files / paths | Ordered subsequence candidates; structured fuzzy ranking and history groups. [Source][v-quick] | Native FFF fuzzy/typo matching; host-ranked paths. [Source][t-index-search] |
| Commands / lists | Command-specific substring/word matching, TF-IDF and MRU; generic Quick Picks have another configurable matcher. [Source][v-commands] | Palette token ranker with conditional typo pass; slash/model/skill lists also use a simpler subsequence helper. [Source][t-rank], [source][t-slash] |
| Symbols | Language-provider candidates, then symbol/container fuzzy scoring. [Source][v-symbols] | No corresponding general symbol-navigation feature established by this investigation. |
| Thread titles / messages | Outside this report's VS Code surface scope. | Titles: weighted word matching, limited typos and usage; messages: bounded SQLite trigram retrieval plus literal-token grading. [Source][t-thread-score], [source][t-message-query] |
| Editor / diff find | Editor-model literal/regex find, including unsaved text. [Source][v-find] | Patched diff renderer searches supplied line data with literal/regex matching. [Source][t-diff] |
| Project contents | Search providers; local disk path uses ripgrep, reconciled with open models. [Source][v-open-models], [source][v-rg] | Separate FFF content index and plain/regex grep over host files. [Source][t-index-content] |

Neither app implements all these surfaces with one engine.

## VS Code: call paths and behavior

### Quick Open files and paths

`AnythingQuickAccessProvider` prepares the query, returns editor-history picks quickly, and requests additional file/symbol picks asynchronously. Files go through `QueryBuilder.file → ISearchService.fileSearch`; the local file engine enumerates with ripgrep and filters paths through `isFilePatternMatch → fuzzyContains`. That final function explicitly walks query characters in order. Ripgrep supplies filenames here, rather than performing fuzzy content retrieval. [Quick Open orchestration][v-quick], [enumeration][v-file-enumeration], [file-engine filter][v-file-filter], [subsequence predicate][v-subsequence].

`scoreItemFuzzy` then distinguishes basename/label, directory description and full path. Full-path identity ranks highest; queries without separators favor label matches, especially label prefixes and shorter labels. Otherwise it scores the combined directory and label, splitting matching positions back into label/description highlights. Character scoring rewards consecutive runs, matching case and boundaries. Space-separated query pieces must all match; quoted pieces request contiguous matching. This is deterministic character scoring, not edit-distance correction. [Item scoring][v-score], [query preparation tests][v-query-tests].

History is a separate group, not merely another numeric boost. Empty input returns editor history; when searching it matches contiguously, normally on the label alone unless the query contains a separator. Filtering defaults to relevance ordering, with a recency option. Additional results are deduplicated against history and capped at **512**. [History and ranking][v-quick], [settings][v-history-settings].

There are both per-picker score caches and search-service candidate caches; narrowing a query can reuse candidates. The host-side sorted search uses the same comparator before limiting results. Cold searches may wait **200 ms** for typing; cancellation tokens flow through the search and asynchronous top-result calculation. This is an enumeration/cache pipeline, not evidence of a persistent global file-content index. [Quick Open file queries][v-file-query], [host cache and ranking][v-cache].

### Commands, generic pickers and symbols

The command palette's actual filter is `or(matchesBaseContiguousSubString, matchesWords)` over label and alias, plus exact command-ID matching. For queries of at least three characters, unmatched commands can enter via normalized **TF-IDF** scores above 0.5, capped at five suggestions. Ordinary matches precede these; MRU history, suggested commands and name ordering affect ordinary results. TF-IDF is lexical term weighting, not embeddings or typo correction. There is also a separately enabled AI-related-command provider; it is distinct from the base filter. [Command filtering/ranking][v-commands], [optional AI path][v-ai-commands].

Generic Quick Picks instead use `QuickInputList.filter`: icon-aware fuzzy label matching by default, optional contiguous labels, and independently enabled description/detail matching. `matchesFuzzy` combines simple wildcard-regex matching with prefix/camel-case/substring filters. A shared picker widget therefore does not guarantee identical matching or ranking across callers. [Picker filtering][v-picker], [filter implementation][v-filters].

Workspace symbol lookup asks registered providers for candidates, then applies `scoreFuzzy2`; document symbol navigation applies it to outline symbols. Both can split the first query piece into the symbol name and remaining pieces into its container, return highlights, and rank scores. Candidate discovery/indexing belongs to language providers, so their coverage cannot be inferred from the UI scorer. These call sites use ordinary `fuzzyScore`, not the separate `fuzzyScoreGraceful` permutation helper present elsewhere. [Workspace symbols][v-symbols], [document symbols][v-document-symbols], [scorer delegation][v-score2].

### Editor/diff find and project text search

`FindModel → TextModel.findMatches` searches the current in-memory model with literal/regex, case and word-boundary options. Single-line literal search uses the text buffer; regex/multiline search delegates to `TextModelSearch`. Results become editor decorations and navigable ranges; initial decoration collection is limited to **19,999** matches. Diff editors construct original and modified `CodeEditorWidget`s, whose ordinary Find controller searches its editor model; this traced path is not T3's combined multi-file diff search. [Find model][v-find], [model dispatch][v-model-dispatch], [match limit][v-find-limit], [text matcher][v-text-matcher], [diff editors][v-diff-editors], [Find action][v-find-action].

Project search calls `SearchService.textSearchSplitSyncAsync`: open models are searched immediately, and their results prevent disk-provider results overriding them. Thus unsaved edits participate. Local disk search reaches `RipgrepTextSearchEngine`, using **`@vscode/ripgrep-universal`**; fixed text uses `--fixed-strings`, regex uses the automatic regex engine, and case/whole-word/multiline options are translated separately. It streams source and preview ranges; cancellation or hitting the limit kills the process. The default search-result limit is **20,000**. [Model reconciliation][v-reconcile], [open-model matching][v-open-models], [binary dependency][v-rg-package], [ripgrep arguments][v-rg], [cancellation][v-rg-cancel], [default limit][v-search-default].

`QueryBuilder` composes include/exclude settings and local/global/parent ignore policy; these are query policy, not properties of fuzzy scoring. Remote/virtual schemes can register their own providers. A separate `aiTextSearch` route exists; ordinary project text search remains lexical. [Folder policy][v-query-policy], [provider/AI service][v-search-service].

## T3 Code: several engines behind related interfaces

### File mentions and file lookup

Composer `@` path handling calls `useComposerPathSearch → projectEnvironment.searchEntries`; `WorkspaceEntries.search` normalizes the cwd and query, then acquires a host `WorkspaceSearchIndex`. Query normalization lowercases and strips leading `@`, `.` and `/`. The host selects native `FileFinder.fileSearch`, `directorySearch` or `mixedSearch`, preserving its ranking. File lookup uses the same service with file-only results. [Composer caller][t-mentions], [host entry service][t-entries], [native dispatch][t-index-search].

This matters: the current file engine is **FFF**, not `searchRanking.ts`. FFF's `FilePicker.fuzzy_search` sets a typo allowance from query length, clamped to 2–6, and invokes `neo_frizbee` **0.13.3**. Ranking includes path match quality, basename bonuses and Git-related signals; slash-containing queries alter basename handling. This permits real typo matching. T3 lowercases its query before this engine, so FFF's uppercase-query bonuses cannot simply be assumed active. [FFF search][f-search], [matcher and score composition][f-score], [Rust dependency pin][f-lock].

FFF supports persisted access frecency/query history, but T3 supplies neither database path and does not call `trackQuery` in this service. Do not attribute FFF's optional learned selection history to this integration. [T3 initialization][t-index-create], [FFF initialization][f-init].

The host maps native results to paths/kinds, dropping native scores and match offsets. The file-picker client computes greedy subsequence highlights while retaining server order; a typo match can therefore appear without highlights. It does not reject that row. Composer path requests limit results to **80**, file lookup to **200**; client path requests debounce **120 ms**. The file-picker query wrapper omits the service's `truncated` flag. [Mapping][t-index-map], [picker highlights][t-file-highlight], [client constants][t-client-queries], [picker wrapper][t-file-query].

Indexes are keyed by cwd and path/content variant, with a **15-minute idle TTL**. Path-only consumers disable content indexing. Initial scan waits up to **15 seconds**; path search can continue with `truncated` while scanning, whereas content initialization fails on timeout. FFF enables a filesystem watcher by default and honors ignore rules; its walkers skip hidden entries for non-Git roots, while Git roots can include nonignored dotfiles. Search coverage is narrower than “every file visible somewhere in the UI.” [Initialization][t-index-create], [index lifetime][t-index-lifetime], [limits][t-index-limits], [FFF options][f-init], [walker policy][f-walk], [alternative walker][f-zlob].

### Lists, branches and worktree controls

`@t3tools/shared/searchRanking` provides exact/prefix/boundary/substring tiers and a greedy ordered-subsequence fallback with position/gap/length penalties. Slash commands, skills and model search configure different tiers; this helper itself corrects no typos. [Shared helper][t-simple], [slash caller][t-slash].

Branch selectors take another route: `usePaginatedBranches → vcs.listRefs → GitVcsDriverCore.listRefs`. The host filters branch names with case-insensitive `includes`, orders current/default branches first, and pages the filtered snapshot; the client asks for **100** refs per page. `WorktreeBaseBranchPicker` reuses this branch lookup. The workspace-mode control offers current/new/previous-worktree choices, rather than a fuzzy directory search. [Host branch filtering][t-ref-filter], [host ordering/paging][t-ref-list], [base picker][t-base-picker], [workspace choices][t-workspace-choices].

### Quick switcher, titles and messages

`CommandPalette.logic` uses shared `paletteSearch` for commands/projects/settings/thread titles. This is **word/token matching**, not arbitrary character subsequences: case/accent folding, word prefixes, joined words, selected mid-word title hits, and optional filler words. It weights title above branch/project/environment context and explains non-title matches. If no strong match exists across the searched groups, it reruns with constrained one-edit typo correction; short words have stricter rules, numeric references avoid typos. [Palette call path][t-palette], [token/typo implementation][t-token], [two-pass ranking][t-rank].

The client ranks thread shells immediately; when shells omit older settled threads, host search supplements matching rows using the same scorer. Thread ordering combines match-quality classes with user activity and decayed open frequency, capped so usage cannot promote weak classes above strong ones. Decay has a **14-day half-life**; query-specific selections also influence ordering. Highlights come from the scorer's source ranges. Palette limits are **20 title/thread rows**, **10 message rows**, and smaller secondary groups. [Older-thread lookup][t-older-search], [thread fields/ranking][t-thread-score], [usage history][t-use], [message ordering and limits][t-message-rank].

Message search is host-owned: connected environments are queried after a **120 ms** debounce. SQLite **FTS5 trigrams** retrieve case/accent-insensitive substring candidates; `messageMatcher` requires literal query tokens, grades whole-word/prefix/mid-word hits, and rewards phrases/proximity. It performs neither typo nor semantic matching. Three-character tokens normally activate search; two-character CJK tokens use a scan fallback. [Client/environment path][t-thread-ui], [token grading][t-message-match], [index migration][t-fts].

Coverage is intentionally bounded: newest **10,000 index candidates**, at most **2,000 SQL hits**, or newest **20,000 message row IDs** without an applicable index. The server chooses one best message per thread, preferring quality, user messages and time, then applies usage/pick ranking. Finished user/assistant messages are indexed through SQL triggers; streaming content, generated notices, attachment placeholders and subagent content are excluded, and archived/deleted threads are filtered. These are not exhaustive transcript results, and the returned match list does not expose a truncation flag for those internal cutoffs. [Query and limits][t-message-query], [best-hit selection][t-message-service], [index predicates/triggers][t-message-index], [result contract][t-thread-contract].

Selecting a message result opens its thread and seeds in-thread Find at the message. Pending results can retain a previous related query's rows; unrelated queries clear. Debouncing and stale-result presentation do not establish hard cancellation of native work. [Navigation][t-thread-ui], [pending-query policy][t-pending].

### Diff find and project contents

T3 patches **`@pierre/diffs` 1.6.1**: `CodeViewSearch.collectMatches` builds an escaped literal or JavaScript regex, applies case/whole-word options, and visits supplied diff lines in render order, including folded files and removed/added/context lines. It caps matches at **100,000**, highlights them and reveals the selected line. Partial diff hydration refreshes the search; this does not establish coverage of unloaded files. [Actual repository patch][t-diff], [upstream test inspected, not executed][t-diff-test].

Project content search is present. Its dialog queries the active target's cwd through `WorkspaceEntries.searchContents` and a separate content-enabled FFF instance. It uses **plain or regex** grep, with case/whole-word controls—not FFF's available fuzzy-grep mode. The client asks for **500 results**; host grep uses a **250 ms** budget and at most **100 matches per file**, paging internally while time remains and returning `truncated`/regex-error information. Results carry line/range highlights and open the file at its line. This is host filesystem/index search; no unsaved-editor overlay is passed into this path. [Dialog/navigation][t-content-ui], [client request][t-client-content], [host grep][t-index-content].

## Executed examples and interview implications

An isolated Bun bundle imported the pinned upstream utility files directly; external unused Effect imports were tree-shaken. No matching implementation was rewritten. Assertions and execution passed:

- VS Code `scoreFuzzy` and `scoreFuzzy2`: `wkb → workbench` matches (positions 0, 3, 4); `wrok → workbench` fails. Exact `workbench` scores higher.
- T3 `rankSearchItems/scoreThreadSearch`, over `GitHub integration` and `Search model`: `githbu` finds the first through the typo pass; `gh` finds neither. `model search` finds `Search model` regardless of token order.
- T3 `messageMatcher`: `github` and `model search` find `Search model with GitHub integration`; `githbu` does not. Its simpler `scoreSubsequenceMatch('github', 'gh')` succeeds while `githbu` fails. [Utilities exercised][v-score2], [title ranker][t-rank], [message matcher][t-message-match], [subsequence helper][t-simple].

**Proposals for discussion, not decisions:** specify item lookup separately from finding literal text; decide typo tolerance per surface using concrete acceptance pairs; choose path versus basename and history priorities explicitly; define whether content includes unsaved buffers, ignored files, streaming messages and unloaded history; require a clear completeness/freshness contract before choosing indexes or result limits. These findings support consistent expectations and feedback without requiring one matcher everywhere.

**Limits:** no full-app UI/accessibility, native binary equivalence, cancellation propagation, scale or latency qualification was performed. FFF behavior is traced to its published version's source and T3 patch, not executed end to end. Provider-specific VS Code symbol/remote-search behavior remains variable. No escode implementation, glossary changes or product decisions were made.


## Escode baseline and implications for the interview

Parent-agent inspection used escode commit `fc8643912b79fab9279256cde75e9af0843bf9a1`. These are current-code facts and proposals, not accepted search behavior.

- Files has case-insensitive basename **prefix type-ahead** over its currently visible rows, with a 700 ms sequence timeout and repeated-key cycling. This moves focus; it is neither a ranked fuzzy result list nor a recursive checkout search. [Files key handler](https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/files.tsx#L790-L803).
- Agents renders numbered chats, project labels and status, sorted by creation/order metadata. Its summaries do not contain a meaningful chat title or transcript text. Making chats findable by what they concern may therefore require a naming/summary decision as well as a matcher. [Agents rows](https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/agents.tsx#L18-L38), [summary contract](https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/packages/contracts/index.ts#L31-L48).
- Branch/base and discovered-worktree choices are native select controls today. Source Control maps changed paths into staged/unstaged/untracked lists. These are existing item-selection surfaces to consider, without assuming that every control needs replacing. [Worktree choices](https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/worktrees.tsx#L173-L218), [Source Control list](https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L737-L763).
- File/diff presentation already uses Monaco, backed by retained editor models. The inspected setup adds Save and does not replace Monaco's find implementation. This suggests checking/reusing Monaco's existing precise find before specifying a custom current-file matcher; its behavior was not manually verified in this research session. [Editor setup](https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L218-L288).
- Chat transcript presentation deliberately shows one provider history page and releases that cache on navigation. Host history reads at most 20 turns per page and rejects more than 128 KiB/1,000 display items. Searching all saved conversations cannot honestly be implemented by filtering the current DOM or currently loaded history. [History UI](https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/chat.tsx#L331-L349), [host page bounds](https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/host/chat-service.ts#L394-L416), [view release](https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/chat-state.ts#L87-L108).

Interview proposals: first settle the included surfaces and whether content search is part of this effort; separately settle whether item lookup means abbreviations, typo forgiveness, or both. After those answers, decide contextual versus app-wide entry points, checkout/project/history boundaries, ranking and navigation, then incomplete/unavailable states and concrete acceptance examples. Do not ask the user to select an algorithm or dependency before those behaviors are agreed.

## Pinned source references

[t-package]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/package.json#L36-L45
[t-lock]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/pnpm-lock.yaml#L275-L280
[f-package]: https://github.com/dmtrKovalenko/fff/blob/95fd777c2529fc7b4d7572dabff64cc07268f2c5/packages/fff-node/package.json#L1-L30
[v-quick]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts#L488-L680
[v-file-filter]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/search/node/fileSearch.ts#L630-L646
[v-subsequence]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/base/common/strings.ts#L920-L949
[v-score]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/base/common/fuzzyScorer.ts#L412-L577
[v-query-tests]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/base/test/common/fuzzyScorer.test.ts#L1236-L1286
[v-history-settings]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/contrib/search/browser/search.contribution.ts#L122-L139
[v-file-query]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts#L687-L867
[v-cache]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/search/node/rawSearchService.ts#L169-L337
[v-commands]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/platform/quickinput/browser/commandsQuickAccess.ts#L53-L245
[v-ai-commands]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts#L144-L218
[v-picker]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/platform/quickinput/browser/quickInputList.ts#L1468-L1525
[v-filters]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/base/common/filters.ts#L452-L487
[v-symbols]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/contrib/search/browser/symbolsQuickAccess.ts#L103-L207
[v-document-symbols]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/editor/contrib/quickAccess/browser/gotoSymbolQuickAccess.ts#L270-L365
[v-score2]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/base/common/fuzzyScorer.ts#L284-L331
[v-find]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/editor/contrib/find/browser/findModel.ts#L507-L512
[v-text-matcher]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/editor/common/model/textModelSearch.ts#L16-L66
[v-diff-editors]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/editor/browser/widget/diffEditor/components/diffEditorEditors.ts#L103-L140
[v-find-action]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/editor/contrib/find/browser/findController.ts#L566-L602
[v-open-models]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/search/common/searchService.ts#L511-L582
[v-rg]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/search/node/ripgrepTextSearchEngine.ts#L505-L605
[v-rg-cancel]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/search/node/ripgrepTextSearchEngine.ts#L139-L180
[v-search-default]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/search/common/search.ts#L32-L32
[v-query-policy]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/search/common/queryBuilder.ts#L582-L610
[v-search-service]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/search/common/searchService.ts#L54-L167
[t-mentions]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/components/chat/useComposerMenuItems.ts#L104-L121
[t-entries]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/workspace/WorkspaceEntries.ts#L253-L285
[t-index-search]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/workspace/WorkspaceSearchIndex.ts#L453-L477
[t-index-create]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/workspace/WorkspaceSearchIndex.ts#L290-L374
[t-index-map]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/workspace/WorkspaceSearchIndex.ts#L162-L215
[t-index-content]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/workspace/WorkspaceSearchIndex.ts#L479-L526
[t-file-highlight]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/components/files/ProjectFilePicker.logic.ts#L1-L64
[t-client-queries]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/state/queries.ts#L41-L47
[t-client-content]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/state/queries.ts#L353-L403
[t-simple]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/packages/shared/src/searchRanking.ts#L21-L142
[t-slash]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/components/chat/composerSlashCommandSearch.ts#L26-L77
[t-ref-filter]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/vcs/GitVcsDriverCore.ts#L240-L267
[t-ref-list]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/vcs/GitVcsDriverCore.ts#L3976-L4048
[t-base-picker]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/components/WorktreeBaseBranchPicker.tsx#L32-L88
[t-workspace-choices]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/components/BranchToolbarEnvModeSelector.tsx#L41-L65
[t-palette]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/components/CommandPalette.logic.ts#L509-L633
[t-token]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/packages/shared/src/paletteSearch.ts#L151-L273
[t-thread-score]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/packages/shared/src/paletteSearch.ts#L942-L1006
[t-use]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/packages/shared/src/paletteSearch.ts#L715-L800
[t-rank]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/packages/shared/src/paletteSearch.ts#L1089-L1150
[t-message-rank]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/packages/shared/src/paletteSearch.ts#L1022-L1073
[t-message-match]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/packages/shared/src/paletteSearch.ts#L429-L626
[t-thread-ui]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/components/CommandPaletteThreadItems.tsx#L69-L235
[t-fts]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/persistence/Migrations/069_ThreadMessageSearch.ts#L12-L51
[t-message-index]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/orchestration-v2/messageSearchIndex.ts#L23-L117
[t-message-query]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/orchestration-v2/ThreadSearch.ts#L96-L231
[t-message-service]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/orchestration-v2/ThreadSearch.ts#L408-L506
[t-pending]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/packages/client-runtime/src/state/threadSearch.ts#L286-L307
[t-diff]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/patches/@pierre%252Fdiffs@1.6.1.patch#L331-L615
[t-diff-test]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/components/diffs/codeViewSearch.test.ts#L1-L66
[t-content-ui]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/components/search/ProjectContentSearchDialog.tsx#L109-L251
[f-search]: https://github.com/dmtrKovalenko/fff/blob/95fd777c2529fc7b4d7572dabff64cc07268f2c5/crates/fff-core/src/file_picker.rs#L1105-L1155
[f-score]: https://github.com/dmtrKovalenko/fff/blob/95fd777c2529fc7b4d7572dabff64cc07268f2c5/crates/fff-core/src/score.rs#L630-L864
[f-lock]: https://github.com/dmtrKovalenko/fff/blob/95fd777c2529fc7b4d7572dabff64cc07268f2c5/Cargo.lock#L1510-L1516
[f-init]: https://github.com/dmtrKovalenko/fff/blob/95fd777c2529fc7b4d7572dabff64cc07268f2c5/packages/fff-node/src/finder.ts#L120-L146
[f-walk]: https://github.com/dmtrKovalenko/fff/blob/95fd777c2529fc7b4d7572dabff64cc07268f2c5/crates/fff-core/src/walk/ripgrep.rs#L20-L32
[f-zlob]: https://github.com/dmtrKovalenko/fff/blob/95fd777c2529fc7b4d7572dabff64cc07268f2c5/crates/fff-core/src/walk/zlob.rs#L19-L46
[v-file-enumeration]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/search/node/fileSearch.ts#L216-L249
[v-find-limit]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/editor/contrib/find/browser/findModel.ts#L81-L81
[v-rg-package]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/base/node/ripgrep.ts#L6-L15
[v-reconcile]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/search/common/searchService.ts#L124-L150
[t-file-query]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/web/src/components/files/projectFilesQueryState.ts#L222-L251
[t-index-lifetime]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/workspace/WorkspaceSearchIndex.ts#L531-L560
[t-index-limits]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/workspace/WorkspaceSearchIndex.ts#L34-L40
[t-older-search]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/apps/server/src/orchestration-v2/ThreadSearch.ts#L574-L623
[t-thread-contract]: https://github.com/pingdotgg/t3code/blob/96c21aaca1d78e1bfc7bae3c68b635ba22ef13f3/packages/contracts/src/threadSearch.ts#L29-L52
[v-model-dispatch]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/editor/common/model/textModel.ts#L1209-L1225
