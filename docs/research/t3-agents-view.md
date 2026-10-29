# T3 Code reference for an escode Agents view

Research date: 2026-10-29. Upstream snapshot: [`37fbefd147197fab9d88f9c120560c3f21b52cfc`](https://github.com/pingdotgg/t3code/commit/37fbefd147197fab9d88f9c120560c3f21b52cfc), fetched from `pingdotgg/t3code` default branch `main` (release preparation for v0.1.5). This replaces the earlier research snapshot `e34067edef2eba03c1e40bca7d2b2d933ae12b85` for the claims below. escode baseline: [`5c00a67b336d765037556f97de51ba054734ca81`](https://github.com/ejjsharpe/escode/commit/5c00a67b336d765037556f97de51ba054734ca81).

This is preliminary evidence for the requested permanent leftmost **Agents** top tab, left chat sidebar, and selected conversation in the middle panel. There is no open `wayfinder:map`; [Define the smallest useful escode](https://github.com/ejjsharpe/escode/issues/1) is closed and deferred a global agents overview. No new destination, decision ticket, tracker mutation, application change, or glossary change is made here. “Agents” denotes the requested view label; **Project** and **Chat** retain their [existing meanings][es-glossary]. Whether Chats leaves project tabs remains undecided.

## Evidence-based recommendation

If this destination is approved, build the shell/navigation change around escode's existing saved chats, Electron bridge, and host-owned Codex sessions. Use T3's navigation and attention patterns as references. Its current sidebar, composer, and runtime are tightly connected to infrastructure escode does not need. Both retaining project Chats and moving conversation access into Agents can use the same underlying chat identities and host operations; the evidence does not choose between them. [es-chat] [es-service] [t3-sidebar] [t3-send]

## Exact upstream paths and state relationships

All T3 paths below are relative to the pinned repository; links include useful line ranges.

1. **Layout and selected conversation.** `apps/web/src/components/AppSidebarLayout.tsx` owns the left resizable Threads sidebar and renders its content alongside the main children. `components/Sidebar.tsx` derives the active row from route identity and navigates to `/$environmentId/$threadId`. `routes/_chat.tsx` owns `ThreadRouteView`, which renders the selected `ChatView`. Server identity is `(environmentId, threadId)`; a draft instead uses `/draft/$draftId`. The unkeyed server view is deliberately reused between conversations, and draft promotion preserves its instance. `threadSelectionStore.ts` is separate transient **bulk row selection**, not the active conversation. These are useful layout/identity references, not an escode top-tab implementation. [t3-layout] [t3-navigation] [t3-chat-route] [t3-route-view] [t3-selection]

2. **Project-grouped list.** `hooks/useSidebarProjectGroups.ts` reads projects, quiet thread shells, project order, grouping settings, and environment labels. `sidebarProjectGrouping.ts` builds logical groups with their physical member project references. `components/Sidebar.logic.ts::groupSidebarThreadsByProject` assigns threads by environment/project identity. `components/Sidebar.tsx::useSidebarThreads` partitions the list and optionally places **active** threads in project folders. A collapsed folder keeps the selected conversation visible and summarizes its other hidden threads. `components/sidebar/SidebarProjectFolderHeader.tsx` renders the disclosure, count/status, and project-specific new-thread action. [t3-groups-hook] [t3-groups] [t3-group-function] [t3-folders] [t3-folder-header]

   **Current-version distinction:** grouping is the optional beta setting `boringSidebarEnabled` (also enabled by the legacy preference), whose schema default is false. Pinned threads stay above folders; Snoozed and Settled remain below. The default list should not be described as universally project-grouped. escode need not inherit these shelves or cross-machine logical grouping. [t3-labs] [t3-settings] [t3-folders]

3. **New thread and project choice.** A folder's new-thread action supplies that group's representative project. The global button either uses contextual project selection or opens the `new-thread-in` command palette, depending on sidebar mode, modifier, and project count. `lib/chatThreadActions.ts` resolves context from the active server thread, then active draft, then default project. `components/CommandPalette.tsx` offers project choices and preserves a contextual physical project within a logical group. [t3-new-button] [t3-folder-action] [t3-new-context] [t3-project-picker]

   `hooks/useHandleNewThread.ts::createNewThreadHandler` prepares a **local draft session** with project, proposed thread ID, branch/worktree mode, and settings. It can reuse an empty project draft and checks for navigation/race changes before late work takes focus. `components/chat/useComposerSend.ts` supplies `bootstrap.createThread` and, when required, `prepareWorktree` to `startThreadTurn` on submission. Thus “New thread” and “start agent work” are distinct stages. T3's worktree submission can also request setup; that behavior is not escode's existing contract. [t3-new-handler] [t3-send]

4. **Navigation, persistence, and live state.** `appInit.tsx` selects TanStack hash history for Electron and browser history for web. `uiStateStore.ts` persists folder expansion, project order, project filters, visit watermarks, and other UI preferences in localStorage; it does not define the selected conversation. `composerDraftStore.ts` separately persists draft text/context/settings through Zustand storage, with a 300 ms deferred write and unload flush. Reaching the index route starts a draft in the most recently updated project once available; do not infer a last-selected-chat restoration policy from the sidebar preference store. [t3-history] [t3-ui-state] [t3-draft-storage] [t3-index]

   Data flow is **server shell snapshot/stream → environment-scoped client atoms → project groups/thread rows**; selected thread detail has its own snapshot/stream. `packages/client-runtime/src/state/shell.ts` uses `subscribeShell` plus an HTTP snapshot/cache; `state/threads.ts` uses `subscribeThread` plus thread snapshot/history loading. `state/models.ts::presentThreadShell` derives display summaries, including pending approval/input flags. Server `orchestration-v2/ProjectionStore.ts` uses SQLite-backed projections; this is considerably more than an interchangeable React store. [t3-shell] [t3-detail] [t3-models] [t3-projection]

5. **Background activity and attention.** `components/Sidebar.logic.ts::resolveSidebarThreadStatus` gives approval and user input precedence over working/waiting/ready states. `resolveSidebarFolderDot` aggregates hidden-thread attention before failure, unseen completion, and working; `hasUnseenCompletion` compares completion time with a visit watermark. `components/sidebar/SidebarThreadRow.tsx` renders those states; `ThreadStatusIndicators.tsx` also mixes in PR, terminal, and environment status. `state/threads.ts::createRunningThreadKeepAliveAtom` keeps running detail subscriptions mounted beyond foreground navigation. Status is derived from runtime state, independently of which conversation is selected. [t3-status] [t3-row-status] [t3-extra-status] [t3-keepalive]

6. **Composer and message display.** `components/ChatView.tsx` coordinates the selected thread, quiet projections, drafts, history, and command hooks. `components/chat/ThreadTimeline.tsx` subscribes to live turn items so text deltas update the timeline without rerendering the whole coordinator. `MessagesTimeline.tsx` uses LegendList with history and per-thread scroll handling; `TimelineAssistantRows.tsx` delegates prose to `ChatMarkdown.tsx`. `ChatComposer.tsx` and `ComposerPromptEditorTiptap.tsx` provide a Tiptap/ProseMirror composer with context tokens and attachments. `useComposerSend.ts` couples submission to provider/model settings, approvals, draft promotion, worktrees, and orchestration commands. Their input is T3's projected runs/messages/items, not escode's `ChatSnapshot`. [t3-chat-view] [t3-timeline] [t3-messages] [t3-assistant] [t3-composer] [t3-editor] [t3-send]

## Narrow comparison with escode

- **`apps/desktop/src/main.tsx`:** `App` selects a project tab; each `ProjectView` remembers Files/Source Control/Chats and checkout. Project and checkout views remain mounted but hidden, preserving buffers. Chat selection changes the owning project's checkout through `onCheckout`; background activity bubbles to project tabs. A separate Agents shell selection must coexist with these identities and close/recovery behavior. Do not put a synthetic Agents path into the project list. [es-main]
- **`apps/desktop/src/chat.tsx`:** `ChatView` currently combines chat list, selection, snapshot polling, draft handling, requests, transcript, and composer. It portals its list into a project sidebar and remembers one selected chat per project. Its 300 ms polling reads snapshots for all chats in that mounted project, and prioritizes requests over busy state for indicators. Reusing it twice would create independent selections/draft caches and duplicate polling. A shared controller with list/conversation presentations is a plausible small extraction if both access paths are retained; moving the presentation alone must not change session ownership. [es-chat]
- **`apps/desktop/src/workspace.ts` and host workspace contract:** renderer memory persists via `lifecycle("persist")`; `WorkspaceState` contains projects, selected project, keyed view memory, and recovery drafts. `views[project].chat` stores project chat selection. There is no dedicated Agents selection or global conversation field; the host validator accepts only the existing three project modes. A new shell/Agents restoration policy needs explicit persisted fields and backward-compatible loading, rather than overloading project mode or replacing Monaco buffer identity. [es-memory] [es-workspace]
- **Existing host bridge:** `ChatBridge` provides project-scoped `list/create/open/snapshot/send/draft/stop/disconnect/answer`. `SavedChat` already owns stable `id`, `project`, fixed `checkout`, provider `threadId`, draft, and removal state. `ChatSnapshot` supplies connected/busy/turn/items/requests/error/settings. Electron validates sender, open-project ownership, chat membership, and checkout repository identity. A list spanning **open projects** can compose existing calls; a catalogue of saved chats from **closed projects** needs an explicit host capability or project-opening behavior. No global list endpoint exists in this bridge. [es-chat] [es-saved] [es-service] [es-ipc]
- **Runtime and lifecycle:** `ChatService` owns per-chat connections and scopes events by session epoch/thread; request tokens target the originating live request. Codex owns saved history, which escode reloads through its existing resume/history path. Retain that ownership, Stop/retry behavior, shared-checkout warnings, removed-checkout handling, worktree choices, and close/quit guards. Navigating Agents must not call disconnect or shutdown. [es-service] [es-answers] [es-worktrees] [es-lifecycle]

## Reuse boundary and notices

**Practical references:** project headers with contextual creation; active chat identity separate from bulk selection; stable identity for drafts/actions; attention before running; a hidden group's aggregate indicator; protecting selection from late async completion; separate sidebar summaries and live transcript updates. escode already implements several of these. Its summary can initially derive Needs input/Running from `requests`/`busy`; T3-style unread/completion states require metadata escode's current saved-chat/snapshot contracts do not expose. [t3-status] [t3-new-handler] [es-chat] [es-saved] [es-service]

**Realistic code reuse:** small algorithms such as `groupSidebarThreadsByProject` or status precedence can be adapted to escode's project/chat types. The containing `Sidebar.logic.ts` is not dependency-free. Importing whole `Sidebar`, `ChatView`, composer, or client-runtime modules would pull in environment identity, Effect atoms/RPC, T3 contracts and server projections, Zustand, routing, Tailwind/UI primitives, and feature-specific services. Composer/message reuse adds rich editor, attachment, and timeline contracts. Shared React/Base UI alone does not remove those costs. Prefer escode components and existing StyleX/Base UI for the approved shell change; no new backend, provider abstraction, or dependency is justified by this layout request. This is an engineering inference from the source imports and package manifests, not a measured extraction estimate. [t3-sidebar] [t3-chat-view] [t3-composer] [t3-dependencies] [es-dependencies]

Upstream's [MIT license][t3-license] names Copyright (c) 2026 T3 Tools Inc., permits reuse/modification/distribution, and requires its copyright and permission notice in copies or substantial portions. If adapting upstream code, retain the complete license notice in the redistributed notices and record the source commit/files. A source link alone is not the stated notice. Dependencies/assets can have their own terms: T3 maintains separate [third-party notices configuration][t3-notices]. Review the specific material actually copied; this report does not copy application code or assets. These are license-text observations, not legal advice.

## Product decisions still required

1. **Chats location:** retain project Chats as another entry into shared conversations, or move conversation access to Agents and leave Files/Source Control in project tabs. The first requires synchronized selection/drafts across entry points; the second needs migration of remembered Chats views. Neither is chosen here.
2. **List scope and grouping:** open projects only, or every saved project; project folders, flat list, or a project filter; treatment of empty, closed, unavailable, and removed-checkout entries.
3. **Relationship to project navigation:** whether selecting a global chat also changes the project's remembered checkout/chat; what opening its files/diffs does; whether returning to a project retains its prior file view.
4. **Creation context:** explicit project picker, contextual default, or per-project New chat actions; which checkout “current” means in Agents. Preserve the existing current/new/reuse choices unless the destination explicitly changes them.
5. **Restoration and attention:** Agents or prior project on launch; global versus per-project last chat; list titles/order/collapse memory; whether completion/unread indicators are wanted beyond existing Running/Needs input.

The parent should settle the destination and create/link any research decision. This branch is an evidence asset only: no PR and no merge.

## Verification and limits

Inspected a shallow, sparse upstream source checkout and the pinned escode files/contracts; checked the open-map query and closed original map read-only. No dependencies were installed and neither application was run. Findings establish source relationships, not runtime UX, accessibility, latency, extraction effort, or compatibility guarantees. Existing navigation/concurrency/lifecycle test sources provide future regression targets; they were not executed for this documentation-only research. [es-navigation-test] [es-concurrency-test] [es-lifecycle-test]

[t3-layout]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/AppSidebarLayout.tsx#L445-L478
[t3-sidebar]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/Sidebar.tsx
[t3-navigation]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/Sidebar.tsx#L1382-L1394
[t3-chat-route]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/routes/_chat.tsx#L19-L55
[t3-route-view]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/ThreadRouteView.tsx#L22-L160
[t3-selection]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/threadSelectionStore.ts#L1-L26
[t3-groups-hook]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/hooks/useSidebarProjectGroups.ts#L12-L43
[t3-groups]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/sidebarProjectGrouping.ts#L12-L29
[t3-group-function]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/Sidebar.logic.ts#L920-L950
[t3-folders]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/Sidebar.tsx#L421-L533
[t3-folder-header]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/sidebar/SidebarProjectFolderHeader.tsx#L35-L115
[t3-labs]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/settings/LabsSettingsPanel.tsx#L14-L49
[t3-settings]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/contracts/src/settings.ts#L476-L479
[t3-new-button]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/Sidebar.tsx#L2870-L2886
[t3-folder-action]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/Sidebar.tsx#L1205-L1208
[t3-new-context]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/lib/chatThreadActions.ts#L70-L95
[t3-project-picker]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/CommandPalette.tsx#L760-L809
[t3-new-handler]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/hooks/useHandleNewThread.ts#L79-L420
[t3-send]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/chat/useComposerSend.ts#L1243-L1303
[t3-history]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/appInit.tsx#L150-L159
[t3-ui-state]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/uiStateStore.ts#L213-L250
[t3-draft-storage]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/composerDraftStore.ts#L108-L150
[t3-index]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/routes/_chat.index.tsx#L40-L90
[t3-shell]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/client-runtime/src/state/shell.ts#L360-L410
[t3-detail]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/client-runtime/src/state/threads.ts#L935-L980
[t3-models]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/client-runtime/src/state/models.ts#L257-L330
[t3-projection]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/ProjectionStore.ts
[t3-status]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/Sidebar.logic.ts#L846-L899
[t3-row-status]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/sidebar/SidebarThreadRow.tsx#L708-L760
[t3-extra-status]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/ThreadStatusIndicators.tsx#L659-L790
[t3-keepalive]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/state/threads.ts#L89-L140
[t3-chat-view]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/ChatView.tsx#L444-L559
[t3-timeline]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/chat/ThreadTimeline.tsx#L14-L57
[t3-messages]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/chat/MessagesTimeline.tsx
[t3-assistant]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/chat/TimelineAssistantRows.tsx#L25-L55
[t3-composer]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/chat/ChatComposer.tsx
[t3-editor]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/ComposerPromptEditorTiptap.tsx#L1-L85
[t3-dependencies]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/package.json
[t3-license]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/LICENSE#L1-L21
[t3-notices]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/third-party-licenses.config.json
[es-glossary]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/GLOSSARY.md
[es-main]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/src/main.tsx#L447-L652
[es-chat]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/src/chat.tsx#L8-L403
[es-memory]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/src/workspace.ts#L1-L48
[es-workspace]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/workspace.ts#L5-L94
[es-saved]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/chat.ts#L4-L79
[es-service]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/chat-service.ts#L4-L201
[es-ipc]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/main.ts#L263-L312
[es-answers]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/chat-service.ts#L202-L369
[es-worktrees]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/src/worktrees.tsx#L34-L137
[es-lifecycle]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/main.ts#L70-L155
[es-dependencies]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/package.json
[es-navigation-test]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/tests/navigation.spec.ts
[es-concurrency-test]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/tests/concurrency.spec.ts
[es-lifecycle-test]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/tests/lifecycle.spec.ts
