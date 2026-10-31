# Explicit summarized continuation (#136)

Implemented from isolated `b269f70` on `t3/spec117-durable-state-1`, worktree
`/Users/elliotsharpe/.t3/worktrees/escode/t3-7f7debf4`, preserving ancestor
`0a9c981`. Standalone #117 authorizes implementation and its authenticated
host/client and packaged UI test seams without a decision map.

Historical boundaries offers a separate deliberate summarized choice. Confirmation
explains reduced fidelity: available historical text with item labels is copied
into an unsent draft for review, not native historical provider context or restored
tool state. This deliberately uses no model-generated summary and consumes no turn.
The distinct child draft has no provider thread; first explicit Send creates one.
Native branch and rewind continue to report unsupported/lost history independently.

The existing authenticated branch route validates the explicit mode. It captures
summary contents as well as boundary, source identity, provider turn IDs and file
coverage; confirmation rejects changed historical text. Empty, malformed, missing,
unsupported and oversized history is unavailable rather than invented or truncated.
The summary draft is bounded to 64 KiB; existing 1,000-turn discovery, bounded page
and snapshot limits apply. Full transcripts remain provider-owned.

Existing Git eligibility, exact recorded base, captured uncommitted file application,
SQLite receipts, checkpoint dependency copies, managed reservations and incomplete
preparation gates are reused. Duplicate commands return their retained outcome;
changed mode/target is a conflict. Partial preparation remains against its original
child and reservation, with no replacement allocation, automatic retry or turn.
Source files/index/chat identity and client recovery drafts remain intact.
No #133 editor-restoration or #137 retention policy is changed.

## Verification

TDD first failed because the fallback produced an empty native branch. The explicit
summarized test then passed. Full authenticated boundary suite: **20/20 passed**
(140.09s), using real temporary SQLite/Git, native and completion branching,
reservation/persistence failures, process-kill recovery and zero automatic turns.
The five summarized cases also passed separately (50.47s); final source rerun
results follow below. Fixtures reject native forks for the summarized mode, retain
correct completion text/files, check changed summary selection and preserve client
recovery. Missing/unsupported history and missing file/base coverage are rejected.

Typecheck, lint, build and unsigned arm64 package passed. Development Electron
summary choice, fidelity copy, Cancel focus return, Enter activation, result focus
and preserved source composer passed (21.8s). The first packaged run timed out at
45s, including teardown, without an assertion location. Its retry is recorded below.

`git merge integration/spec-117-durable-state` reported already up to date at
`b269f70`. Integration itself is unchanged. No issue closure, PR or integration
merge was performed.

Live paid-provider continuation, manual VoiceOver/native accessibility, physical
power-loss survival and production capacity were not qualified. Copying text does
not certify provider-context fidelity. External writer races and SQLite NORMAL's
recent-commit power-loss limitation remain.

Packaged retry passed **1/1 (15.9s)** with a 90s runner timeout; no product/test
assertions were relaxed. Screenshot visually inspected. Final summarized suite
passed **5/5 (22.37s)** including changed-content rejection and explicit
missing/unsupported summary input. Final typecheck found an accidentally duplicated
test block in the unrelated rewind fixture; removed it and reran the final gates.

Final pre-merge boundary rerun passed **20/20 (114.38s)**; typecheck and lint
passed after removing the duplicated test block. Integration then advanced to
`d5032a7` (#133 packaged dirty editor). Merged it into this branch at `c6b5ad1`,
resolving the shared fixture conflict by retaining both summary and dirty-editor
scenarios. `0a9c981` remains an ancestor. Combined-tip typecheck, lint, build and
unsigned package passed; combined-tip summarized host cases passed **5/5 (46.91s)**.
Combined-tip packaged summary and dirty-editor restoration passed **2/2 (40.5s)**,
including explicit choice/cancel/keyboard focus, preserved composer and the retained
#133 editor scenario. No known unmet automated #136 criterion remains at these
seams; the human/live qualification limits above remain unqualified.
