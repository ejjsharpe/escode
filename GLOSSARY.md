# escode

A project editor with files, source changes, and Codex conversations.

## Language

**Project**:
A local Git repository whose files, source changes, and saved chats belong together across branch switches. Linked worktrees of the same repository share one project tab.

**Chat**:
A saved Codex conversation belonging to one project and attached to one checkout directory, including the user's messages and the agent's work and responses. Its checkout is chosen when the chat is created and stays fixed for that chat. Multiple chats may share a checkout. Codex stores conversation history; escode stores the project, checkout and provider-thread association and the unsent message draft. Stopping a chat interrupts its active turn without undoing completed file changes.

**Original checkout**:
The checkout through which a project was opened, shown by Files and Source Control before a chat is selected.

**Managed worktree**:
A separate working copy created by escode for a project. It starts from a displayed committed local base on a unique `escode/<short-id>` branch,
in a repository-specific directory under escode's user data outside the source checkout.
It can host multiple chats and remains available after those chats finish. Reusing an
existing Git-discovered worktree is an explicit choice; creation never falls back to reuse.

**Save conflict**:
A difference detected before saving between a file's loaded disk version and its current disk version. The user's edits remain available while they compare, explicitly overwrite, reload from disk, or cancel.

**Recovery draft**:
A locally persisted unsaved file buffer with its checkout/file identity and loaded disk
baseline. Available drafts reopen as unsaved edits and use the ordinary save-conflict
check. Explicit discard removes the draft; recovery is best effort, not a guarantee
that the latest keystroke survives a crash.
