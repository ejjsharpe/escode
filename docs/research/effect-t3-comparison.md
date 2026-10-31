# Remaining Promise orchestration: escode versus T3 Code

Research date: 2026-10-31. Recommendation only; no implementation authorization.

## Decision summary

Migrate **ownership and cancellation boundaries before Promise syntax**. Keep Promise-returning UI APIs and native Node adapters where useful. First simplify the client runtime internally; then introduce explicit host-owned Effect service lifetimes before converting admitted commands and chat/provider orchestration. Preserve the current persistence formats, flush order, receipt identities and native filesystem authority. Defer observation and write-queue rewrites until they remove actual lifetime complexity.

This ordering follows an important counterexample: T3's Effect RPC layer coexists with a Promise command scheduler supporting serial, single-flight and latest modes. Effect adoption does not require eliminating all Promises. escode's client has a more local avoidable round trip: summary subscription Effect → `runQuery`/`runPromise` → `tryPromise` → Effect. [T3 scheduler][tscheduler], [escode client][eclient]

## Sources and comparison baseline

Inspected escode `c1dc27fe322b6564ec54868ab3e6fd3a2241df46`, T3 current upstream `b65f8686b3c7e16573f99d41a9539ff365cf1e89`, and T3 extraction pin `305a90dce44b8b7813d951662f13ce8510a3c669`. escode's extraction manifest identifies that older pin and explicitly retains native process ownership outside the extracted protocol. README, AGENTS.md and tracker instructions were read; the open `wayfinder:map` query returned no issues. No issue operations were performed. [Manifest][manifest], [repository scope][readme]

Local `git show` inspected the original pin's client scheduler, RPC session selection and Codex stdio adapter. `git diff` between the two T3 revisions found **no changes** in `rpc/{client,session}.ts`, `state/runtime.ts`, `GitManager.ts`, `VcsProcess.ts`, `processRunner.ts`, `ThreadLiveEventCoalescer.ts`, `OrchestrationEventStore.ts`, `OrchestrationCommandReceipts.ts` or `Sqlite.ts`. The client-boundary, cache and persistence comparisons below therefore apply to both pins. ProviderAdapter and managedProvider *have* changed; their high-level observations below describe current upstream only. [Original scheduler][oldruntime], [original RPC][oldrpc], [original stdio][oldstdio], [current provider contract][provider]

Statements describing implementations are evidence; proposed slices and priorities are engineering inference from that evidence. This is source inspection plus the bounded protocol experiment below, not a performance measurement or application runtime qualification.

## 1. Client runtime: keep the outer Promise, simplify the inner lifetime

escode stores a `Promise<Client>` beside a manually created Scope, builds the protocol and client through separate `runPromise` calls, and executes each query through `runQuery`. That helper correctly distinguishes domain failures from transport failures and only closes the matching session. Separate four-permit lanes protect control queries from bulk listings; counters bound admission. These are behaviors to preserve, not incidental scaffolding. [Connection/query boundary][econnect], [listing and summary paths][eclient]

T3 keeps RPC operations as Effects: current session comes from the supervisor's SubscriptionRef; `requestGuarded` authorizes and executes the method with an observation finalizer. A session factory requires Scope and exposes Effect-valued readiness, probe and closure. At the consumer boundary, `runAtomCommand` and `executeAtomQuery` return Promises, and the scheduler itself uses Promise maps. T3 even bridges its scheduler with `Effect.promise` and `runPromiseExitWith`. The useful pattern is a deliberate UI bridge around a scoped runtime, not a claim of complete Promise purity. [T3 RPC][trpc], [session contract][tsession], [runtime bridge][truntime], [scheduler][tscheduler]

**Adapt:** factor an Effect-native query executor inside escode; leave `runPromise` at public Promise methods and subscription startup/disposal. Remove the summary double bridge first, then consider Effect-valued connection acquisition within one owned session scope. Preserve bootstrap validation, failed-session retirement, domain-error isolation, timeouts, separate admission lanes, and unsubscribe-without-disconnecting-other-users behavior. Do not import T3's atom state system, permissions product or multi-environment supervisor merely to achieve this.

**Narrow gate:** existing `host-client.test.ts` exercises held listing saturation, same-session domain failures, renewed authentication after transport failure, unsubscribe and setup failures. `reconnect.test.ts` covers resnapshotting and receipt/history reconciliation without another turn. Adapt T3's tests for “scope release closes the socket” and session replacement only where escode gains those abstractions; retain escode's bounded retry policy rather than copying T3 subscription policy. [escode host-client tests][eclienttests], [reconnect tests][ereconnect], [T3 session tests][tsessiontests], [T3 subscription tests][trpctests]

## 2. Host service contracts: cancellation is the migration hazard

escode `startHost` accepts Promise callbacks and wraps them in `Effect.tryPromise`; RPC owns request streams and disconnect bookkeeping. Lookup deliberately receives the cancellation signal, whereas Send and mutations do not. `executeSend` admits and records identity before provider dispatch, returns an existing receipt without dispatch, and records ambiguous failures as uncertain. Its comment explicitly states socket cancellation does not own that Promise. A mechanical replacement with request-scoped Effects could therefore change behavior even while every typecheck passes. [Host callbacks and handlers][ehost], [Send orchestration][esend]

T3 service contracts such as `GitManager` express outputs and typed errors as Effects, with scoped subscriptions; provider opening also explicitly requires Scope. This makes resource requirements visible in interfaces. It does **not**, by itself, prove that a mutation outlives a disconnected caller: that depends on the caller's ownership and supervision. [Git contract][tgit], [provider contract][provider]

**Adapt:** introduce Effect contracts incrementally around actual cohesive host capabilities, starting with read-only queries and a host-owned operation runner. Define three lifetimes: cancellable observations/search, admitted host commands independent of socket requests, and provider sessions terminated by explicit host/chat lifecycle actions. An RPC cancellation may stop waiting for an admitted result; it must not cancel the admitted operation. Join that operation from the request, but fork/own it in the host service scope, with explicit admission limits and shutdown handling. Avoid daemon fibers that escape orderly shutdown, and avoid wrapping whole handlers uninterruptibly when only admission/publication needs protection.

**Narrow gate:** add deterministic held-dispatch tests that disconnect the client *while* Send, save, move or create is admitted, release the operation, then verify the durable result through fresh authorized access. Existing reconnect tests lose a Send response and check one dispatch; they do not alone establish every mutation's in-flight lifetime. Retain tests for receipt persistence failures, conflicting identities, exhaustion and no redispatch of uncertain Send. No automatic host/provider restart, retry of dispatch, or replacement conversation is acceptable. [Receipt tests][esendtests], [lost-result test][ereconnect], [uncertain provider creation guard][echatopen]

## 3. Concurrency and coalescing: preserve the algorithm, not just the primitive

escode's observation helper tracks pending and dirty Promises per root. The first caller receives the current scan; overlapping callers share one subsequent scan. A new invalidation during that scan creates a further refresh. Rejection releases pending state and does not poison later work. Despite the first test's “discard” wording, its assertions explicitly deliver results 1, 2 and 3: completed observations are not starved by continuous dirtiness. [Coalescer][eobserve], [asserted behavior][eobservetests]

T3 GitManager uses a bounded local-status Cache, canonicalized path keys, a one-second success TTL, zero failure TTL and explicit invalidation. This is a different freshness contract. Its client latest scheduler is conceptually closer to an active plus pending lane, but lives at the UI command boundary. Neither is a drop-in replacement for escode's convergence behavior. [T3 cache][tcache], [scheduler][tscheduler]

T3's live-event coalescer is a third problem: timed event compaction, budget accounting, mutex-protected flushes, scoped fibers and an explicit cleanup Deferred. Its Queue is unbounded structurally but wrapped in a live-stream budget; copying the Queue alone would discard the bound. Reuse its principles of explicit completion and short protected publication, not its product event schema. [Live coalescer state][tcoalescer], [completion/stream ownership][tcoalescerend]

**Leave initially:** the 22-line observation helper. If host contracts become Effects, adapt it with per-root Deferred/Fiber state only when host-owned cancellation and shutdown justify the extra machinery. Gate that slice with its existing two tests plus interruption of one waiter without cancelling another's refresh. Keep checkout keys and identity validation separate; T3 realpath normalization is not permission to merge escode checkout identities.

## 4. Persistence: serialization is not durability

escode has short serial Promise queues in chat associations, workspace state, file-operation journal and spool storage. Journal/workspace use `atomicWriteJson`, which writes a temporary file, syncs it, renames it and syncs the containing directory. Chats additionally use exclusive temporary creation and latch storage failure, preventing later edits until explicit recovery. The spool serializes writes and publishes synced chunks/indexes with quota and integrity checks. These differing failure policies rule out an indiscriminate shared queue abstraction. [Atomic publication][eatomic], [chat queue][echatstore], [workspace queue][eworkspace], [journal queue][ejournal], [spool][espool]

T3 provides Effect repository contracts, SQL receipt insertion/lookup, and event-store schemas with sequence/correlation metadata. That demonstrates an Effect-native persistence seam, not a reason to adopt its event model. Current SQLite setup uses WAL and `synchronous=NORMAL`; its source expressly documents possible rollback of post-checkpoint commits on OS crash/power loss. escode's explicit sync protocol must not silently inherit that trade-off. Effect primitives alone do not establish crash durability. [T3 receipts][treceipts], [event schema][tevents], [SQLite settings][tsqlite]

**Adapt later:** expose existing storage functions through typed Effects while retaining bytes, validation and publication order. If replacing queues, ensure a failed operation still reaches its caller, later operations follow that store's existing failure policy, reads wait for preceding writes, and shutdown drains admitted publication. Keep write-critical sections protected from request cancellation; do not coalesce durable command receipts or journal transitions as “latest.”

**Narrow gate:** journal serialization/failure recovery and ownership validation; spool corruption, binding and quota tests; workspace acknowledged recovery/approval identity tests; chat unsupported-version and failure behavior; atomic-write fault tests. Reopen a new store instance to establish persistence, rather than asserting only in-memory success. [Journal tests][ejournaltests], [spool tests][espooltests], [workspace tests][eworkspacetests], [chat format tests][echatformat], [atomic-write faults][eatomictests]

## 5. Provider and subprocess ownership: high value, larger risk

`connectCodex` already runs the extracted Effect protocol, then converts requests to Promises. escode separately owns detached process groups, TERM/KILL escalation, a completion Promise, deferred approval replies and stream adapters. ChatService adds opening/recovering/writing single flights, epoch checks against stale callbacks, a 16-writer limit and shutdown ordering that waits for late connectors, process completion and output writes. These are substantial orchestration responsibilities, not merely asynchronous leaf calls. [Provider bridge][etools], [opening epochs][echatopen], [output writer][ewriter], [shutdown][eshutdown]

Current T3 ProviderAdapter exposes Effect session opening with Scope; managed-provider metadata enrichment uses a captured scope, semaphore, generation checks and scoped fibers. The latter concerns provider metadata, not proof about turn execution ownership. Its generic ProcessRunner scopes each subprocess, imposes timeout behavior and configures force-kill escalation; VcsProcess adds typed errors and concurrency policy. These are useful patterns to adapt without importing multi-provider routing or T3's orchestration/event store. [Provider contract][provider], [metadata ownership][tmanaged], [process lifetime][tprocess], [spawn cleanup][tspawn], [VCS contract][tvcs]

**Adapt after host ownership exists:** keep the vendored protocol Effect-native through a scoped escode Codex service; replace ChatService's manual in-flight fields in bounded steps. Keep epoch/generation guards where external callbacks can arrive late. Preserve process-group descendant cleanup and diagnostic/version checks. Explicit restart must remain an explicit action; reconnecting an observation must never restart or redispatch provider work. Gate with existing resistant-descendant, opening-during-shutdown and failed-initialization tests before removing their Promise machinery. [Shutdown tests][eshutdowntests], [tool diagnostics tests][etooltests]

`Checkout.io` remains synchronous: wrapping `execFileSync` in an Effect would still block the host. T3's asynchronous runner suggests a separate responsiveness slice, but escode passes an already opened directory descriptor to its native helper and validates checkout identity. Any async replacement must preserve descriptor lifetime, no-follow ancestry, literal arguments and native publication checks. Do not substitute a pathname-only process runner. Measure blocked responsiveness first; performance gains remain unmeasured here. [Native IO][eio], [identity checks][eidentity], [filesystem safety tests][eprojecttests], [native race tests][enativetests]

## 6. Upstream maintenance: a reproduced protocol cleanup difference

Review this independently of the Promise migration. Current T3 tracks incoming request-handler fibers by request ID and interrupts the matching handler on `serverRequest/resolved`. Its regression test fills 32 pending approval handlers, resolves them through provider notifications, then verifies that request 33 succeeds. The extracted version instead forks anonymous request-handler fibers and decrements its active count only when each handler exits. escode's callback awaits a Deferred reply; its ChatService handles the resolution notification by removing the visible request, without completing that reply. [Current handler cleanup][tresolved], [resolution interruption][tresolvednotification], [upstream regression][tresolvedtest], [extracted handler][epending], [reply Deferred][ereply], [visible resolution][eresolved]

**Experiment run:** Bun 1.4.4, using escode's installed Effect 4.1.0 and in-memory Stdio/Queues; no Codex process, credentials or project writes. Start 32 handlers awaiting indefinitely; wait for all to start; send 32 `serverRequest/resolved` notifications; submit request 33 whose handler returns `{ decision: "accept" }`; assert its response. Both runs use a three-second deadline and scoped cleanup.

- escode's extracted protocol: request 33 returns error `-32001`, `Too many Codex requests are already active.` Assertion passed.
- Current T3 protocol, under the same installed Effect 4.1.0: request 33 returns `{ decision: "accept" }`. Assertion passed.

This establishes the bounded transport failure and upstream behavior, not its frequency with real Codex builds. The upstream regression above provides the durable test recipe; the experiment scripts were disposable files outside the repository. Prioritize a focused review/backport with that regression before a broad lifecycle rewrite. Include numeric versus string request IDs and interrupted-handler cleanup; do not update the complete vendor package as an incidental part of that fix. [ID distinction regression][tresolvedtest]

Current T3 also adds bounded stderr diagnostics and warnings for undecodable notifications since the extraction pin. Review these on their own merits: escode composes the raw protocol and currently drains native stderr, so changes in T3's typed client are not automatically integrated. T3's dependency catalog remains Effect 4.0.5 while escode declares 4.1.0. The isolated transport test passing under 4.1.0 does not qualify the whole upstream package, process adapters or packaged Electron integration. [Current stdio][tstderr], [typed client warnings][twarnings], [escode integration][etools], [T3 dependency catalog][tversions], [escode dependencies][eversions]

T3's session manager also bounds scope closure and releases sessions concurrently during shutdown. Adopt the ownership pattern with a shutdown deadline and visible failures, rather than assuming scoped finalization always completes. escode's existing descendant-cleanup tests remain mandatory. [Bounded close][tclose], [session scopes and shutdown][tscopes], [escode cleanup tests][eshutdowntests]

## Ordered recommendation

0. Review/backport the reproduced resolved-request cleanup fix with its upstream regression, independently of the architectural migration.
1. Simplify client internal query/subscription Effects; retain the public Promise surface and present reconnect semantics.
2. Establish Effect host service contracts and host-owned admitted-operation lifetimes; prove disconnect survival before migrating command handlers.
3. Move the existing Codex protocol/session orchestration under that host ownership; preserve explicit restart, epochs and process-group completion.
4. Address synchronous native IO separately if measured responsiveness warrants it; preserve descriptor authority throughout.
5. Convert observation and storage queues only as their owning services need it. Keep current durable formats and publication guarantees.

Each slice should run its narrow gates above and typecheck; provider/native changes additionally need the relevant packaged smoke workflow. The two bounded protocol experiments above were run; application test suites, live provider turns, benchmarks and packaged checks were not run. Only this report is committed and pushed on the separate research branch; application files, main, issues and PRs remain unchanged. Recommendations beyond the reproduced protocol failure require the listed migration gates.

[manifest]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/vendor/extraction.json#L1-L88
[readme]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/README.md#L29-L37
[eclient]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/packages/client-runtime/index.ts#L154-L197
[econnect]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/packages/client-runtime/index.ts#L7-L66
[ehost]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/packages/host/index.ts#L58-L252
[esend]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/send.ts#L1-L17
[eclienttests]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/host-client.test.ts#L24-L169
[ereconnect]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/reconnect.test.ts#L19-L99
[esendtests]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/send.test.ts#L8-L85
[echatopen]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/chat-service.ts#L323-L380
[eobserve]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/packages/host/observation.ts#L1-L22
[eobservetests]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/git-observation.test.ts#L4-L41
[eatomic]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/atomic-write.ts#L1-L22
[echatstore]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/chat.ts#L73-L97
[eworkspace]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/workspace.ts#L239-L251
[ejournal]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/file-operation-journal.ts#L81-L89
[espool]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/live-spool.ts#L12-L79
[ejournaltests]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/file-operation-journal.test.ts#L18-L78
[espooltests]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/live-spool.test.ts#L7-L27
[eworkspacetests]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/workspace.test.ts#L24-L230
[echatformat]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/chat.test.ts#L451-L488
[etools]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/tools.ts#L100-L230
[ewriter]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/chat-service.ts#L182-L200
[eshutdown]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/chat-service.ts#L837-L860
[eshutdowntests]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/shutdown.test.ts#L8-L152
[etooltests]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/tools.test.ts#L65-L140
[eio]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/project.ts#L360-L386
[eidentity]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/project.ts#L251-L263
[eprojecttests]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/project.test.ts#L23-L254
[enativetests]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/native-races.test.ts#L119-L240
[tscheduler]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/client-runtime/src/state/runtime.ts#L145-L310
[oldruntime]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/packages/client-runtime/src/state/runtime.ts#L145-L179
[oldrpc]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/packages/client-runtime/src/rpc/client.ts#L131-L153
[oldstdio]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/packages/effect-codex-app-server/src/_internal/stdio.ts#L13-L22
[provider]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/provider-core/src/server/ProviderAdapter.ts#L657-L672
[trpc]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/client-runtime/src/rpc/client.ts#L131-L209
[tsession]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/client-runtime/src/rpc/session.ts#L43-L74
[truntime]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/client-runtime/src/state/runtime.ts#L312-L344
[tsessiontests]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/client-runtime/src/rpc/session.test.ts#L278-L374
[trpctests]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/client-runtime/src/rpc/client.test.ts#L83-L158
[tgit]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/git/GitManager.ts#L119-L163
[tcache]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/git/GitManager.ts#L1094-L1139
[tcoalescer]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/orchestration-v2/ThreadLiveEventCoalescer.ts#L80-L117
[tcoalescerend]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/orchestration-v2/ThreadLiveEventCoalescer.ts#L207-L242
[treceipts]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/persistence/OrchestrationCommandReceipts.ts#L16-L51
[tevents]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/persistence/OrchestrationEventStore.ts#L129-L163
[tsqlite]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/persistence/Sqlite.ts#L14-L35
[tmanaged]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/provider-core/src/server/managedProvider.ts#L60-L130
[tprocess]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/processRunner.ts#L225-L263
[tspawn]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/processRunner.ts#L293-L313
[tvcs]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/vcs/VcsProcess.ts#L28-L68
[eatomictests]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/atomic-write.test.ts#L1-L33

[tresolved]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/effect-codex-app-server/src/protocol.ts#L177-L184
[tresolvedtest]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/effect-codex-app-server/src/protocol.test.ts#L421-L488
[tstderr]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/effect-codex-app-server/src/_internal/stdio.ts#L55-L121
[twarnings]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/effect-codex-app-server/src/client.ts#L155-L201
[tversions]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/pnpm-workspace.yaml#L47-L70
[tclose]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/orchestration-v2/ProviderSessionManager.ts#L969-L1003
[tscopes]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/apps/server/src/orchestration-v2/ProviderSessionManager.ts#L2091-L2117
[tresolvednotification]: https://github.com/pingdotgg/t3code/blob/b65f8686b3c7e16573f99d41a9539ff365cf1e89/packages/effect-codex-app-server/src/protocol.ts#L347-L374
[epending]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/vendor/codex/src/protocol.ts#L305-L350
[ereply]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/tools.ts#L187-L197
[eresolved]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/host/chat-service.ts#L524-L536
[eversions]: https://github.com/ejjsharpe/escode/blob/c1dc27fe322b6564ec54868ab3e6fd3a2241df46/apps/desktop/package.json#L26-L29
