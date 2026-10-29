# Agents layout interaction study — throwaway

Question: does the user's pinned Agents layout support the agreed shared chats, independent project context and draft lifecycle clearly?

Open `agents-view.prototype.html` directly in a browser. It is a single self-contained file with in-memory sample state. No install, backend, filesystem, Codex turn or real permission operation is involved. Buttons and the composer support free play; four walkthroughs expose the key transitions and a readable state summary shows the result.

`agents-view.reference.png` is the user's supplied **Aperture — Pinned Agents view.png**, visually inspected on 2026-10-29. The original incorrect code-editor attachment is not used. The reference's dark neutral surfaces, lavender selection, pinned leftmost tab and conversation/composer hierarchy are retained. The settled first-iteration scope takes precedence over the reference's project grouping, task-context pane, aggregate counters, progress bars, queues and extra Changes/Logs views.

The study uses the canonical escode terms Agents, Chats, New chat, Codex and No project. It does not rename the product to Aperture, add providers, or promise isolated worktrees for every chat.

Decision ticket: [Validate the Agents tab and chat layout](https://github.com/ejjsharpe/escode/issues/23). Shared behaviour: [Define shared Agents and project-chat behaviour](https://github.com/ejjsharpe/escode/issues/22#issuecomment-6499508429). This artifact is a review asset, not production code or proof of the real integration. It must not be merged into the application.

The user reviewed the inline interaction study and approved it: **“Yes — this is the v1 layout.”** The question is settled: the supplied visual style works with the agreed flat chat list, one conversation panel and shared chat behaviour. The separate demo controls/state summary are review scaffolding, not product UI.

Dirty-file prompts, filesystem races, process shutdown and actual request routing require the real acceptance checks in the subsequent implementation effort. Layout approval does not establish runtime correctness.
