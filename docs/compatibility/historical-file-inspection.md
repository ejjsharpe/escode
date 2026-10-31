# Historical file inspection (#131)

Implemented only #131 of standalone #117 on `t3/inspect-file-changes`, in
`/Users/elliotsharpe/.t3/worktrees/escode/t3-0b3fb15e`, based on integration
`5af29d3`, preserving `0a9c981`. No issue closure, PR or merge into integration.

The existing authenticated host/client route discovers captured paths in pages of
20 and compares one selected saved boundary file with its recorded Git base.
Discovery includes unchanged files and says so. It uses the same stable boundary
identity and independently reports file coverage. It reads one chat-scoped
checkpoint from real SQLite and Git objects without consulting today's file
contents. Exact checkout identity is checked before Git reads. No provider call,
file write, index update, continuation or recovery-draft update is involved.
Recorded individual provider file-change details remain inspectable in the
existing bounded boundary history as fileChange items, without becoming points.
No rewind/restoration/branch/retention UI is added; #132 remains separate.

Selection displays read-only base and captured text with mode/absence labels.
Missing boundaries are rejected; missing snapshots, expired coverage, missing
bases and uncaptured paths are unavailable without current-file substitution.
No project coverage is unavailable without introducing Git. Exclusions are shown:
unsaved editor text, ignored untracked files, empty directories, nested repository
contents and environment. Text comparison is limited to 128 KiB per side;
binary/non-UTF-8 and larger contents are explicitly unavailable. Capture's existing
10,000-file/8 MiB limits still apply; Git output and subprocess time are bounded.
Keyboard activation focuses discovery or the selected comparison; Escape returns
to Historical boundaries. The composer remains available and retains its text.

## Verification (2026-10-31)

TDD used the accepted authenticated host/client and packaged seams. The first new
assertion failed with `client.inspectFiles is not a function`; implementation
then passed the focused tests. Frozen dependency installation changed no lockfile.
Real temporary SQLite/Git fixtures exercise captured before/after saved contents,
eligible untracked files, excluded paths, absent historical files, missing bases,
expired snapshots, invalid paths/cursors/boundaries, unchanged source/index and
live snapshot, unchanged provider turn count and zero provider calls during file
inspection. A recorded individual fileChange detail is visible through history.
No project inspection is Git-free and makes no provider calls.

Packaged history navigation/streaming/file comparison: 3 passed (final 22.2s).
The real Git comparison fixture changes today's disk after capture and verifies
both historical bodies, absence of today's replacement, keyboard file selection,
comparison focus, Escape focus return and retained unsent composer text. The
No project fixture verifies visible unavailable coverage and focus. Screenshots
were captured and visually read. Typecheck, lint, build and unsigned arm64 package
passed. An overlapping earlier package attempt failed when a concurrent rebuild
removed an asset; the subsequent package succeeded.

The broad parallel suite recorded 327 passed, 4 failed, 6 skipped: Send timeout,
crash-fixture socket open error, lookup watcher timeout and worktree timeout while
other build/package checks were active. These failures are retained here rather
than represented as a clean full-suite pass. Sequential affected-suite follow-up
is recorded below.

Manual VoiceOver/native accessibility and paid live-provider compatibility were
not performed. No power-loss, new crash-during-inspection, production capacity or
complete independent provider-history guarantee is claimed. Existing SQLite
NORMAL durability and external-writer race limits remain. No product terminology
changed, so GLOSSARY.md requires no new definition.

Sequential follow-up: `bun run --cwd apps/desktop test --
host/durable-send.test.ts host/boundaries.test.ts host/lookup.test.ts
host/worktrees.test.ts --maxWorkers=1` passed 29/29 across four files in 44.29s,
including every previously failing suite. Final lint passed. Final packaged checks
passed 3/3 after the comparison-focus adjustment; the refreshed screenshot was
visually inspected. No known functional acceptance gap remains at these seams.
