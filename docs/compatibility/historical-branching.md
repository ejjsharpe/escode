# Historical branching (#134)

Implemented on `t3/historical-chat-rewind`, worktree
`/Users/elliotsharpe/.t3/worktrees/escode/t3-b2f56e7e`, from integration
`9adf03f`, retaining `0a9c981`. Standalone #117 supplies authorization and the
accepted authenticated host/client and packaged test seams. No issue closure,
PR, or merge into integration was performed.

Historical boundaries offers a distinct branch confirmation. Only project-backed
before-message checkpoints with available files, exact directory identity,
recorded Git base and native provider predecessor context qualify. Unsupported,
missing, changed and before-first-turn context is unavailable. Native thread/fork
uses inclusive lastTurnId for the predecessor and the new worktree cwd. There is
no summary substitution or automatic turn. Existing-chat rewind remains separate.

The existing managed allocator accepts the verified immutable recorded commit,
reserves before Git creation, retains ownership and directory identity, and creates
an ordinary branch directly at that commit. Captured files are applied uncommitted;
base paths absent from captured coverage are deleted, staging stays at the base,
and synthetic commits are never introduced. Application checks reject linked
parents and invalid snapshot paths/modes; saved symlinks are created without
following them. Existing external-writer races remain.

SQLite rewind receipts retain the branch mode, exact selection, child identity,
provider identity when returned and persistable, and an independent copy of the
required checkpoint. Those records are protected evidence with no automatic
pruning in this slice, so source checkpoint deletion cannot remove branch-required
contents. Receipt capacity remains 1,000; snapshot capture remains 10,000 files /
8 MiB. Incomplete child chats persist a preparation gate that blocks connection and
Send across restart. Lost effects/results return uncertainty and never automatically
retry preparation, replace resources, fork again or submit a prompt. External
inspection/reconciliation is required for such retained partial resources.

## Verification (2026-10-31)

TDD: the first route check initially could not run because this fresh checkout lacked
dependencies. Frozen install resolved that; subsequent real Git and failure cases
were implemented iteratively. Authenticated tests use real temporary SQLite/Git,
selected native-context IDs, distinct managed cwd, recorded HEAD, uncommitted
captured bytes, clean target index, unchanged source/index and retained client
recovery text/baseline. They cover No project/after-turn refusal, missing history,
provider-response loss, pre-effect storage failure, post-allocation and post-provider
write failures, duplicate command recovery and blocked incomplete Send. A bundled
subprocess is SIGKILLed during the native fork after allocation; reopening through
the authenticated route returns uncertainty with the same single child/reservation
and no provider connection or turn replay.

Packaged branch confirmation/result focus and retained composer passed, alongside
file inspection. The first combined run had fixture failures (a second Send before
completion and a repeated predecessor ID across pages); the fixtures were corrected
without relaxing product assertions. The branch screenshot was visually inspected.
Impeccable's mechanical detector reported no findings. Final verification results
are appended below.

Paid live-provider context fidelity and manual VoiceOver/native accessibility were
not executed. Fixtures establish request selection, not paid-provider fidelity.
SQLite NORMAL does not guarantee physical power-loss survival. Full production
capacity and exhaustive multi-client qualification are outside this slice.

Final host regression command: `bun run --cwd apps/desktop test --
host/boundaries.test.ts host/worktree-drafts.test.ts host/worktrees.test.ts
host/durable-send.test.ts --maxWorkers=1`: **42 passed, 1 skipped**, four files
(99.48s). The final expanded boundary suite independently passed **8/8** (17.80s),
including missing base/files, preserved authenticated client recovery, staged
historical deletion with a tab in its name, and captured untracked contents.
Typecheck, lint, build and unsigned arm64 package passed on the final source.
Integration was merged into this branch via `git merge
integration/spec-117-durable-state`: already up to date at `9adf03f`; `0a9c981`
remains an ancestor. The integration branch was not changed.
Final rebuilt/repackaged history suite: **4/4 passed (28.2s)**, covering navigation,
streaming, file inspection and historical branching. No known unmet automated #134
criterion remains at these seams; the live/human qualification limits above remain.

## Completion-boundary branching (#135)

The existing authenticated branch flow now accepts available after-turn checkpoints
as well as before-message checkpoints. Native fork's inclusive lastTurnId selects
the completed response itself. Exact checkpoint files, recorded base and directory
identity use the same validation and preparation path; there is no new transport,
allocator, automatic turn, snapshot substitution or cleanup policy.

Implemented from isolated integration `982d3c8`, preserving `0a9c981`, on
`t3/spec117-chat-completion` in `/Users/elliotsharpe/.t3/worktrees/escode/t3-502b34cc`.
TDD first reproduced rejection of a valid completion. Test setup initially lacked
dependencies; frozen install resolved it. An old expected-base assertion in the
expanded fixture was corrected. Real Git completion capture uses different before,
completion, next-before and current contents and advances HEAD after capture, so
selection must retain the historical base. Authenticated tests exercise unavailable
and interrupted coverage, unsupported/lost history, retained client drafts/index,
distinct chat/worktree, no automatic turn, duplicate results and reservation failures
at admission, allocation, provider response and outcome persistence, with restart.

Verification results follow below. Paid live-provider context fidelity, manual
VoiceOver and physical power-loss survival remain unqualified. #137 retention and
#133 restoration are separate work; this slice changes neither policy.

Final #135 verification (2026-10-31): typecheck, lint, build and unsigned arm64
package passed after merging integration `e3e015d` into this branch (`205801b`).
The merge conflict in the shared packaged fixture was resolved by retaining both
completion branching and restoration scenarios. Integration itself was not changed;
`0a9c981` remains an ancestor. The pre-merge-started focused host regression run
finished 42 passed / 1 live skip across boundaries, worktree drafts and worktrees;
a separate combined-tip boundary run passed all 15 tests (97.67s under concurrent
load). Combined-tip packaged before/completion branches both passed, including
confirmation/result focus and retained composer. The extra packaged restoration
regression initially timed out waiting for confirmation focus under concurrent
host load; its isolated rerun passed (1/1, 10.4s). The preceding pre-merge packaged
branch run also passed 2/2 (24.1s). Completion-branch screenshot was visually
inspected. No production UI component, contract or dependency changed in #135.
No known unmet automated #135 criterion remains at these confirmed seams; native
provider fidelity and manual accessibility retain the qualification limits above.
