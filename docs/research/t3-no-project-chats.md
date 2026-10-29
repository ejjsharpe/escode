# T3 Code: No project chats

Research date: 2026-10-29. T3 snapshot: [`37fbefd147197fab9d88f9c120560c3f21b52cfc`](https://github.com/pingdotgg/t3code/commit/37fbefd147197fab9d88f9c120560c3f21b52cfc), the same snapshot as the [earlier Agents research](https://github.com/ejjsharpe/escode/blob/f33e3d0a9989c437de49116ac0ddbf5e87b41071/docs/research/t3-agents-view.md). escode baseline: [`5c00a67b336d765037556f97de51ba054734ca81`](https://github.com/ejjsharpe/escode/commit/5c00a67b336d765037556f97de51ba054734ca81). Evidence for [Trace T3 Code No project chat behaviour](https://github.com/ejjsharpe/escode/issues/25), supporting [Define shared Agents and project-chat behaviour](https://github.com/ejjsharpe/escode/issues/22). This report records source behaviour, not new escode policy.

## What No project means in T3

**A sent No project chat has its own persistent, initially non-Git directory.** T3 internally attaches these chats to one ordinary saved project record named **No project**, rooted at `<T3 data directory>/scratch`. Each new sent chat receives a different child directory; it does not execute in that shared root, the selected repository, or an arbitrary process cwd. The thread stores the child path in its generically named `worktreePath` field, although it is not a Git worktree. The user documentation confirms separate folders and retention after thread deletion. [folders] [allocation] [user-guide]

The default is `~/.t3/scratch/YYYY-MM-DD-<first-message-words>-<short-id>`; `--base-dir` / `T3CODE_HOME` can change the data root. Naming uses up to five ASCII word groups, capped at 48 characters, and normally the final eight alphanumeric thread-id characters. Atomic non-recursive mkdir claims a fresh directory; collisions use longer/random suffixes. Directory separation does **not** establish a filesystem sandbox or prevent an agent reaching other paths. [base-dir] [base-config] [folder-name] [folder-claim] [allocation] [codex-turn]

## Entry paths: zero, one and multiple projects

- **Zero saved records:** the sidebar New thread button is disabled (`projects.length === 0`). Once environments finish loading, the home page shows **Start without a project** when scratch is available. The command palette also exposes **New thread without a project** independently of project count; its ordinary **New thread in...** submenu is added only when a saved project exists. Thus No project works before adding any repository, but the ordinary sidebar button itself is not the zero-project entry point. [new-button] [empty-state] [palette-actions]
- **One logical project group:** ordinary New thread starts a local draft using active server-thread project, then active draft project, then the default saved project (persisted project order). It does not invariably open a picker. After scratch registration, No project itself participates in project grouping; these counts are not just counts of Git repositories. [new-click] [context] [default-project] [groups]
- **Multiple groups:** in the default sidebar, ordinary New thread opens the **New thread in...** picker. Shift-click uses current context; the alternate `boringSidebarEnabled` mode always takes that contextual route. The picker excludes the internal scratch project from normal project choices and inserts an explicit **No project** action. [new-click] [new-click-rule] [picker]

The No project option requires a connected environment advertising `scratchWorkspaceRoot`. The hook prefers the primary/local environment, then the contextual fallback, then a sole other eligible environment. The server withholds scratch when its data directory is inside a Git checkout or the repository probe fails; missing Git is explicitly allowed. This is availability gating, not a requirement to select a Git checkout. Draft headings also offer switching between a project and No project before Send; text-bearing drafts retain their content while their context changes. [availability] [scratch-hook] [probe] [draft-switch]

## Picker → draft → first Send

1. `CommandPalette.tsx`'s exact No project action calls `startScratchThread(environmentId)`. That calls `projectEnvironment.openScratch`, which requests `projects.ensureScratch`, waits until the saved project is visible in client state, then calls the normal `handleNewThread(projectRef)`. Server `ensureScratchProject` creates/recreates the **shared scratch root** and finds or creates the persistent No project record, deduplicated by workspace root. These resources can therefore exist **before Send**, even if the user abandons the draft. [picker] [scratch-hook] [open-scratch] [scratch-rpc] [folders]
2. `useHandleNewThread` allocates local draft/thread identities and creation time, stores draft settings/context and navigates to `/draft/$draftId`; it can reuse an empty draft. It does not create a server conversation or start a provider turn. Composer drafts are persisted in localStorage with a 300 ms deferred write and unload flush; the serializer retains current project drafts, content-bearing/promoting sessions and drafts with open previews. No per-chat scratch directory is allocated here. [new-draft] [draft-reuse] [draft-storage] [draft-retention]
3. First Send supplies `bootstrap.createThread` to `startThreadTurn`. The client translates this into the server thread-launch RPC with an initial message. Non-Git sends resolve to local mode; the server additionally normalizes a scratch worktree request to root mode. For a new scratch launch it allocates the unique child folder **before** dispatching `thread.create`, binds that path, records the initial message/run, then prepares/releases the run. It calls no Git init or Git worktree creation on this path. “Start on Send” is accurate for the conversation/turn and per-chat folder, not for every shared resource. [send] [client-launch] [send-mode] [launch-normalize] [launch-bind] [launch-message]

Later messages use the same saved thread/path. Accepted launch receipts recover the bound directory on retry. Folder allocation and thread creation are not one filesystem/database transaction: a failure after mkdir can leave a folder, and the inspected scratch path has no rollback deletion guarantee. [client-launch] [launch-bind] [launch-retry] [allocation]

## Execution, persistence and lifecycle

**Codex context.** Runtime policy resolves cwd as `thread.worktreePath`, falling back to the owning project root only when that field is null. Hence a normal sent scratch chat uses its allocated child directory. The Codex adapter passes cwd on thread start/resume and turn start. Provider instance settings independently select the Codex binary/home and launch arguments; direct homes or auth-overlay homes are supported. T3 also supplies model, runtime-mode approval/sandbox settings and T3 context/MCP overrides. No project is not a clean Codex configuration profile, and does not select another repository's config merely because its tab is active. Exact effective config, trust, skills and instruction discovery remain dependent on the chosen Codex version/home, launch overrides and files in the scratch directory/ancestry; this source inspection does not establish their values on a user's machine. [runtime-cwd] [codex-thread] [codex-native] [codex-turn] [codex-process] [codex-home]

**Persistence and restart.** Saved server threads, project association and path are durable projections in SQLite (normally `<data>/userdata/statev2.sqlite`); local drafts have the separate persistence described above. Neither directory allocation nor the saved thread association is temporary-by-design. Do not copy a universal “restart means stopped” claim from T3: it has conditional restart continuation and a `continueThreadsAfterServerUpdate` setting defaulting to true. escode's agreed stopped-after-quit restoration is a deliberate retained contract. [projection] [database] [database-path] [restart] [restart-default]

**Missing directory.** Ensuring scratch can recreate the shared root, and a new chat can claim a fresh child. This does not restore an existing chat's deleted child directory/files. Provider-session opening checks that cwd exists and is a directory and otherwise asks the user to restore that exact path. The missing Git-worktree recreation path requires a non-null branch; ordinary scratch chats have none. The inspected code does not silently rebind these chats to another directory. Deleting a directory while tools are already running remains an external filesystem race, not a recovery guarantee. [folders] [allocation] [missing-cwd] [missing-error] [git-recreate]

**Close, quit and delete are distinct.** No project uses the normal server-owned thread/provider lifecycle; leaving a view is not `thread.delete`. On macOS closing all desktop windows does not itself quit T3; actual desktop quit stops its pooled backends, and server session shutdown releases provider runtimes. Other connected environment servers have separate lifetimes. Explicit thread deletion marks a durable deletion, cancels active runs/requests and detaches sessions, then cleans scheduled tasks, terminals, previews and attachments. It does **not** remove the scratch folder: the client excludes scratch from the delete-worktree offer, and storage worktree cleanup requires a branch/managed linked worktree. No scratch-folder expiry/garbage-collection policy was found in these inspected paths. This confirms retention, not a backup or restore guarantee. [desktop-close] [desktop-quit] [session-shutdown] [delete-state] [delete-resources] [delete-ui] [cleanup] [user-guide]

**Display and optional conversion.** The project/header label is **No project**; rows retain normal chat titles, seeded/generated by the ordinary first-message flow. Multi-environment rows can add a machine label. T3's optional **Turn into project** requires a sent scratch thread with its own folder and no unfinished work in the affected threads. It registers that folder in place as a project, moves scratch threads sharing it (including archived ones), and moves their scheduled tasks. Thread ids/history stay; adoption clears `worktreePath` because the new project root is the same cwd. It neither moves files nor initializes Git; Git initialization is a separate action. This is not evidence for attaching a sent chat to an unrelated existing repository. [display] [row-title] [machine-label] [client-launch] [promotion] [adopt] [user-guide]

## Consequences for escode, without changing its integration scope

These are compatibility findings/inferences, not an implementation plan:

- The baseline host requires an **open Git project** for every chat call and validates Git-discovered checkout membership at creation. `SavedChat.project` is mandatory; even listing and request replies pass that open-project guard. Supporting optional ownership and closed-project global access needs a deliberate host contract amendment. A fake Git project or arbitrary renderer-provided cwd would not satisfy the current guarantees. Preserve sender/chat identity validation and project-backed Git checks while specifying host-owned No project directory identity separately. [es-host] [es-project] [es-store]
- Today escode saves a chat on Create and opens its installed Codex connection independently of Send. Matching the adopted draft flow requires distinguishing unsent draft persistence from saved conversation/provider startup and delaying execution resources until Send. Preserve one chat identity/draft/session across global/project views, with a fixed execution directory after creation. [es-store] [es-open] [es-view]
- Keep installed/authenticated Codex, one app-server process per connected chat, Codex-owned history with fresh resume/paginated reload, effective settings returned by Codex, request tokens scoped to the originating connection/turn, explicit Stop, and Retry without resend. Scratch cwd does not justify importing T3's provider registry, managed homes, approval defaults, history projections, restart continuation or orchestration. App quit must still shut down **all** escode-owned sessions, including ownerless chats; project-tab closure must obey the already-agreed continue-globally amendment. [es-tools] [es-open] [es-request] [es-send-stop] [es-shutdown]

## Decisions to return to the parent

The source settles per-chat versus shared cwd, no-Git operation, resource timing, display, and T3's retention/missing-path behaviour. The parent should explicitly record which reference details are adopted: escode's managed scratch location/naming and file retention; the ordinary New button behaviour at zero/one/multiple saved targets (literal T3 differs from an always-open picker); and the unavailable-directory/retry presentation. No new sandbox or config-isolation policy follows from choosing a scratch directory.

Conversion into a project, Git initialization, automatic cleanup, directory relocation/reconstruction, remote environments and restart continuation are optional T3 capabilities, not prerequisites for No project chat. Include any of them only through a separate explicit scope decision. Existing user decisions about flat creation-desc order, independent selections, project context, continuing work after project-tab closure and stopped-after-quit restoration remain authoritative.

Verification: inspected pinned upstream source and tests read-only, plus escode's pinned baseline. No application was run, dependencies installed, issues changed, glossary edited or implementation written. Missing-directory checks prove the session-open path; they do not prove every possible live-process filesystem race or exact user Codex configuration.

[user-guide]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/docs/user/thread-sidebar.md#L22-L44
[base-dir]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/os-jank.ts#L123-L129
[base-config]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/cli/config.ts#L318-L330
[folder-name]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/project/ManagedProjectFolders.ts#L113-L121
[probe]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/project/ManagedProjectFolders.ts#L198-L246
[folders]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/project/ManagedProjectFolders.ts#L248-L315
[folder-claim]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/project/ManagedProjectFolders.ts#L213-L231
[allocation]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/project/ManagedProjectFolders.ts#L317-L342
[new-button]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/Sidebar.tsx#L3069-L3074
[new-click]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/Sidebar.tsx#L2870-L2886
[new-click-rule]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/Sidebar.logic.ts#L731-L736
[empty-state]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/NoProjectsHero.tsx#L14-L55
[palette-actions]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/CommandPalette.tsx#L1153-L1204
[picker]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/CommandPalette.tsx#L761-L802
[context]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/lib/chatThreadActions.ts#L70-L95
[default-project]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/hooks/useHandleNewThread.ts#L426-L459
[groups]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/hooks/useSidebarProjectGroups.ts#L12-L41
[availability]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/client-runtime/src/operations/projects.ts#L30-L44
[scratch-hook]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/hooks/useScratchProject.ts#L43-L89
[open-scratch]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/client-runtime/src/state/projectCommands.ts#L170-L197
[scratch-rpc]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/ws.ts#L2707-L2712
[draft-switch]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/chat/DraftHeroHeadline.tsx#L185-L250
[new-draft]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/hooks/useHandleNewThread.ts#L365-L421
[draft-reuse]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/hooks/useHandleNewThread.ts#L218-L242
[draft-storage]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/composerDraftStore.ts#L108-L150
[draft-retention]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/composerDraftStore.ts#L1997-L2012
[send]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/chat/useComposerSend.ts#L1243-L1303
[client-launch]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/client-runtime/src/operations/commands.ts#L653-L738
[send-mode]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/shared/src/projectSettings.ts#L196-L201
[launch-normalize]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/ThreadLaunchService.ts#L810-L818
[launch-bind]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/ThreadLaunchService.ts#L839-L928
[launch-message]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/ThreadLaunchService.ts#L947-L974
[launch-retry]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/ThreadLaunchService.ts#L1006-L1047
[runtime-cwd]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/RuntimePolicy.ts#L84-L114
[codex-thread]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L1321-L1349
[codex-native]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L6770-L6819
[codex-turn]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L724-L790
[codex-process]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L1492-L1507
[codex-home]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/provider/Drivers/CodexHomeLayout.ts#L43-L71
[projection]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/ProjectionStore.ts#L1860-L1898
[database]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/persistence/Sqlite.ts#L44-L74
[database-path]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/config.ts#L138-L149
[restart]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/RestartContinuation.ts#L182-L211
[restart-default]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/contracts/src/settings.ts#L1167-L1170
[missing-cwd]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/ProviderSessionManager.ts#L2028-L2045
[missing-error]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/provider/Errors.ts#L17-L26
[git-recreate]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/ProviderTurnStartService.ts#L575-L616
[desktop-close]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/desktop/src/app/DesktopLifecycle.ts#L275-L294
[desktop-quit]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/desktop/src/app/DesktopApp.ts#L334-L353
[session-shutdown]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/ProviderSessionManager.ts#L1993-L2025
[delete-state]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/ThreadDeletion.ts#L56-L127
[delete-resources]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/ThreadDeletion.ts#L185-L238
[delete-ui]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/hooks/useThreadActions.ts#L479-L547
[cleanup]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/storageCleanup.ts#L782-L807
[display]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/chat/ChatHeader.tsx#L75-L85
[row-title]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/sidebar/SidebarThreadRow.tsx#L1035-L1044
[machine-label]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/web/src/components/Sidebar.tsx#L1120-L1132
[promotion]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/project/ScratchThreadPromotion.ts#L57-L155
[adopt]: https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/orchestration-v2/Orchestrator.ts#L4026-L4051
[es-host]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/main.ts#L263-L311
[es-project]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/project.ts#L40-L59
[es-store]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/chat.ts#L4-L79
[es-view]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/src/chat.tsx#L133-L220
[es-tools]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/tools.ts#L95-L120
[es-open]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/chat-service.ts#L81-L176
[es-request]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/chat-service.ts#L317-L368
[es-send-stop]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/chat-service.ts#L281-L315
[es-shutdown]: https://github.com/ejjsharpe/escode/blob/5c00a67b336d765037556f97de51ba054734ca81/apps/desktop/host/chat-service.ts#L391-L419
