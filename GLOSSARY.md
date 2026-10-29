# escode

A project editor with files, source changes, and Codex conversations.

The Agents and No project concepts below describe the [agreed Agents specification amendment](https://github.com/ejjsharpe/escode/issues/24#issuecomment-6501288419); existing project-backed chats and editor closure are implemented; draft creation and No project execution remain later slices.

## Language

**Project**:
A saved local Git repository whose files, source changes, and project-backed chats belong together across branch switches. Linked worktrees of the same repository share one project identity.

**Project tab**:
An open editor view of a project, containing Files, Source Control and Chats. Closing this view leaves the saved project and its chats available in Agents.

**Agents**:
The permanent app-wide view of chats and chat drafts across all saved projects, including projects with closed editor tabs, and No project contexts.

**Chats view**:
The view inside a project tab showing only that project's chats and chat drafts. It opens the same conversations and drafts as Agents.

**Chat**:
A saved Codex conversation, including the user's messages and the agent's work and responses, with an optional project association. Its project association and working directory are fixed by first Send; its history and unsent message are shared wherever it is opened.

**Project-backed chat**:
A chat associated with one project and attached to one of its checkout directories. Multiple chats may share a checkout.

**No project chat**:
A chat with no user-project association, attached to its own persistent scratch folder. It appears in Agents without a project tab.

**Chat draft**:
A locally saved, unsent conversation whose context can change before first Send. It keeps its identity, creation time and message when it becomes a chat.

**Scratch folder**:
A persistent working folder owned by one No project chat. It starts without Git and is retained independently of the chat's running state.

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

**Save conflict**:
A difference detected before saving between a file's loaded disk version and its current disk version. The user's edits remain available while they compare, explicitly overwrite, reload from disk, or cancel.

**Recovery draft**:
A locally persisted unsaved file buffer with its checkout/file identity and loaded disk
baseline. Available drafts reopen as unsaved edits and use the ordinary save-conflict
check. Explicit discard removes the draft; recovery is best effort, not a guarantee
that the latest keystroke survives a crash.

**Files view**:
The project-local view of files in the current checkout. Its existing directory list
supports a narrow rename/move and macOS Trash preservation gate; the nested explorer
specified in issue 38 remains subsequent work. Rename/move retains available unsaved
descendant edits and save-conflict baselines at their new paths. Earlier text undo
history resets with disclosure; subsequent text undo works.

**File-operation intent**:
A durable record of an originating checkout and source/destination object identities,
retained across a rename/move or Trash filesystem/persistence handoff. Restart reconciles
available drafts with actual paths; uncertain outcomes retain work and block mutations.
