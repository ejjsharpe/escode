# Durable state and turn-level time travel

Status: accepted by the user, 2026-10-31, after the complete grilling synthesis and final defaults were confirmed. This is a specification for a subsequent implementation effort, not implemented behavior or runtime acceptance. There was no open `wayfinder:map` at confirmation.

Implementation specification: [Specification: durable state and turn-level time travel](https://github.com/ejjsharpe/escode/issues/117), published with `ready-for-agent` after the user confirmed the existing host/client test boundary, real temporary SQLite/Git data and focused packaged UI checks.

## Decisions and authority

Adopt one execution-host-owned SQLite database for authoritative application metadata. Use conventional current-state tables, explicit transactions, command receipts, operation records and retained turn checkpoints. Complete conversation history remains provider-owned. These are three independent decisions: SQLite adoption does not require application-wide event sourcing or ownership of complete transcripts.

The [architecture decision](../adr/0003-sqlite-and-turn-checkpoints.md) amends [ADR 0002](../adr/0002-versioned-recovery-and-history.md). The existing [foundation specification](effect-foundation.md) still owns host authority, authentication, exact identities, client-owned edits, command uncertainty and no automatic replay/continuation. Its fresh-store/no-import policy remains: do not delete or import existing stores or external resources. This agreement authorizes no import exception.

The [durable-state research](https://github.com/ejjsharpe/escode/blob/501c1ad4efbdc7d02b4684fa12311d6d01b61a52/docs/research/durable-state-architecture.md), including section 3.1, supplies the recovery analysis and alternatives. The [T3 comparison](https://github.com/ejjsharpe/escode/blob/004e5eff78905690b0018d067b380cc3af685ec7/docs/research/t3-time-travel.md) inspects upstream `1a93920deafd253edbbadacd6b0be150a689a2cd`. Neither report is an implementation acceptance record. This agreement selects `NORMAL` rather than the original report's stronger flushing recommendation.

## Inspect, rewind and branch

Inspection shows available historical conversation and file changes without changing current files, provider context or execution. Recorded individual file-change details may be inspected; they are not independent restore points. Selectable continuation/restoration points are turn boundaries, including before a user message and after the corresponding agent turn.

Conversation rewind is an explicit user action, distinct from inspection. Offer conversation-only rewind, retaining today's files, and rewind with file restoration. Explain the chosen scope before applying it. File restoration can replace the user's saved edits and remove newer eligible untracked files; it must not silently discard available unsaved client text or its conflict baseline. Rewind may abandon later restore points. An automatic safety checkpoint that makes every rewind reversible is not required; branching is the way to preserve both paths.

A historical branch creates a separate chat and managed worktree from the selected point, preserving the original chat, worktree, saved files and unsaved edits. Use the Git base commit recorded at the checkpoint, then apply its captured working files as uncommitted changes. Synthetic checkpoint commits must not appear as ordinary commits on the new branch. Reproducing the old staging arrangement is outside scope. Dependencies, ignored environment files and setup may need to be prepared separately.

Branch creation and inspection do not submit a prompt or automatically start another turn. Retain existing resource-reservation, exact-path identity and partial-allocation rules; failures must not silently allocate substitute worktrees or provider contexts. A missing historical Git base or checkpoint is an unavailable target, not permission to use today's files instead.

Continuation requires provider-supported historical conversation context. A transcript copy cannot recreate missing native provider context. Offer summarized continuation only as an explicitly different fallback; never silently substitute it for a native historical branch or rewind. Provider capability/history loss can make inspection or continuation unavailable even when a file checkpoint remains.

## File checkpoints and ownership

Capture a fresh saved-file snapshot before each turn, including manual saved changes since the previous turn. Capture the corresponding completion boundary when available. Do not reuse the previous turn's after-state as a substitute for the next turn's fresh before-state. Retain boundary identity, chat/provider references, exact checkout identity, Git base and file-snapshot availability independently.

Coverage follows ordinary Git content capture: tracked files and eligible nonignored untracked files on disk. Untracked ignored files, unsaved editor buffers, empty directories, nested repository contents and the complete development environment are outside the file-snapshot promise. Snapshot capture must preserve the user's actual Git index. Client recovery separately protects available unsaved text and loaded baselines; window layout and other clients' unsent text are not time-travel state.

Only an isolated worktree is eligible for in-place file restoration. The original project checkout and worktrees shared with other chats are ineligible; offer conversation-only rewind or a new historical branch instead. Recheck isolation and exact target authority at execution, preserve available client recovery state, and retain existing external-writer race limits. An isolation check does not exclude unrelated external programs transactionally.

Historical file restoration and worktree branching initially require Git-backed project chats. No project scratch folders remain without automatically introduced Git. Ordinary conversation history and provider-supported conversation rewind remain available independently of file-snapshot availability.

Checkpoint capture failure or exhaustion does not by itself prevent agent work. Mark missing coverage explicitly, retain conversation/control capability where available, and disable historical file operations that need unavailable contents. This exception applies to optional checkpoints, not command admission: Send and approval still require the accepted persisted intent/receipt path.

## Automatic cleanup

Expose one configurable inactivity retention period for file checkpoints, initially **30 days**, with **Never** available. This is an initial product default, not a measured disk-capacity limit.

Deliberately opening a chat, user messages and agent work reset its inactivity clock. Background polling and metadata refreshes do not. Opening a chat extends retention only for checkpoints still present; it cannot recover expired contents. Historical branches retain the checkpoint data they depend on even if their source chat becomes eligible for cleanup.

Perform routine cleanup in the background without recurring confirmation dialogs or interruption of live work. Preserve referenced branch data, active operation requirements, recovery drafts, unresolved operation evidence and nonterminal/uncertain receipts. Reclaim redundant or unreachable data automatically. Expiring file checkpoints does not delete provider conversations or existing worktrees; worktree removal retains its existing separate safety rules.

Show which historical file targets are available and why others are unavailable, including expiry. Changing retention must clearly describe its effect on file restore and historical branching. Database free-page reclamation and Git object reclamation are distinct from logical expiry; do not promise that removing a checkpoint reference immediately releases its apparent size on disk.

Inactivity retention, including Never, cannot alone bound storage for continuously active chats. Implementation must measure growth, establish explicit storage/queue bounds and exercise exhaustion. If optional checkpoint capture cannot continue, disclose missing coverage rather than silently evicting protected state or blocking unrelated agent work.

## Storage, durability and recovery

The host owns transactions across related identities, chat/context associations, reservations, command receipts, client pending submissions/composer revisions, recovery records, operation facts and checkpoint metadata. Preserve separate client ownership and per-client acknowledgements. Current tables and dedicated checkpoint/history records are the source of truth; application-wide event replay is not required. Keep project files, provider histories and bounded external spool contents under their existing separate ownership.

Use SQLite WAL with `synchronous=NORMAL`, following the T3 durability trade-off; retain checkpoint full flushing on macOS where supported. Recover committed database state after an application crash under SQLite's storage assumptions. **An OS crash or power loss may lose recent acknowledged metadata.** No per-commit `FULL`/full-flush guarantee, stronger project-file power-loss guarantee or absolute hardware-failure guarantee is accepted. Read back effective settings in qualification and measure actual responsiveness; no performance improvement is claimed.

External provider, Git and filesystem effects do not participate in the database transaction. Preserve admission/dispatch evidence before ordinary effects, record known outcomes and retain uncertainty when an effect may have happened without a surviving result. Missing metadata is not proof that nothing executed, including after system failure or backup restore. Reconnect, restart and restore must never resend prompts, approvals or recovered mutations, nor automatically resume agent turns. Preserve admission-epoch protection against retired or lost command identities; backup restore must not revive old admission authority.

Emergency Stop is an explicit exception when its ordinary receipt cannot be persisted. Revalidate authority and target the captured live turn/preparation rather than whichever turn is current later. Attempt live cancellation without requiring a successful error/outcome write, disclose the non-durable or uncertain outcome, and retain available evidence. This permits stopping only; it does not permit unrecorded Send, approvals or automatic retry. Provider/external side effects may remain after Stop.

The first storage milestone includes a consistent recovery-copy mechanism and tested recovery procedure for escode-owned state. Use SQLite's backup API or a supported consistent export, with declared coverage of required checkpoint and spool contents; copying a live database file alone is insufficient. Keep originals while validating a recovery copy. Reconcile actual roots, files, provider identities and uncertain work before allowing effects; a recovered database cannot undo external effects or recreate provider-owned history. A user-facing scheduled or remote backup product is a later effort.

## Delivery and qualification

Deliver incrementally, beginning with the durable-storage foundation; inspect, rewind and historical branching need not ship together. This document does not begin application implementation. Existing authentication, preservation, fresh-state and practical qualification requirements remain applicable.

The subsequent implementation must provide focused evidence for:

1. Atomic related metadata changes, duplicate command handling, crash/reopen, worker failure, full disk and unsupported/corrupt-store refusal, without replacement identities or replay.
2. Fresh before-turn capture after intervening manual saves, completion capture, Git index preservation, declared exclusions and missing-checkpoint behavior while agent work continues.
3. Inspection without effects; conversation-only rewind retaining files; explicit file restoration with unsaved-work protection; refusal of shared/original checkout restoration; No project conversation operations without a file checkpoint.
4. A historical branch with the recorded Git base, captured uncommitted files and provider-supported context, preserving the original and starting no turn automatically; explicit summarized fallback and retained partial allocation on failure.
5. Cleanup's 30-day/Never settings, deliberate-open/message/agent activity resets, polling exclusion, branch dependency protection, expiry disclosure, storage exhaustion and separation from worktree deletion.
6. Ordinary and emergency Stop under storage failure, including a superseded target; uncertain multi-effect restoration without automatic replay; a consistent backup with verified content coverage and tested recovery.
7. Actual packaged Electron/SQLite/provider compatibility and responsive Send, Save, editing and checkpoint/cleanup behavior. Performance, growth, provider compatibility and failure guarantees remain unqualified until measured.

Arbitrary tool-action restore points, application-wide event sourcing, complete independent transcript archives, automatic reversible rewind, environment snapshots, full staging-history restoration, legacy import and stronger native file durability are outside this accepted scope.
