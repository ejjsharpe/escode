# SQLite draft foundation (#118)

Implemented the draft/association storage slice of #117. The host opens a fresh `durable-chats-v1.sqlite-state-v1/state.sqlite` through a dedicated Node worker before publishing its window. Host/client identities, current chat records (including project association, exact checkout, provider reference, preparation reservations and any saved directory identity), and the association revision reside in this database. Each replacement of related records and revision uses one SQLite transaction with optimistic revision validation. Complete transcripts remain provider-owned; unsent composer text remains separately client-owned through the existing recovery path.

The existing authenticated draft actions, project authorization and checkout validation remain the application entry points. Renderers do not open SQLite. Existing command receipt semantics remain in the host's JSON receipt store under the fresh namespace, seeded with and checked against the SQLite identities; command migration belongs to later tickets. This is neither dual writing nor legacy import. Previous foundation/chat stores, project files, worktrees and provider history are left intact. Existing JSON test fixtures were changed to seed/read SQLite explicitly; this fixture setup is not an application import path.

SQLite uses WAL, synchronous NORMAL and checkpoint_fullfsync ON. Startup reads back and verifies `wal`, `1`, `1`; the packaged runtime exercised these settings on macOS arm64, Electron 45.1.0. Database reads/writes and checks run off the UI thread. The queue admits at most 64 requests and current chat data is limited to 1 MiB; exhaustion rejects rather than prunes records. Work is serialized by the existing chat queue and SQLite transactions; a stale writer is rejected. A failed chat write blocks that store instance until explicit recovery/reopen.

A sibling establishment marker prevents missing established directories or databases from creating replacement identities. Unsupported schema versions, corrupt databases, missing identities, malformed chat records, linked storage and incomplete initialization are refused. Originals are not deleted to recover. There is no upgrade/import or backup product in this ticket.

## Executed evidence (2026-10-31)

- `bun run --cwd apps/desktop typecheck` and `lint`: pass.
- Full existing test suite: 32 files passed, one file skipped; 301 tests passed, four skipped. The subsequently added abrupt-process-death test and strengthened transaction fault case pass in the focused nine-test SQLite suite.
- Focused draft/chat/preparation suite: 64 passed, three live-provider tests skipped (before adding the process-death case).
- SQLite tests cover authenticated create/context edit/reopen, stale context rejection, unchanged previous-store bytes, related-record/revision rollback after an injected SQLite trigger failure, effective durability settings, corrupt/unsupported/malformed/missing established storage and identity refusal. A real Node subprocess acknowledges a saved draft, is killed with SIGKILL, and reopens with the same identities and contents.
- `build` and `package`: pass. The worker is copied beside the bundled host and included in the packaged ASAR. No native SQLite dependency was added; the worker uses Node's built-in `node:sqlite`.
- Packaged `tests/packaged.spec.ts`: pass with restricted PATH, renderer isolation, Monaco and tools.
- `tests/durable-state.spec.ts`, `tests/foundation-state.spec.ts`, `tests/project-drafts.spec.ts`: all pass. These exercise packaged authenticated draft creation, retained client composer text and restart identity, desktop startup identity and project draft behavior. The first draft restart test timed out because it requested Quit before renderer readiness; it now waits for the visible Open project control before driving lifecycle.

## Limits

No human VoiceOver/native checks were run; this slice adds no UI controls. No physical power-loss survival, production capacity, latency improvement, full-disk hardware simulation or provider compatibility is claimed. NORMAL can lose recent metadata on OS crash/power loss. SIGKILL tests establish application-process recovery only. A database is not a complete backup of provider history or external files. Recovery-copy tooling and effectful command consolidation remain later #117 work, outside #118.

Broad Electron regressions were updated for the persistence boundary but were not all rerun. Focused packaged and draft checks above are the executed UI evidence. The local integration branch remained at accepted baseline `0a9c981`; merging that tip reported already up to date. No matching remote integration ref existed when fetched.
