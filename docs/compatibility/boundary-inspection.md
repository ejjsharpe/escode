# Read-only boundary inspection (#130)

Implemented only #130 of standalone spec #117 on branch `t3/historical-boundary-browsing` (initially `t3/9aa4b6a5`),
isolated worktree `/Users/elliotsharpe/.t3/worktrees/escode/t3-9aa4b6a5`,
based on integration `1d67952`, preserving ancestor `0a9c981`.
The integration tip was merged before handoff (already up to date).
No issue closure, PR, or merge into integration is included.

The existing authenticated host/client connection exposes validated checkpoint
metadata pages (20 points), and read-only provider history inspection through a
selected stable boundary. Metadata includes exact provider thread/turn references,
before-message/after-turn identity and independent saved-file coverage/reason.
Before points use the corresponding completion's turn reference when present;
missing references remain explicitly unavailable. File bytes never enter discovery.
SQLite projects metadata directly, without loading checkpoint file bodies.

Inspection opens a separate read connection and calls only thread/turns/list;
it never resumes the current provider session, starts a turn, sends a prompt,
responds to a request, writes files or changes continuation context. It reuses the
existing history normalization and limits (20 turns, 1,000 items, 128 KiB body per
page), with a 50-page/1,000-turn search bound and repeated-cursor rejection.
It returns one page ending at the selected boundary, excluding the selected turn
for before-message points. Missing, unsupported, malformed, oversized or beyond-limit
provider history is disclosed rather than replaced with current context or files.
Provider-owned history may already be incomplete; available never promises a
complete independent transcript. Ordinary No project history remains Git-free.

The shared conversation surface has a native Historical boundaries disclosure,
paged point buttons, a separate read-only inspection region, loading/empty/error
states, provider references and saved-file reasons. It retains ordinary history,
live requests and composer state. Keyboard activation selects a point and moves
focus to the result; Escape collapses inspection and returns focus to the summary.
No rewind, restoration, branching or retention control is added.

## Verification (2026-10-31)

- Requested TDD, Ponytail and Impeccable workflows were read. Existing accepted
  authenticated and packaged seams were reused. Dependencies were initially
  absent; frozen installation left the lockfile unchanged. The first new
  authenticated assertion failed at the unregistered request route; the route
  allowlist and implementation then made the affected checks pass.
- Real temporary Git/SQLite over the authenticated client verifies before/after
  inspection, historical body, empty before boundary, unchanged real index bytes,
  unchanged provider turn count, metadata without files and invalid cursors/IDs.
  Existing capture assertions retain saved-file, status, index and restart checks.
- Authenticated No project SQLite fixture verifies 20+3 metadata paging without
  provider calls, Git-free inspection, lost history and unsupported provider method,
  unchanged provider identity and exclusively read-only provider method counts.
- Focused host checkpoint/history tests: 9 passed. Additional No project boundary
  test: passed. Typecheck, lint, build and unsigned arm64 package passed; existing
  lint/build warnings remain.
- Packaged history navigation and streaming: 2 passed. Navigation covers keyboard
  selection, before/after boundaries, separate unavailable file coverage, missing
  provider history, result focus, Escape focus return and retained unsent text.
  Screenshots of available/unavailable inspection were captured and visually read;
  the existing scrollable transcript and current composer remain in place.

Failed-run history: the new No project fixture first lacked scratch ownership,
then used macOS's /var alias rather than canonical /private/var; canonical scratch
preparation fixed it. The original provider fixture omitted completion status and
used a history turn ID differing from its sent ID; these were corrected. Inspection
also exposed a fixture callback shared across connections; callback ownership now
follows only the execution connection, preserving live completion delivery.

Manual VoiceOver/native accessibility validation and paid live-provider compatibility
were not performed. Keyboard/focus automation does not establish those gates.
No physical power-loss, new crash-during-inspection or production capacity claim is
made. Existing SQLite NORMAL durability and external-writer limits remain.

Final verification: full host suite 331 passed, six skipped across 42 files in
66.57 seconds. The first full run had one completion-availability poll timeout
while packaging/UI checks ran concurrently (330 passed, six skipped). Checkpoint
completion/busy polls now allow ten seconds; the full rerun passed. Final focused
checkpoint/history/No project run passed 10/10; final packaged navigation/streaming
passed 2/2 in 13.0 seconds, including composer preservation and Escape focus.
Final typecheck and lint passed (three existing warnings); whitespace checks passed.
No known functional #130 acceptance gap remains at these confirmed seams. Manual
accessibility and actual paid-provider qualification remain explicit unmet gates.
