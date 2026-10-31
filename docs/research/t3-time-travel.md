# T3 Code: inspection, rewind and conversation forks

Researched 2026-10-31 against current GitHub HEAD **`1a93920deafd253edbbadacd6b0be150a689a2cd`**, fetched into an isolated detached checkout. This replaces the older `e5909e5` reference for these capabilities. escode context: main `c1dc27f`, README, GLOSSARY, the two existing ADRs, tracker rules and durable-state research section 3.1; the parent investigator found no open `wayfinder:map`. This report records observed upstream behavior, not an accepted escode specification.

## What the user can do

| Capability | Observed current behavior |
| --- | --- |
| Inspect earlier work | Select turn diffs and inspect recorded file-change tool diffs. This is a historical comparison surface, not a complete application-state browser. |
| Rewind a conversation | **Edit from here** on an eligible user message rewinds to before that message, returning its prompt and attachments to the composer. |
| Choose file scope | Confirmation offers **Revert and keep changes** or **Revert files too**; the latter explicitly warns that it also undoes the user's own edits. |
| Fork conversation | **Fork from this response** creates another thread through the selected run. It retains the source thread and conversation lineage. |
| Fork historical filesystem | The inspected fork path does not create an isolated historical checkout: it copies the source's current worktree/branch metadata. |

Sources: [diff selection][diff], [rewind dialog][ui], [target derivation][targets], [assistant fork action][assistant], [fork planning][fork], [client fork command][commands].

## Boundaries and history

The visible rewind targets are run boundaries: eligible `turn_start` or `queued_turn` user messages map to the preceding ready run checkpoint or the thread-start checkpoint. Inherited history and steering messages do not become independent targets. Rewind is capability gated and blocked while the thread is running or Send is busy; disconnected provider state requires reconnection. Returning a prompt preserves existing composer text by appending the restored prompt. [Target mapping][targets], [rewind controller][rewind], [composer recovery][composer]

Baseline capture runs before provider execution, then capture records the root run ordinal after provider completion or stopped work. Side chats sharing a parent's worktree skip baseline capture and deliberately record missing checkpoints. Unsupported Git workspaces can lack checkpoints, and capture failures can produce error checkpoints; provider work can start despite failed baseline capture. These are explicit checkpoints around runs, not snapshots before every tool action. [Baseline][baseline], [capture execution][capture], [checkpoint status handling][checkpoint]

The service targets either thread start or a provider-turn boundary. It invokes provider conversation rollback, separately restores files when requested, deletes later checkpoint refs, then records provider-thread updates and marks later runs/root nodes `rolled_back`. Rolled-back turns remain in application audit history while being excluded from the live provider conversation and later rollback counts. Later checkpoint refs becoming stale/deleted means retaining an audit record is not equivalent to retaining an independently restorable former timeline. [Rollback order and audit handling][rollback], [repeated rollback test][rollbackTests]

## What file restoration actually means

Capture uses a private Git index and `git add -A -- .` (or `-u` for a workspace now ignored), writes a tree and checkpoint commit, and updates a private ref under `refs/t3/orchestration-v2/checkpoints`. It preserves the user's real staging index during capture. The snapshot represents disk contents within the checkpoint cwd, including eligible untracked files; it is not a copy of unsaved editor memory. Untracked ignored files, empty directories and the internals of nested repositories are outside ordinary Git content capture. The driver has special handling for sparse indexes, racy timestamps, ignored workspaces and uncommitted nested repositories. [Git capture][git], [capture tests][gitTests]

Restoration runs `git restore --source <checkpoint> --worktree --staged -- .`, then `git clean -fd -- .`, then resets the scoped staging index against current HEAD when HEAD exists. **Newer nonignored untracked files can be deleted. Untracked ignored files remain.** It restores contents rather than rewinding branch/HEAD or recovering the former staging arrangement. Scoped nested-workspace tests assert that files and staging outside that workspace remain intact. [Git restore][gitRestore], [empty/nested restore test][restoreTest]

File restoration is allowed only for an isolated worktree. Both admission and execution check safety. Original project checkout use is treated as shared; the helper resolves real paths and rejects overlaps with other nondeleted active or archived threads, their checkpoint scopes, relevant nonstopped provider sessions and project roots. An idle side chat with no recorded command/file-change/dynamic-tool work is a deliberate exception. This protects against known T3 thread sharing; it does not establish transactional exclusion of arbitrary external editors or processes. [Isolation implementation][safety], [isolation tests][safetyTests]

Provider rollback, Git restoration and application event updates are separate effects. A missing managed worktree may be recreated before safety checking. A failure after provider rollback can therefore leave conversation and files at different stages; the inspected service has no atomic transaction or compensating undo across those systems. External deployments, sent messages and other tool side effects have no inverse in this path. [Execution order][rollback]

## Forks: conversation lineage, current files

Fork source statuses include completed, waiting, failed, interrupted and cancelled runs; active and rolled-back runs are rejected. The contract also exposes latest-stable and checkpoint source points, but the visible response action sends a run ID. A new thread and pending context transfer are recorded; the original remains. Crucially, the target thread is built by spreading the source thread and retaining its `worktreePath` and `branch`. The client dispatches and navigates; it does not request a new checkout or file restore. [Fork source contract][contracts], [fork service][fork], [dispatch][dispatch], [UI controller][rewind], [client command][commands]

Native provider forking happens when the target starts work. If the source becomes busy, T3 can instead create a portable context handoff from recorded source history. A portable handoff is summarized/transferred context, not proof of byte-identical native conversation history. Thus **fork from an earlier response is not an isolated branch of the filesystem at that historical response**. The source and fork can share today's files. [First-turn native fork and busy fallback][start]

## Provider details that matter for escode

- **Codex:** current rollback counts terminal turns after the chosen boundary, requires paginated history, loads an unloaded thread when necessary and calls `thread/revert` using a paged `beforeTurnId`. Legacy history is explicitly rejected. Native fork prefers `thread/fork` with inclusive `lastTurnId`; absent a native boundary, it may fork then revert the extra turns, again requiring paginated history. [Boundary calculation][codexBoundaries], [adapter execution][codex], [revert pagination][revert]
- **Claude:** rollback rejects active work, closes a live query and records a `resumeSessionAt` conversation head; returning to a fresh nonforked start can allocate a new native session ID. Native fork uses SDK `forkSession` with an `upToMessageId` when available. Earlier targets lacking a real assistant-message cursor can fail. These mechanisms differ from Codex's native revert. [Cursor requirements][claudeBoundaries], [rollback/fork execution][claude]

These are source-level adapter observations. They do not establish that the user's installed provider version implements every operation correctly, or that all other T3 provider drivers offer identical capabilities.

## Consequence for the escode discussion

T3 supplies a concrete reference for **run-level conversation rewind with optional whole-workspace file restoration**, plus historical diffs and conversation forks. It does not demonstrate restoration before any arbitrary tool action, a complete past application-state view, preservation of every later filesystem timeline, or an automatically isolated historical filesystem fork. Those remain separate product decisions. An event store alone does not supply missing file bytes, provider cursors, external-effect reversal or atomic cross-system restore.

T3 commits application events, projections, command receipts and queued effects through its SQLite transaction boundary. File checkpoint contents remain in Git, and provider history changes use provider-specific operations. This is a combination of event sourcing and explicit checkpoints, rather than evidence that event sourcing alone implements time travel. For escode, adopting SQLite, selecting a historical state model and owning complete provider transcripts remain independent decisions. [Application commit][events], [Git checkpoints][git], [rollback coordination][rollback]

## Evidence and limits

Inspected the current production paths above and the corresponding Git checkpoint, rollback, isolation, Codex and Claude adapter tests. Notable source tests cover empty/nested restore, preservation of ignored files, deletion of later untracked files, sparse/racy capture, shared-workspace rejection, worktree cleanup leases, repeated stopped-run rollback, Codex prior-turn fork/revert handling and Claude cursor failures. [Git tests][gitTests], [rollback tests][rollbackTests], [safety tests][safetyTests], [Codex tests][codexTests], [Claude tests][claudeTests]

No T3 tests were executed: the isolated checkout has no installed dependencies. No live provider turn, destructive restore, UI runtime check or crash test was performed. Only this research document was added to escode; no product, glossary or ADR behavior changed.

[ui]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/web/src/components/chat/ChatOverlayHosts.tsx
[events]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/EventSink.ts#L635
[targets]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/web/src/session-logic.ts
[rewind]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/web/src/components/chat/useTimelineRewind.ts
[assistant]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/web/src/components/chat/TimelineAssistantRows.tsx
[composer]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/web/src/components/chat/chatViewSend.ts
[diff]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/web/src/components/DiffPanel.tsx
[rollback]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/CheckpointRollbackService.ts
[safety]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/CheckpointRestoreSafety.ts
[git]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/vcs/GitVcsDriver.ts
[gitTests]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/vcs/GitVcsDriver.test.ts
[checkpoint]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/CheckpointService.ts
[capture]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/CheckpointCaptureService.ts
[baseline]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/RunExecutionService.ts
[fork]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/ThreadForkService.ts
[dispatch]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/Orchestrator.ts
[start]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/ProviderTurnStartService.ts
[codex]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts
[revert]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/provider/CodexThreadRevert.ts
[claude]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts
[rollbackTests]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/CheckpointRollbackService.test.ts
[safetyTests]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/CheckpointRestoreSafety.test.ts
[codexTests]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.test.ts
[claudeTests]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts
[commands]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/packages/client-runtime/src/operations/commands.ts
[contracts]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/packages/contracts/src/orchestrationV2.ts
[gitRestore]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/vcs/GitVcsDriver.ts#L1242
[restoreTest]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/vcs/GitVcsDriver.test.ts#L1041
[codexBoundaries]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L960
[claudeBoundaries]: https://github.com/pingdotgg/t3code/blob/1a93920deafd253edbbadacd6b0be150a689a2cd/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L1964

