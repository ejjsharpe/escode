# Conversation-only rewind (#132)

Implemented on `t3/conversation-only-rewind` in
`/Users/elliotsharpe/.t3/worktrees/escode/t3-01feeeef`, starting from
integration `5af29d3`, retaining `0a9c981`. Standalone #117 authorizes this
slice without a decision map. No issue closure, PR or merge into integration.

The authenticated existing host connection offers explicit conversation-only
rewind from Historical boundaries. Preparation captures the exact checkpoint,
provider history IDs and directory identity into a bounded host-owned choice.
Confirmation rechecks authority, idle work, directory and provider history;
changed or missing history is unavailable. It preserves the escode chat identity,
files, index and client edits/composer. Confirmation explains that later restore
points may be abandoned; it never starts a turn or substitutes summarized context.

Installed Codex 0.166.0's generated request schema exposes native `thread/fork`
with inclusive `lastTurnId`; it exposes no `thread/rollback`. Rewind therefore
binds the existing escode chat to a distinct native historical provider thread.
After boundaries select that exact turn; before boundaries select its predecessor.
A before-first-turn boundary, unsupported native request or missing history is
unavailable. Discovery is bounded to 1,000 turns, rejecting repeated cursors/IDs.
No project works without Git or file coverage. File restoration and the separate
historical chat/worktree branching workflow are outside this slice.

SQLite retains command identity and uncertain intent before the provider effect,
the returned provider identity before binding where persistence succeeds, then the
applied outcome. Duplicate commands return their receipt; changed identities fail.
Choices disappear on host restart, so recovery cannot admit old choices or replay
a fork. A failed response/binding/result write leaves uncertainty, possibly an
orphan provider thread, and never automatically allocates a replacement or continues.
The bounded receipt store fails closed at 1,000 entries; no automatic evidence
pruning is introduced. SQLite NORMAL and external-writer limits remain.

## Verification (2026-10-31)

TDD used the accepted authenticated host/client and packaged UI seams. The first
new assertion failed at the missing client route, then passed after implementation.
Real temporary SQLite, scratch directories and Git verify selected provider IDs,
unchanged saved text/index bytes and authenticated client recovery text/baseline, stale/lost targets, unsupported methods, failed
intent storage, failed outcome persistence, repeated/changed commands and zero
turn starts. Reopening the database with a new service returns retained uncertainty
without calling the provider. Existing authenticated checkpoint/Send/history tests
pass (10 tests across three files); the final rewind fixture also passes separately.

Typecheck, lint, build and unsigned arm64 packaging passed. Packaged history
navigation and streaming passed (2 tests), including explicit choice, scope copy,
Cancel focus return, result focus, retained composer and unavailable history.
The rewind screenshot was visually inspected; Impeccable's detector returned no
findings. Existing UI styling is preserved; PRODUCT.md/DESIGN.md are absent.

Paid live provider continuation, manual VoiceOver/native checks, a new process
kill during the provider effect, and exhaustive capacity/multi-client checks were
not run. Database reopen and injected persistence failure do not establish hard
crash or physical power-loss survival. Provider-side historical-context fidelity is
fixture-tested, not certified against a paid live conversation. Client recovery text/baselines were checked through the authenticated boundary; no new packaged dirty-file scenario was executed in this slice.

Integration advanced during final qualification to `5700f08` (#131). Merged that
tip into this implementation branch, preserving both the read-only file inspection
and rewind routes/UI. Resolved overlapping additive contracts, fixture wiring,
README and boundary controls; post-merge typecheck and all 10 focused host tests
passed. The integration branch itself was not modified by this task.

Post-merge packaged navigation/rewind and streaming passed. The added #131 file
inspection scenario failed twice at result focus. Shared boundary-result focus
now follows React's committed layout rather than a scheduled animation frame,
including rewind confirmation/results and file/history inspection. Lost provider
response injection additionally retains uncertainty without a second fork.

Final merged verification: typecheck, lint, build and unsigned arm64 package passed;
all three packaged history scenarios (navigation/rewind, streaming, files) passed
in 23.3 seconds after the focus fix. The final authenticated rewind fixture passed
with lost-response and failed-outcome assertions. No known functional acceptance
gap remains at the confirmed automated seams; the live/human/process-kill limits
above remain unqualified.
