# Reliable multi-client execution architecture

Research and proposed specification amendment, 2026-10-31. Scope: [decision map](https://github.com/ejjsharpe/escode/issues/157), [research questions](https://github.com/ejjsharpe/escode/issues/158). Application implementation waits for completion of the decision map.

## Recommendation and decision status

Use T3 Code's transactional execution core as the principal runtime reference, and VS Code's client/service separation, independent editor state and reconnect protocol as supporting references. Make **Execution** the single admission and lifecycle authority, with ordinary TypeScript decisions/projections inside Effect-native host workflows. Keep provider-native context separate from an escode-owned record of execution facts and normalized visible content.

The user requested all six directions and subsequently selected T3's restart-continuation policy, retaining SQLite WAL `NORMAL` and blocking continuation when evidence is incomplete. These are directions for this proposal, not implemented guarantees. In particular, do not substitute the initially suggested one-attempt-per-turn policy for T3's policy.

[Reference research](execution-reference-sources.md) pins T3 `54c5f25249961a1aa0b61932329092eadbd9d6fc` and VS Code `53ab3ae2e4eb7bceaf797a7e4d05bd8c7a5c203d`, citing actual source. It distinguishes upstream behavior from the design recommendations below. This examines upstream, not the exact T3 binary the user runs.

## Existing escode and the amendment surface

Baseline commit: `5830a0f65facb3324423ff4dde1a240ed85885bc`.

- [Host transport](https://github.com/ejjsharpe/escode/blob/5830a0f65facb3324423ff4dde1a240ed85885bc/packages/host/index.ts) already uses Effect RPC, bounded delivery and a host scope, but accepts a broad set of Promise callbacks. Extending this callback bag does not consolidate execution ownership.
- [ChatService](https://github.com/ejjsharpe/escode/blob/5830a0f65facb3324423ff4dde1a240ed85885bc/apps/desktop/host/chat-service.ts) owns connection, preparation, turn start, checkpoint, title and shutdown coordination. [DurableSend](https://github.com/ejjsharpe/escode/blob/5830a0f65facb3324423ff4dde1a240ed85885bc/apps/desktop/host/durable-send.ts) separately admits, marks dispatching, invokes external work and records acceptance or uncertainty. Preserve its refusal to redispatch duplicate identities and its emergency Stop escape hatch.
- [SQLite worker](https://github.com/ejjsharpe/escode/blob/5830a0f65facb3324423ff4dde1a240ed85885bc/apps/desktop/host/sqlite-worker.cjs) owns current-state records and receipts, uses WAL `NORMAL`, and marks unfinished submissions uncertain on startup. These are useful operation journals, not a complete event log or transactional follow-up queue.
- [Client runtime](https://github.com/ejjsharpe/escode/blob/5830a0f65facb3324423ff4dde1a240ed85885bc/packages/client-runtime/index.ts) checks epoch/revision and resnapshots; composer identities live separately in [chat.ts](https://github.com/ejjsharpe/escode/blob/5830a0f65facb3324423ff4dde1a240ed85885bc/packages/client-runtime/chat.ts). Preserve that independent draft ownership.

Final adoption must amend README, the host lifecycle specification/decision, durable-state specification, ADR 0002/0003 and affected glossary definitions together. ADR 0003 explicitly selected current-state storage without application-wide event sourcing and no automatic continuation. Do not silently relabel that accepted decision. Preserve native historical boundaries, file restoration safeguards, receipt uncertainty, client recovery and checkpoint retention as separate obligations. A new ADR is justified when the event authority/retention and restart durability trade-offs are finalized; none is marked accepted here.

## Ownership and extension seams

Execution owns authenticated command admission, deduplication, revision checks, scheduling, resource concurrency, receipts, recovery and shutdown. It does not absorb every feature's rules. Files owns path authority, native identity checks and save-conflict policy; Chats owns chat decisions; provider adapters own protocol translation and native conversation capabilities. These modules return decisions or perform explicitly assigned effects; they cannot bypass Execution to launch durable work.

Start with one host process and one SQLite authority. A proposed `packages/execution` service exposes `submit`, `getReceipt`, `snapshot`, `eventsAfter` and host lifecycle operations. Its internal files can separate admission, decisions, commit, workers and recovery without making each a public framework. `packages/contracts` owns validated wire schemas; `packages/host` authenticates and maps transport to the service; `packages/client-runtime` reconciles host state; React/Monaco own views and client buffers. The Electron entry point composes layers and translates OS lifecycle events. Provider/filesystem capabilities remain narrow host adapters.

Agent extension recipe: add a validated command, a pure decision, its facts and projection changes, an explicitly classified external job if required, and a focused invariant/crash test. Reuse the commit path. Do not add another queue, receipt store, hidden timer or renderer-to-provider route. Reads and ephemeral observations need no command journal unless they affect durable behavior.

## Effect-native orchestration

Use direct Effect composition for host workflows, resources, typed expected failures and cancellation. Retain plain TypeScript for reducers, validation decisions, formatting, scoring and UI. One runtime at the host boundary; avoid `runPromise`/`runFork` scattered through domain services and wrapping large Promise workflows merely to rename their return type.

Acquire provider connections, child processes, watchers and storage handles with explicit scoped release. Host-owned execution fibers outlive client subscriptions; a dropped RPC only cancels the client's wait. View subscriptions have their own scopes. Stop persists intent, targets the captured execution/turn and requests interruption; fiber interruption alone does not establish provider termination. Release handlers have bounded deadlines and preserve uncertainty when shutdown cannot be confirmed. Emergency Stop remains available after storage failure and disables automatic continuation until reconciled.

Use tagged errors such as revision conflict, unavailable context, permission conflict, storage unavailable and uncertain external outcome. Map expected failures to receipts/wire results; defects remain diagnosable. Retry reads and explicitly safe jobs with bounded schedules; never apply a generic retry to an external command whose acceptance is unknown. Scope cleanup is a live-process guarantee, not a power-loss recovery mechanism ([Effect scope documentation](https://effect.website/docs/v4/resource-management/scope)).

## Admission, scheduling and concurrency

The command envelope binds command ID, authenticated client or system origin, host/store identity, target identity, expected target revision and immutable payload. Duplicate identity with the same payload returns the original receipt; changed payload is rejected. A receipt distinguishes admission from dispatch and observed completion. An accepted command is not a successful provider turn.

Serialize decisions per chat and conflicting file resource. Use short database transactions; never hold them across provider, filesystem or UI waits. A host-wide bounded worker pool admits concurrent independent chats. A chat has one foreground provider turn; conflicts are rejected unless explicitly supported queue behavior is specified. Background title work has its own lane. Files and historical operations retain checkout/path exclusion. Multiple provider turns sharing a checkout remain the existing shared-files behavior, not isolation promised by the scheduler.

Stop and shutdown control must remain serviceable when workers are saturated; they must not queue behind the work they cancel. Recheck durable cancellation and resource ownership immediately before dispatch. One owner holds the store/process lock; a host generation fences stale workers. A database lease alone cannot stop an old external process: verify or terminate app-owned processes before replacement, otherwise retain uncertainty.

## Events, normalized content and projections

Event-source execution/chat transitions, receipts' lifecycle and observed normalized message/tool content. Do not event-source every keystroke or filesystem watch notification. Initial event envelope: stable ID, host sequence, entity revision, schema version, command/execution causation, observation time and typed payload. The host assigns ordering in the commit transaction; wall-clock time is not ordering authority.

Retain normalized user/assistant messages, tool invocation/result observations, content revisions and coverage markers with provider/thread/turn/item identities. Batch bounded streaming chunks; preserve durable content boundaries and final-item facts. A missing chunk is a gap, not proof of empty output. Provider backfill is a separately recorded observation, deduplicated by identity/revision, not permission to rewrite the past silently. Do not invent provider IDs when the adapter cannot establish them.

Current chat state, activity, message views and execution status are deterministic projections of retained facts. Rebuild runs in a side store and verifies sequence/version before swapping; it never runs outbox workers or creates new jobs. Store required follow-up jobs during original decision commit, not as a side effect of replaying a projection. Retained facts support rebuilding local views, not reconstructing hidden reasoning, provider compaction, native tool state or provider-native continuation context.

Begin with content inside the database to keep atomic coverage simple, subject to explicit byte limits. If large blobs later move outside SQLite, stage and durably install them before committing references, validate recovery-copy coverage and collect only unreferenced blobs. Protect unresolved execution evidence, receipts, Stop facts and continuation lineage from cleanup. Keep file-checkpoint expiry separate from transcript retention. Any content deletion needs tombstones and explicit coverage loss; it cannot preserve an unqualified claim that all historical views are rebuildable. Transcript privacy, retention budgets and initial-state cutover remain specification decisions.

## Transactional outbox

A single transaction validates the expected revision, reserves the command receipt, appends facts/content, updates projections, inserts required jobs and records admission. Rollback leaves none visible. Commit precedes publication and worker wakeup; missed wakeups are repaired by querying durable pending jobs. Publication is an optimization over ordered catch-up, never the sole delivery mechanism.

Jobs carry immutable identity, cause, target, dependency/order, status, attempt count and retry/recovery classification. Claim and completion are transactions fenced to the current host generation. Completion records observed outcome, resulting facts/projections and dependent jobs together. The external operation sits between claim and completion and cannot join the SQLite transaction.

Use T3's selective replay principle: safe local projection/cleanup jobs can retry; provider Send, approval replies and other non-idempotent dispatches require exact reconciliation after loss. Do not requeue an ambiguous provider start because its lease expired. A transactional outbox prevents lost required follow-up intent; it cannot guarantee exactly-once external effects. Unsupported reconciliation yields a visible uncertain receipt and blocks dependent work.

## Multiple clients and reliable catch-up

A snapshot includes store identity, projection version, subscription scope and committed high-water sequence. Establish the live subscription before reading a consistent snapshot/catch-up cut, buffer live overlap, replay committed events after the client's cursor through that cut, then deliver the ordered live tail with duplicates removed. T3's subscribe-before-high-water implementation is the reference. Bound event count, bytes and queued live output; when coverage is expired or the client falls behind, return an explicit snapshot reset.

For filtered subscriptions, carry an explicit cursor-through watermark; unrelated global sequence gaps are legitimate. Do not require consecutive global sequence numbers for a single chat. Apply projection changes and cursor advancement atomically in the client cache. A store replacement or rollback epoch requires a new snapshot and receipt reconciliation; old acknowledgements grant no dispatch authority.

Separate stream position from entity revision. Two clients editing the same chat settings compare target revision; the loser refreshes without losing its draft. Reconnect queries uncertain receipts with the original command identity. It never manufactures a new Send identity or silently resends an unresolved provider operation. Authority is authenticated per client, rather than trusting a client ID supplied in payloads. Revocation terminates subscriptions and follows existing host Stop policy.

Composer text, selection, tabs and file buffers remain independently keyed by client. Another client's Send cannot clear text; another client's Save cannot replace unsaved bytes. A file save checks the loaded disk baseline through the existing conflict workflow. Preserve per-client move/Trash acknowledgement obligations and recovery records. Event sourcing shared host state is not collaborative text editing.

## Automatic restart continuation: follow T3

T3's [RestartContinuation](https://github.com/pingdotgg/t3code/blob/54c5f25249961a1aa0b61932329092eadbd9d6fc/apps/server/src/orchestration-v2/RestartContinuation.ts) creates a new message and command derived deterministically from the interrupted source run. The setting defaults on and supports project overrides. It checks project settings, existing continuation message, newer work, native identity/session/turn state, archive/deletion/settled/snoozed state, pending or non-resumable requests and secret requests. It checks recorded interruption of the source and relevant parent work, excludes native maintenance commands and limits continuation chains to three links in a five-minute window. Completed/waiting runs qualify only for specific still-awaited background work, not merely because a chat exists.

Adopt that policy for escode's supported concepts: retained saved conversation, exact provider and checkout identity, captured model/effort/permissions, visible system-origin continuation and linked source execution. Use T3's ordinary continuation text, “Continue where you left off.” If interrupted background work exists, retain its explanatory note. Keep future delegation/secret/snooze cases out of the initial implementation unless those features exist, but never treat an unknown outstanding request as safe. The reference file above records upstream details; no claim of installed-binary equivalence is made.

Startup first closes admission, verifies store/context, reconciles outbox and prior execution, and identifies eligible candidates. It resumes the exact native conversation without submitting old commands. Only then does ordinary Execution admission atomically create a new tracked continuation, with stable source-derived identities and fresh current revision checks. A concurrent user Send or Stop can invalidate eligibility. Re-evaluate guards at dispatch; a queued continuation cannot outrun a committed Stop. Its own uncertain dispatch is never blindly retried. New output belongs to the new execution; the interrupted execution retains its final known outcome.

Explicit Quit/host shutdown remains deliberate stop, not unexpected loss. Record shutdown/cancellation intent before disposing resources; drain or cancel within a bounded deadline, flush available outcomes and retain unknown effects. Client disconnect does not trigger continuation because execution remains host-owned. Recovery from a backup copy remains quarantined and cannot automatically wake work.

### Selected durability and its hard limit

Keep WAL `NORMAL`, as the user explicitly selected. SQLite documents that WAL `NORMAL` can lose committed transactions after OS crash/power loss while preserving consistency ([SQLite synchronous documentation](https://www.sqlite.org/pragma.html#pragma_synchronous)). Therefore a valid database, contiguous log and absence of Stop cannot prove that no acknowledged Stop or later execution was lost. Provider history may confirm a turn but does not necessarily retain escode Stop, approval or continuation-budget evidence.

Block automatic continuation when any required fact, outcome, native identity or retention coverage is incomplete. Additionally, an unclean laptop/OS loss with no independently trustworthy evidence of the latest control state must remain blocked even if the recovered database looks consistent. A process-only restart can be eligible where surviving OS/storage and exact provider evidence establish the required state; inability to distinguish the failure class is uncertainty. T3 itself also uses [NORMAL](https://github.com/pingdotgg/t3code/blob/54c5f25249961a1aa0b61932329092eadbd9d6fc/apps/server/src/persistence/Sqlite.ts#L25-L30); its source policy is useful behavior to adopt, not proof that lost control records are detectable.

This leaves a real constraint: blanket automatic continuation after every laptop power loss, NORMAL-only storage, and absolute preservation of acknowledged Stop cannot all be promised together. This proposal honors NORMAL plus blocking. A future decision could add a narrowly stronger control journal or stronger commits, but neither is silently introduced here. Approval is never inferred or replayed; new continuation requests fresh approval under the captured policy when required.

## Failure scenarios that qualify the design

1. Two clients submit against the same idle chat revision: one admission succeeds, one conflicts; both drafts survive. Retrying the winner's command ID returns the same receipt.
2. Crash before/after commit: before leaves no partial event/projection/receipt/job set; after leaves a recoverable required job despite lost publication.
3. Provider accepts Send, then host loses the response: reconciliation may identify the exact turn; absent proof it remains uncertain, with no second Send.
4. Stop arrives while a continuation is queued: committed Stop prevents dispatch. Stop persistence fails: emergency cancellation remains possible, automatic continuation remains blocked.
5. Laptop loses an acknowledged Stop under NORMAL: apparently valid earlier state is insufficient; unresolved power-loss evidence blocks continuation.
6. Host crashes during approval wait: preserve the request as unresolved/non-resumable; do not send an old approval response or use a continuation to bypass it.
7. Reconnect overlaps events with snapshot and catch-up: each relevant update applies once; expired cursors, overflow and store replacement converge through an explicit reset.
8. Client A saves or moves while B has unsaved text: B retains bytes and baseline, then reconciles or conflicts using its own recovery obligations.
9. Repeated crashes of continuation runs: source-derived IDs prevent duplicate continuations and the T3 chain/window guard halts the loop; restart cannot reset its retained evidence.
10. Provider completes before host observes completion: inspect exact provider state; do not continue a completed foreground task or fabricate completion checkpoints from later files.
11. Rebuild every declared projection from retained events: compare canonical results; assert that no provider calls or new outbox jobs occur.
12. Worker dies during filesystem mutation: existing operation journal/native identity checks establish result or uncertainty; outbox recovery never blindly repeats a destructive operation.

## Implementation sequence after specification

First extract Execution admission and lifecycle behind the existing host transport, retaining current behavior and emergency Stop. Convert resource-owning workflows to Effect and run existing durable-send, controls, shutdown and preparation checks. Next add event/projection/receipt/outbox atomic commits for one complete Send/control vertical slice, including crash-window tests, then move remaining durable mutation paths onto it. Add normalized content with bounded retention/coverage and deterministic rebuild checks. Replace reconnect with snapshot/catch-up and qualify two independent clients, stale revisions and file buffers. Enable automatic continuation last, once source lineage, Stop, approval, uncertainty and startup reconciliation are durable and tested.

Required reach includes contracts, host composition, ChatService, DurableSend/DurableFiles, SQLite worker and recovery-copy inventory, client runtime, composer/buffer recovery, lifecycle UI, provider adapters and associated fixtures/crash tests. Existing native file safeguards and historical workflows stay mandatory during the move. Read models and provider-native history remain separately inspectable throughout cutover. The final spec must choose fresh-store versus explicit migration before changing schemas; existing prerelease fresh-state policy is not authority to silently destroy current state.

Remaining decisions: event/content retention and capacity, cutover policy, exact evidence accepted for restart eligibility under NORMAL, and concrete queue budgets. Defer distributed hosting, plugin registries, generic workflow DSLs and event-sourcing all editor state. Validation for this research is source inspection and document consistency only; no runtime implementation, upstream test execution or power-loss qualification is claimed.
