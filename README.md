# escode

A personal project editor with Codex conversations, file editing, and Git diffs.

The first iteration has one tab per project. Inside a project, the sidebar switches between **Files**, **Source Control**, and **Chats**. Selecting an item opens its file, diff, or conversation in the main area.

The long-term aim is a daily editor that can replace VS Code. The current effort defines the smallest useful first version; implementation follows once its product and architecture decisions are settled.

## Planning

The canonical scope and decision map live in [GitHub Issues](https://github.com/ejjsharpe/escode/issues?q=is%3Aissue%20label%3Awayfinder%3Amap). Child issues hold individual decisions and their resolutions. Native issue dependencies show what can be worked on next.

Monaco is a candidate for editing and diff views. T3 Code is a reference for the Codex workflow; its reuse boundary remains a research question. The application framework and first supported platform are not yet selected.

See [GLOSSARY.md](GLOSSARY.md) for product terminology and [the tracker conventions](docs/agents/issue-tracker.md) for the planning workflow.

No application code or runnable build is included yet.
