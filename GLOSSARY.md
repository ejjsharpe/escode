# escode

A project editor with files, source changes, and Codex conversations.

The Agents and No project concepts below describe the [agreed Agents specification amendment](https://github.com/ejjsharpe/escode/issues/24#issuecomment-6501288419); project-backed chats, editor closure, saved Current checkout drafts and No project execution are implemented; project drafts also support deferred managed-worktree preparation and explicit discovered-checkout reuse.

Integrated behavior and acceptance boundaries are recorded in [Agents acceptance evidence](docs/compatibility/agents-acceptance.md). The Agents workflow is accepted, including user-confirmed manual VoiceOver validation on 2026-10-29 at `0347eaf4abe355a598752dff63bb72320e425570`; this is separate from the earlier v1 confirmation.

## Language

The host, connection and lifecycle terms below reflect the [agreed lifecycle planning amendment](https://github.com/ejjsharpe/escode/issues/53) and [agreed device trust rules](https://github.com/ejjsharpe/escode/issues/59#issuecomment-6521010880); these changes are not yet implemented. The [multi-client planning decision](https://github.com/ejjsharpe/escode/issues/57) additionally distinguishes per-client unsent text and recovery drafts; it is not yet implemented.

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
An escode desktop interface containing Agents and project tabs. Closing the last window on macOS leaves the app and its bundled local execution host running, retaining unsaved edits for reopening.

**Quit**:
The explicit action that exits the desktop app and stops its bundled local execution host, with confirmation before stopping active local work and Save/Discard/Cancel for unsaved edits.

**Stop**:
The action that interrupts the selected chat's active work on its execution host. It does not shut down the host.

**Host shutdown**:
The explicit action that stops an execution host and its active work. A remote client requires host-management permission and confirmation showing affected work to request it.

**Project**:
A saved local Git repository whose files, source changes, and project-backed chats belong together across branch switches. Linked worktrees of the same repository share one project identity.

**Project tab**:
An open editor view of a project, containing Files, Source Control and Chats. Closing this view leaves the saved project and its chats available in Agents.

**Agents**:
The permanent app-wide view of chats and chat drafts across all saved projects, including projects with closed editor tabs, and No project contexts.

**Chats view**:
The view inside a project tab showing only that project's chats and chat drafts. It opens the same conversations and drafts as Agents.

**Chat**:
A saved Codex conversation, including the user's messages and the agent's work and responses, with an optional project association. Its project association and working directory are fixed by first Send; its history is shared across clients, while unsent message text is shared across views within its owning client. Host-persisted directory identity prevents a replaced checkout from becoming the conversation’s execution context after restart. An unavailable path retains the chat and draft; Retry validates the original path without replay, while active Stop remains available.

**Chat summary**:
The host's metadata and activity projection for one saved chat or chat draft, shared by Agents and project Chats. It excludes unsent message text, transcript bodies and live request payloads. Summary delivery does not subscribe to background conversation details. See [host summary evidence](docs/compatibility/chat-summaries.md).

**History page**:
A bounded portion of a saved chat's provider history, loaded explicitly through the execution host. Message bodies and pages carry content revisions; choosing another page replaces the displayed portion. Unloaded or unavailable portions are disclosed. See [saved history evidence](docs/compatibility/saved-history.md).

**Project-backed chat**:
A chat associated with one project and attached to one of its checkout directories. Multiple chats may share a checkout.

**No project chat**:
A chat with no user-project association, attached to its own persistent scratch folder. It appears in Agents without a project tab.

**Chat draft**:
A locally saved, unsent conversation whose context can change before first Send. Project drafts retain a resolved Current checkout path, explicitly selected discovered checkout, or displayed local base for a new managed worktree until explicitly changed. First Send prepares and binds the conversation while preserving its identity and creation time. Prepared worktrees retain their reserved branch, absolute path and directory identity, including on partial failure. Failed or uncertain sends retain the prompt and known provider identity; Retry reconnects without resending or replacing reserved resources.

**Send receipt**:
A host-persisted record binding one Send command ID to its authenticated host/client,
chat/context expectation and message. It records admission, dispatch intent and known
or uncertain acceptance. Repeating that identity returns status without another
provider turn. Explicit local resolution releases a pending composer identity without
deleting the receipt or resending work. See [durable Send evidence](docs/compatibility/durable-send.md).

**Unsent message text**:
A client’s unfinished message for a chat or chat draft, shared across that client’s views and retained independently of other clients’ composers. Sending from another client does not clear it.

**Scratch folder**:
A persistent working folder owned by one No project chat. It is allocated only on first Send, starts without Git and is retained independently of the chat's running state. Host ownership and directory identity are persisted; missing, replaced or incompletely recorded folders are never reconstructed or rebound.

**Original checkout**:
The checkout through which a project was opened, shown by Files and Source Control before a chat is selected.

**Current checkout**:
A project's remembered Files/Source Control checkout, using its original checkout until a different editor checkout is selected. It supplies the Current checkout choice for project-backed chat drafts, including when the project's tab is closed.

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
check. Explicit discard removes the draft; recovery is best effort, not a guarantee
that the latest keystroke survives a crash.

**Files view**:
The project-local lazy nested tree of files in the current checkout. Expansion, keyboard
focus, multiple selection and scroll are remembered independently per checkout; selection
is separate from the active document. Coalesced host notifications reconcile loaded directories;
window focus and explicit Refresh rescan missed events and retry unavailable watches. Expanding
a cached folder revalidates its listing. External disappearance retains available unsaved buffers
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
Copy intents additionally retain staging paths and available destination draft text.
Completed saves carry their disk baseline independently of deletion outcomes, preserving
available draft text. Completed batch facts protect workspace snapshots until the renderer
reconciles and durably acknowledges them. Restart reconciles available drafts with actual
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
