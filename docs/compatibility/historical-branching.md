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
