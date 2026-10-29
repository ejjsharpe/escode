# escode

A personal project editor with Codex conversations, file editing, and Git diffs.

The first iteration has one tab per project. Inside a project, the sidebar switches between **Files**, **Source Control**, and **Chats**. Selecting an item opens its file, diff, or conversation in the main area.

Projects can have multiple saved chats and multiple agents running concurrently. Starting agent work offers the current checkout or a new worktree. File editing uses explicit saving; switching views preserves unsaved edits.

The long-term aim is a daily editor that can replace VS Code. The current effort defines the smallest useful first version; implementation follows once its product and architecture decisions are settled.

## Planning

The canonical scope and decision map are [Define the smallest useful escode](https://github.com/ejjsharpe/escode/issues/1). Child issues hold individual decisions and their resolutions. Native issue dependencies show what can be worked on next.

The selected foundation is macOS, Electron, React, TypeScript, and Monaco, using installed Git and Codex directly. T3 Code remains a workflow reference.

The platform, editor, reuse boundary, and local-service architecture are recorded in [Choose the desktop foundation](https://github.com/ejjsharpe/escode/issues/4#issuecomment-6484074577). The decision map indexes supporting research and the remaining behaviour, interaction, and specification decisions.

See [GLOSSARY.md](GLOSSARY.md) for product terminology and [the tracker conventions](docs/agents/issue-tracker.md) for the planning workflow.

## Run the desktop slice

`bun install --frozen-lockfile`, then `bun run dev`.

The desktop app opens one local Git checkout, browses UTF-8 text files in Monaco,
saves explicitly with Cmd+S and displays read-only staged, unstaged and untracked
diffs. Dirty buffers remain in memory while navigating. External disk changes
prompt Compare, Overwrite, Reload or Cancel. Files/diffs are limited to 2 MiB;
binary files and symbolic links have unavailable states. Git status and selected
diffs refresh every two seconds.

Run `bun run typecheck`, `bun run lint`, `bun run test`, then `bun run build`,
`bun run package` and `bun run smoke` for Electron checks. See
[desktop evidence and limitations](docs/compatibility/desktop.md).

Chats, multiple projects, recovery and close/quit protection remain subsequent
slices. This is an implementation of the file/Git slice, not the completed v1.
