# escode

A project editor with files, source changes, and Codex conversations.

## Language

**Project**:
A local Git repository whose files, changes, and chats belong together.

**Chat**:
A saved Codex conversation associated with one project and attached to one checkout, including the user's messages and the agent's work and responses. Multiple chats may share a checkout.

**Original checkout**:
The checkout through which a project was opened, shown by Files and Source Control before a chat is selected.

**Managed worktree**:
A separate working copy created by escode for a project. It can host multiple chats and remains available after those chats finish.
