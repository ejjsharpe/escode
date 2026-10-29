# escode

A project editor with files, source changes, and Codex conversations.

## Language

**Project**:
A local Git repository whose files, source changes, and saved chats belong together across branch switches.

**Chat**:
A saved Codex conversation belonging to one project and attached to one checkout directory, including the user's messages and the agent's work and responses. Its checkout is chosen when the chat is created and stays fixed for that chat. Multiple chats may share a checkout.

**Original checkout**:
The checkout through which a project was opened, shown by Files and Source Control before a chat is selected.

**Managed worktree**:
A separate working copy created by escode for a project. It can host multiple chats and remains available after those chats finish.
