# escode

A project editor with files, source changes, and Codex conversations.

The Agents and No project concepts below describe the [agreed Agents specification amendment](https://github.com/ejjsharpe/escode/issues/24#issuecomment-6501288419); project-backed chats, editor closure, saved Current checkout drafts and No project execution are implemented; project drafts also support deferred managed-worktree preparation and explicit discovered-checkout reuse.

Integrated behavior and acceptance boundaries are recorded in [Agents acceptance evidence](docs/compatibility/agents-acceptance.md). The Agents workflow is accepted, including user-confirmed manual VoiceOver validation on 2026-10-29 at `0347eaf4abe355a598752dff63bb72320e425570`; this is separate from the earlier v1 confirmation.

## Language

The host, connection and lifecycle terms below reflect the [agreed lifecycle planning amendment](https://github.com/ejjsharpe/escode/issues/53) and [agreed device trust rules](https://github.com/ejjsharpe/escode/issues/59#issuecomment-6521010880); the macOS window close/reopen portion is implemented; remaining lifecycle and trust changes are subsequent work. The [multi-client planning decision](https://github.com/ejjsharpe/escode/issues/57) additionally distinguishes per-client unsent text and recovery drafts; it is not yet implemented.

**Execution host**:
The escode runtime on one machine that owns its projects, files, saved chats and agent execution. Its work can continue without an open client connection or view.

**Provider session**:
A live connection between an execution host and a provider for a chat, distinct from the saved conversation. Replacing this session does not restore its old live requests or start another turn automatically.

**Client connection**:
An authenticated link through which a client controls an execution host and receives updates. Losing the link does not by itself stop host-owned work.

**Paired device**:
A device trusted with owner-equivalent control of a particular execution host, including managing its paired devices and requesting confirmed host shutdown.

**Device revocation**:
Withdrawal of a device's trust on an execution host, invalidating its connections and derived sessions and requesting Stop for its still-running work. It does not undo completed effects or guarantee termination of external side effects.

**Host identity**:
The verified identity to which clients and chats bind an execution host, independent of its display name or project paths. Recovery or replacement requires explicit verification and rebinding rather than silently redirecting existing chats or uncertain work. The fresh foundation store now persists the local host and desktop-client identities before desktop startup; authenticated local directory queries now bind this identity through validated bootstrap and exact wire revision. Other domains remain subsequent work.

**View subscription**:
A client's interest in updates for a displayed chat, directory or other surface. Ending it releases that interest without ending the underlying chat or host.

**Desktop window**:
An escode desktop interface containing Agents and project tabs. Closing the last window on macOS leaves the app and its bundled local execution host running, retaining unsaved edits for reopening. The local desktop retains the hidden window, renderer models and connection; Dock activation shows and focuses that same client.

**Quit**:
The explicit action that exits the desktop app and stops its bundled local execution host, with confirmation identifying active local work and Save/Discard/Cancel for unsaved edits. Discards wait for all file choices; cancelling a later choice retains earlier proposed discards. See [deliberate Quit evidence](docs/compatibility/quit.md).

**Stop**:
The action that interrupts the selected chat's active work on its execution host. It does not shut down the host.

**Host shutdown**:
The explicit action that stops an execution host and its active work. A remote client requires host-management permission and confirmation showing affected work to request it.

**Project**:
A saved local Git repository whose files, source changes, and project-backed chats belong together across branch switches. Linked worktrees of the same repository share one project identity.

**Checkout**:
A working directory of a project's repository, such as its original working copy or a linked worktree. Checkouts share a Project identity while retaining separate working files.

**Open checkout**:
A checkout with a project tab open in the current desktop window.

**File lookup**:
The keyboard-operated Cmd+P / Find file popup searches eligible filenames and paths within the active checkout tab, or exactly the open checkout tabs from Agents, through the authenticated execution host. Recursive discovery is independent of loaded Files rows and their visibility toggle. Matching uses the pinned VS Code scorer with highlights and explicit partial coverage. Deliberate exact paths retain their separate exclusion exception inside the approved scope; activation opens the exact file kept open through the shared opener and remembers its checkout as deliberate editor use.

Persisted **recent files** contain bounded exact checkout/file metadata, scoped independently of approval and distinct from session-local Reopen Closed history. Blank lookup shows scoped recents; typed lookup combines separately filtered recents with ranked discovery. An open popup uses coalesced host invalidation after file and local/nested ignore-policy changes, including repository-local excludes shared by linked worktrees. Observation failure remains disclosed; Refresh or reopening reinstalls observation and rescans. See the [navigation specification](docs/specifications/checkout-tabs-file-lookup.md), [recent-file evidence](docs/compatibility/recent-files.md) and [recursive lookup evidence](docs/compatibility/recursive-file-lookup.md) for contracts, budgets and qualification limits.

**Draft execution context**:
Agents New chat opens focused composition using the most recently used editor project's remembered checkout, the saved original checkout when no editor checkout has been used, or No project when no project is saved. Checkout-local creation captures that exact checkout. Before first Send, compact project and checkout controls allow explicit changes while preserving text; later navigation never retargets a draft. Unavailable identities stay selected. First Send alone binds execution and prepares resources; bound context is read-only, with paths and management details on demand.

**Project tab**:
An editor view of one checkout of a project, with its own icon-labelled Files, Diff and checkout-scoped Chats switches at the top of the sidebar. Diff uses the existing Source Control comparison authority and shared working-file buffer. The always-visible sidebar supports pointer and keyboard resizing (190–380 pixels), with one width remembered across restarts in the client’s workspace recovery state. Different checkouts of the same project can have separate tabs; reopening an open checkout focuses its existing tab. Open membership and selected workspace restore independently per client. Host-owned approval retains the checkout directory identity; a missing or replaced directory keeps its exact unavailable tab and recovery edits until explicitly retried or closed.

**File tab**:
The editor header for one file inside a checkout editor. Its normal editor and comparisons share that tab and the client's working-file buffer. The accepted specification requires tabs, order, active file, selected view and editor positions to be remembered independently per checkout. The [file-tab specification](docs/specifications/file-editor-tabs.md) was accepted by the user on 2026-10-31. The initial visible ordered set, exact file reuse and active identity are implemented in the file-tab foundation slice. Normal, Git comparison and save-conflict views now share one tab and working buffer, with remembered view-specific cursor/scroll positions independent of the sidebar. Single and captured-batch file closes now share Save/Discard/Cancel, defer discards and tab removal until persistence succeeds, and select the MRU survivor. Contextual Cmd+W leaves an empty checkout open. Files and Source Control share one replaceable preview per checkout; deliberate opening, editing and Keep Open retain that same tab. Restoration retains exact unavailable file tabs and drafts with Retry controls; host-owned checkout approvals retain directory identity across restart. Working text and loaded baselines remain in the existing recovery path. Drag ordering, active-tab reveal, disambiguated labels and keyboard tab-strip controls are implemented. Ctrl+Tab selects from a checkout-local recent-tabs picker without changing the editor or recency until Control release; Escape cancels. Cmd+Option+Left/Right follows visual order independently of recency. These shortcuts respect visible Files/Source Control, dialogs and input scope; Reopen Closed restores successful explicit close actions in the current client/checkout session. Fixed top-level checkout tabs and lookup belong to the [accepted checkout/search handoff](docs/specifications/checkout-tabs-file-lookup.md), whose map is complete.

**Reopen Closed**:
Cmd+Shift+T restores one successful explicit single or bulk file-close action, including order, selected views and editor positions. Each checkout retains at most 20 complete actions in client memory; the oldest action is evicted as a whole. Reopening uses current sources and reuses open buffers, without recovering discarded text or undoing filesystem operations. Preview replacement and project closure add no actions; restart starts fresh history while restoring open tabs normally. Known successful rename/move outcomes update open and recently closed descendant references in place; known successful Trash removes affected references and empty close actions. Failed or uncertain operations retain available references and work under the existing journal authority.

**Preview tab**:
A file tab eligible for replacement by another successfully opened preview in the same checkout workspace. At most one exists in that workspace. Editing, double-clicking, Keep Open, explicit keyboard opening or reordering it makes it kept open.

**Kept-open tab**:
A file tab retained when another preview opens. New files and recovered unsaved buffers are kept open. Save does not make the tab replaceable. This is distinct from VS Code's separate sticky Pin Editor feature, deferred from the planned iteration.

**Agents**:
The permanent app-wide view of chats and chat drafts across all saved projects, including projects with closed editor tabs, and No project contexts.

**Chats view**:
The view inside a project tab showing only chats and chat drafts attached to that tab's checkout. It opens the same conversations and drafts as Agents.

**Chat**:
A saved Codex conversation, including the user's messages and the agent's work and responses, with an optional project association. Its project association and working directory are fixed by first Send; its history is shared across clients, while unsent message text is shared across views within its owning client. Host-persisted directory identity prevents a replaced checkout from becoming the conversation’s execution context after restart. An unavailable path retains the chat and draft; Retry validates the original path without replay, while active Stop remains available.

**Chat summary**:
The host's metadata and activity projection for one saved chat or chat draft, shared by Agents and project Chats. It excludes unsent message text, transcript bodies and live request payloads. Summary delivery does not subscribe to background conversation details. See [host summary evidence](docs/compatibility/chat-summaries.md).

**Last user message**:
Chat-list recency uses the latest user-role message update, then user-message creation, then chat update/creation. Descending chat identity breaks ties. Relative row times use that same event; assistant output, completion, opening and sent-chat title changes do not promote a chat.

**History page**:
A bounded portion of a saved chat's provider history, loaded explicitly through the execution host. Message bodies and pages carry content revisions; choosing another page replaces the displayed portion. Unloaded or unavailable portions are disclosed. See [saved history evidence](docs/compatibility/saved-history.md).

The following historical-work terms describe the [accepted turn-level time-travel specification](docs/specifications/durable-state-and-time-travel.md). Implemented slices and remaining qualification gates are recorded in [combined historical qualification](docs/compatibility/historical-acceptance.md).

**Turn checkpoint**:
A recorded boundary before or after an agent turn, identifying its historical conversation context and the availability of captured saved working files. It is distinct from a user's Git commit and from a client's unsaved recovery draft. A before-message boundary captures saved disk contents afresh before Send dispatch, with its provider thread, exact checkout identity and Git base retained independently of file coverage; missing coverage does not authorize historical file operations. An after-turn boundary reserves a stable identity before dispatch and records the corresponding observed provider turn and completion status. Completed-turn files are captured before another Send is allowed; interruption, unobserved completion and failed capture retain unavailable coverage without replay or later-file substitution.

**Conversation rewind**:
An explicit return of an existing chat to an earlier conversation boundary, with a separate choice about restoring files. Looking through history does not rewind the conversation. Conversation-only rewind retains the escode chat identity and current files, index, unsaved edits and unsent text; native provider historical context may have a distinct provider thread identity. Confirmation does not start a turn. Unsupported boundaries remain unavailable.

**File restoration**:
An explicit replacement of an eligible worktree's saved working files with the contents of a selected turn checkpoint. Available unsaved client edits and loaded conflict baselines are retained separately; a later Save may conflict with restored disk contents. In-place restoration requires an exact, isolated worktree and refuses original or shared checkouts. It replaces saved edits and may remove newer eligible untracked files, while retaining the current staging index. Provider and filesystem effects can partially succeed; uncertain commands never replay.

**Historical branch**:
A separate chat and managed worktree continuing from a selected before-message or after-turn checkpoint while preserving the original work. It uses the recorded Git base with captured saved files as uncommitted changes and native provider context through the preceding turn (before-message) or selected completed turn (after-turn), without starting a turn. A retained branch receipt names the child chat and preserves its required checkpoint contents independently of source-chat expiry. Incomplete historical preparation retains its exact resources and blocks connection/Send until externally reconciled; Retry never allocates substitutes. Its historical files and conversation context are distinct from a conversation fork that shares today's files.

**Checkpoint retention**:
The period for which inactive chats retain available file checkpoints, subject to protection of data still needed by retained branches. The host-owned inactivity setting defaults to 30 days and accepts 1–36500 whole days or Never. Changes settle elapsed coverage under the previous policy before applying the new policy to remaining eligible checkpoints; extending retention or choosing Never cannot recover expired contents. Shorter periods apply at the next cleanup. Never disables inactivity expiry, not capacity limits. Deliberate opening, messages and observed agent work extend remaining coverage; polling does not. Expiry retains boundary/provider metadata with an unavailable reason and cannot be reversed by opening the chat. Branch receipts keep independent required contents; active work, client recovery and uncertain evidence prevent cleanup. Logical expiry does not promise immediate disk reclamation or remove conversations/worktrees. Retaining conversation history does not imply that every historical file state remains available.

**Project-backed chat**:
A chat associated with one project and attached to one of its checkout directories. Multiple chats may share a checkout.

**No project chat**:
A chat with no user-project association, attached to its own persistent scratch folder. It appears in Agents without a project tab.

**Chat draft**:
A locally saved, unsent conversation whose context can change before first Send. Its metadata belongs to the host; unsent composer text belongs to its client and follows the stable chat ID across context changes. Authenticated context edits and first Send share host serialization and revision checks. New chat inside a checkout tab captures that exact checkout independently of later navigation or project defaults. Explicit changes to another checkout or a future managed worktree continue in Agents with the same chat and client text, leaving the original tab fixed. Project drafts retain a resolved Current checkout path, explicitly selected discovered checkout, or displayed local base for a new managed worktree until explicitly changed. First Send prepares and binds the conversation while preserving its identity and creation time. Prepared worktrees retain their reserved branch, absolute path and directory identity, including on partial failure. Managed worktree allocation occurs only on a saved draft’s first Send. Stopping preparation retains its reserved branch/path and prompt; Retry never allocates a replacement. Failed or uncertain sends retain the prompt and known provider identity; Retry reconnects without resending or replacing reserved resources.

**Send receipt**:
A host-persisted record binding one Send command ID to its authenticated host/client,
chat/context expectation and message. It records admission, dispatch intent and known
or uncertain acceptance. Repeating that identity returns status without another
provider turn. Explicit local resolution releases a pending composer identity without
deleting the receipt or resending work. See [durable Send evidence](docs/compatibility/durable-send.md).

**File command receipt**:
A host-owned SQLite record binding a creation or transfer command identity to its client, exact checkout and requested targets. Admission precedes effects; repeating an identity returns its retained outcome or uncertainty without repeating effects. Per-item file-operation intent and batch facts preserve exact resolved destinations and copied recovery text until client acknowledgement.

**Unsent message text**:
A client’s unfinished message for a chat or chat draft, shared across that client’s views and retained independently of other clients’ composers. Sending from another client does not clear it.

**Scratch folder**:
A persistent working folder owned by one No project chat. It is allocated only on first Send, starts without Git and is retained independently of the chat's running state. Host ownership and directory identity are persisted; missing, replaced or incompletely recorded folders are never reconstructed or rebound.

**Original checkout**:
The checkout through which a project was first opened. It supplies the default when no other checkout has been used.

**Current checkout**:
A project's last-used editor checkout, defaulting to its original checkout until another is used. After selecting a project in Agents, it supplies the displayed, editable checkout default for a new draft even when its tab is closed.

**Managed worktree**:
A separate working copy created by escode for a project. It starts from a displayed committed local base on a unique `escode/<short-id>` branch,
in a repository-specific directory under escode's user data outside the source checkout.
It can host multiple chats and remains available after those chats finish. Reusing an
existing Git-discovered worktree is an explicit choice; creation never falls back to reuse.
Explicit removal retains its branch, commits and chat associations. Linked chats become
unavailable and are never rebound or used to reconstruct the checkout. Removal requires
confirmed app ownership and successful checks for active work, drafts and local files.

**Diff view**:
A comparison with a read-only old side and an editable new side sharing the Files buffer. Staged comparisons use HEAD as the baseline and show the working copy on the new side. Saving writes the working file without changing the Git index. Unavailable working files retain a read-only comparison.

**Save conflict**:
A difference detected before saving between a file's loaded disk version and its current disk version. The user's edits remain available while they compare, explicitly overwrite, reload from disk, or cancel.

**Recovery draft**:
A persisted unsaved file buffer belonging to one client, with its checkout/file identity and loaded disk
baseline. Another client’s Save or Discard does not remove it. Available drafts reopen as unsaved edits and use the ordinary save-conflict
check. Recovery uses host-owned SQLite records keyed by client identity and authenticated host actions; [SQLite recovery evidence](docs/compatibility/sqlite-file-recovery.md) records the bounded checks. Ordinary saves retain journalled disk outcomes and protect the completed baseline against late recovery snapshots until matching reconciliation. Explicit discard removes the draft; recovery is best effort, not a guarantee
that the latest keystroke survives a crash.

**Files view**:
The project-local lazy tree of files in the current checkout. Its asynchronous model retains
complete sorted directory listings independently of the viewport rows. Filenames use fixed-height,
single-line labels with ellipsis; hover and accessibility retain the full name. Inline fields and
diagnostics can use additional height. Expansion, keyboard
focus, multiple selection and scroll are remembered independently per checkout; selection
is separate from the active document. Coalesced host notifications reconcile loaded directories;
window focus and explicit Refresh rescan missed events and retry unavailable watches. Expanding
a resolved cached folder reuses its listing until invalidation; failed reads retain the last
successful contents with an error. Ready contents appear immediately; only loading feedback
is delayed. External disappearance retains available unsaved buffers
and recovery drafts at their original paths. Notifications defer listing changes during inline
editing until commit or cancel. The tree
supports empty file/folder creation and basename-only inline Rename through the narrow
rename/move and macOS Trash preservation gate. Rename/move retains available unsaved
descendant edits and save-conflict baselines at their new paths. Earlier text undo
history resets with disclosure; subsequent text undo works. Batch Trash confirms the
actual paths and affected dirty descendants, prunes selected descendants of selected
folders, and removes available buffers/drafts only for successful native Trash items.
Failed items retain their available work and report individual outcomes. Reveal Active File
expands its ancestors and scrolls to the entry without moving keyboard focus. Manual collapse
survives refresh and restart until the active file changes or explicit reveal. Git-ignored
entries start visible; Hide Git-ignored files is remembered per checkout. Hidden files retain
open edits, and explicit reveal offers Show ignored files. Git filter failure shows all entries
with an unavailable explanation. Copy Path, Copy Relative Path and Reveal in Finder target the
context entry, or the checkout root for empty space.

**File-operation intent**:
A durable record of an originating checkout and source/destination object identities,
retained across a rename/move, copy, Trash or Save-before-Trash filesystem/persistence handoff.
The dedicated file-operation journal stores and validates these records; workspace storage owns
client recovery drafts and view memory separately. Copy intents additionally retain staging paths and available destination draft text.
Completed saves carry their disk baseline independently of deletion outcomes, preserving
available draft text. Authenticated direct rename/move requests and acknowledgements share the host socket;
uncertain intents reject client acknowledgement. Completed move and Trash facts protect each saved client’s workspace snapshots until its renderer
reconciles, persists and acknowledges its own obligation. Moves retain each client’s independent
text and loaded baseline; another client’s Trash retains its drafts at the missing original path.
Workspace load delivers outstanding acknowledgement roots so recovered editors can release their
handoff before another mutation. Restart reconciles available drafts with actual
paths and saved baselines; uncertain outcomes retain work and block mutations.

**Files clipboard reference**:
A host-captured selection of checkout-relative entries and native source identities,
bound to one checkout and a random system-clipboard token. Paste revalidates the captured
identities; clipboard payloads alone grant no path authority. Successful cut moves leave
the reference selection; failed items remain retryable. Duplicate and same-folder Copy
choose a free sibling name. Copies retain source edits and carry available unsaved text
to destination drafts over copied disk baselines. Clean-file Replace explicitly moves
the former destination to macOS Trash; folder/type collisions never merge trees.
Copy intents retain staging paths and available draft text through uncertain handoffs.

**Native import reference**:
A short-lived, single-use host capture of files supplied by the operating system through
Finder drop or file paste. It authorizes disk-byte copies of those sources only into an
approved checkout. Source descriptors and ancestor identities are revalidated and released
after the operation; parent directories receive no continuing approval. Imports retain
originals and never carry source editor drafts. Collision and result handling follow Files
clipboard transfers.

Integrated Files acceptance and its user-owned manual follow-up are recorded in
[Files acceptance evidence](docs/compatibility/files-acceptance.md); the implemented
Files terminology above does not certify those unverified native and VoiceOver checks.


Internal host naming: `Checkout` owns one opened checkout and its filesystem descriptor. Its `CheckoutRepository` owns Git repository identity and worktree policy through that checkout; a repository identity can span multiple checkouts. These implementation names do not change the product terms above.

Internal transport naming: `startHost` starts the shared local host transport; `createHostClient` connects to it across chat, workspace, Files and Source Control. These names describe the execution host and client connection above; the `/directories` wire endpoint remains unchanged.

**Emergency Stop**:
An explicit cancellation request for the exact live turn or preparation captured by an
ordinary Stop whose intent could not be persisted. The host rechecks authority and
rejects a superseded target. Its result may be non-durable or uncertain; external
effects may remain. Reservations and prior command evidence are retained. This
exception never admits Send, approval or reply without a durable intent. After
complete storage-worker loss, the running host may retain previously validated
chat authority for cancellation of its existing live session only; authentication
and exact captured-target checks still apply. Cancellation results and rejection
reasons remain visible alongside context/storage errors. Host restart discards this authority.

Desktop chat composers, composer revisions and retained Send/control identities are
client-owned records in host SQLite, hydrated before chat actions and included in
recovery copies. The local client cache does not replace that authoritative copy.
The chat-client record has a 4 MiB bound; persistence failure blocks Send/replies,
while Stop retains its explicit emergency path. This does not add a transcript archive.

### Recovery copy

An explicit escode-owned consistent SQLite export with a checksummed inventory and
declared external spool/content coverage. Missing required content makes coverage
incomplete. Recovery validates a separate copy and quarantines it until exact
roots, file baselines, provider identities and uncertain operations are reconciled;
it does not undo external effects, replay commands or resume live requests.

Recovery copies retain checkpoint contents, historical branch snapshots and command receipts within the consistent SQLite cut. Their inventory distinguishes expired coverage from retained snapshots. Exact checkout identities and Git bases remain required external dependencies, checked without substitution. Recovery compares retained availability with the preserved original SQLite authority so an older copy cannot revive subsequently expired points; unavailable original authority retains quarantine. Unresolved receipts and missing required content retain quarantine; admission epoch rotation is not reconciliation. The administrative provider inspector reads exact saved thread and checkout identities without resuming work.

- **Boundary inspection**: Read-only, bounded browsing of provider-owned conversation history through a recorded before-message or after-turn boundary. It leaves the live conversation, composer and files unchanged. Provider history availability is independent of saved-file coverage; retained files cannot establish complete conversation history.

Historical branches can select an available completion boundary: native provider context
includes the completed turn, paired with that boundary's Git base and saved files.
The next message's fresh before-state is a separate target.

**Summarized continuation**:
An explicit historical-workflow choice that creates a separate chat draft and managed worktree from an eligible checkpoint. Available provider text through the selected boundary is copied with item labels into an unsent draft for review (64 KiB maximum); it is not native historical provider context and does not reconstruct tool state. Missing, unsupported, empty or oversized required history remains unavailable. Preparation starts no provider thread or turn; first Send explicitly creates a fresh conversation. Source work and client drafts remain intact.

Checkpoint storage capacity is independent of inactivity retention: active chats and
Never retain protected history until optional capture reaches its byte or work bound,
then disclose missing file coverage. Logical expiry drops eligible file payloads;
SQLite reuses free pages and may truncate an unblocked WAL without shrinking the
main database. These checkpoints store file bytes in SQLite, create no Git snapshot
objects, and grant no authority to prune project Git objects or retained worktrees.

- **Archived chat**: A shared conversation hidden from recent lists by host-owned metadata. Archive requires idle work without unresolved requests or uncertain operations; Restore retains its identity, draft, resources and recency.

**Chat title**:
Shared host-owned conversation metadata displayed in Agents and checkout-local Chats.
First Send starts one independent ephemeral title request, with bounded first-message
text as its fallback. Rename accepts a single line up to 256 characters. Regenerate
uses the retained first message; results match the current persisted request identity
so Rename or a newer request supersedes delayed output. Titles never alter transcripts
or sent-chat recency.
**Next-message model and effort**:
A chat's explicit Codex model and supported reasoning effort, stored in host SQLite.
Each model remembers its selected effort within the chat. Send captures these choices
before preparation; editing them during preparation or execution affects only a later
explicit Send. Catalog changes require an explicit supported selection, never substitution.

**Next-message permissions**:
A per-chat explicit Codex approval and sandbox choice captured before Send preparation.
Supervised uses read-only access and user-reviewed on-request approvals; Auto-accept
edits permits workspace and temporary-directory writes with network disabled and
user-reviewed approval for broader access; Full access disables the sandbox and
command approval. Custom or managed restrictions require resolution in Codex
configuration before presets can replace them. Editing a choice never sends work.
