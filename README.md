# escode

A personal project editor with Codex conversations, file editing, and Git diffs.

The first iteration has one tab per project. Inside a project, the sidebar switches between **Files**, **Source Control**, and **Chats**. Selecting an item opens its file, diff, or conversation in the main area.

The long-term aim is a daily editor that can replace VS Code. The current effort defines the smallest useful first version; implementation follows once its product and architecture decisions are settled.

## Planning

The canonical scope and decision map are [Define the smallest useful escode](https://github.com/ejjsharpe/escode/issues/1). Child issues hold individual decisions and their resolutions. Native issue dependencies show what can be worked on next.

The platform, editor, reuse boundary, and local-service architecture are recorded in [Choose the desktop foundation](https://github.com/ejjsharpe/escode/issues/4#issuecomment-6484074577). The decision map indexes supporting research and the remaining behaviour, interaction, and specification decisions.

See [GLOSSARY.md](GLOSSARY.md) for product terminology and [the tracker conventions](docs/agents/issue-tracker.md) for the planning workflow.

No application code or runnable build is included yet.
