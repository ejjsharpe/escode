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

Install Apple's Command Line Tools (`xcode-select --install`) for the bundled
filesystem helper, then `bun install --frozen-lockfile` and `bun run dev`.

The desktop app opens one local Git checkout, browses UTF-8 text files in Monaco,
saves explicitly with Cmd+S and displays read-only staged, unstaged and untracked
diffs. Dirty buffers remain in memory while navigating. External disk changes
prompt Compare, Overwrite, Reload or Cancel. Files/diffs are limited to 2 MiB;
binary files and symbolic links have unavailable states. Git status and selected
diffs refresh every two seconds.

Saving follows VS Code's practical check-before-save guarantee, using content
hashes. An unrelated process can still change the file between the last check and
replacement; cross-process transactional saving is outside this guarantee.

Run `bun run typecheck`, `bun run lint`, `bun run test`, then `bun run build`,
`bun run package` and `bun run smoke` for Electron checks. See
[desktop evidence and limitations](docs/compatibility/desktop.md).

The Chats view creates saved chats on the current checkout using installed,
authenticated Codex **0.163.0 or newer** (tested baseline **0.165.0**). Each connected chat owns an app-server process.
It streams messages/activity, displays effective settings, handles live permission
and input requests, and supports Stop and fresh-connection history reload. Drafts
and project/chat/checkout/thread associations live in Electron user data; Codex
owns saved conversation history. Retry never resends a message.

Run `ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop smoke -- tests/chat.spec.ts`
for the opt-in live Codex workflow (consumes a turn); add
`ESCODE_PACKAGED_CHAT=1` to check the packaged app with a restricted PATH.

Projects now have independent tabs and remembered views. Reopening a repository
(including a linked worktree) focuses its existing tab. Files and Source Control
follow the selected chat checkout; buffers, selections and chat drafts retain
their identities while navigating. Background chat indicators show Running or
Needs input without changing focus. Replies and Stop target their originating
chat and connection. Chats on the same checkout show a shared-files notice.

`tests/navigation.spec.ts` checks repository identity and navigation;
`tests/concurrency.spec.ts` exercises independent protocol processes and scoped
requests in the UI. `ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop test --
host/chat.test.ts` additionally checks four real Codex chats across shared and
separate checkouts and projects (consumes turns).

Chat creation offers the current checkout, a new managed worktree or explicit reuse
of a Git-discovered project worktree. Creation shows a resolved local base commit,
uses committed files only and preserves original local/unsaved edits. Branches and
absolute paths can be copied; setup, commits and integration stay external.
Worktrees live under Electron user data, separated by repository identity. Failed
creation reports possible leftovers and retries always reserve a fresh destination.

Unsaved file buffers are persisted as local recovery drafts. Closing files, projects
or the app offers Save/Discard/Cancel; active work requires Stop and Close.
Quit interrupts active turns and terminates app-owned process groups. Restart
restores tabs, view selections and available drafts; agents do not resume turns.
Recovery is best effort: see [desktop evidence and limitations](docs/compatibility/desktop.md).
Managed worktrees offer explicit removal with a confirmation listing the path, retained
branch and affected chats. Active work, recovery drafts, local files (including ignored
files) and uncertain checks block removal. Git removal never uses force; branches and
chat associations remain. External worktrees are ineligible. Ownership records are
required, so worktrees created by older builds require external management.
Removal follows VS Code’s Git guarantee: an unrelated process can still create or
change files after the final check; late ignored files can be deleted. Transactional
removal and recoverable removal backups are outside this guarantee.
This is not the completed v1.
