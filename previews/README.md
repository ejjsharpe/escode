# Selected chat interface design

The user selected the **Repository** direction, amended to use one flat conversation list across projects. This is the visual reference for [Specification: composer-led chat interface with a flat Agents list](https://github.com/ejjsharpe/escode/issues/142).

Open `repository.html` directly in a browser. It is self-contained and requires no build, server, dependencies or provider connection.

## Agreed direction

- One flat conversation list; no project folders or grouping.
- A quiet dark workspace with no hero heading or large project-actions panel.
- New drafts centre execution context and the composer together.
- Execution context appears above the rounded composer.
- Compact model, reasoning and permission information sits toward the composer's lower right, followed by Send.
- Ongoing chats keep the composer below an independently scrolling transcript.
- Preserve Agents, fixed checkout tabs and the existing project-local view scopes.

## Prototype boundaries

The GitHub specification owns implementation scope and behaviour. This HTML is an interaction prototype, not production application code. Editable provider settings, descriptive titles and conversation search are simulated proposals and are excluded from the bounded interface amendment. Present truthful existing data and controls when implementing the spec.

Sample messages, model/permission choices, file edits and saves are held only in page memory and reset on reload. No agent runs and no real files change.

The preview's application design matches the selected local version; only its exploration-navigation links were replaced with a link to the specification so this published copy has no missing alternative files.

## Retrieve from another session

Fetch `origin/design/chat-interface`, then read this README and the HTML from that branch. The specification links a commit-pinned copy, so implementation can use the exact reviewed asset without switching its own working branch. This design branch is based on `main` and contains only the reference files; it is not the implementation branch.

## Verification

The selected preview was visually checked at desktop and narrower widths. Flat-list creation, search, selection, draft/settings retention, simulated Send, transcript scrolling and sample file editing/saving were exercised during design work. These are prototype checks, not Electron/provider or accessibility acceptance for an implemented redesign.
