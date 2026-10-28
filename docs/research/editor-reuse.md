# Monaco and T3 Code reuse for escode

Investigated 28 October 2026 for [Assess Monaco and T3 Code reuse](https://github.com/ejjsharpe/escode/issues/3).

Scope: project tabs with Files, Source Control, and Codex Chats. No global agents view, worktree management, integrated terminal, or Git mutation UI in v1.

Source snapshots: T3 Code `e34067edef2eba03c1e40bca7d2b2d933ae12b85`; Monaco `dbf1945df2ff7e46512d2f548cc5c0977a3eadd8`.

## Findings

### Monaco is a directly consumable editor library

The official package supplies an ESM editor with a documented public API in `monaco.d.ts`. Models hold content and edit history; the host app supplies file loading/saving and project navigation. Ordinary VS Code extensions do not run in Monaco. [Monaco README](https://github.com/microsoft/monaco-editor/blob/dbf1945df2ff7e46512d2f548cc5c0977a3eadd8/README.md)

Its public definitions include `editor.createDiffEditor`; the repository also contains a diff-editor example. Use the current ESM integration guidance rather than copying that legacy AMD sample. [Public API definitions](https://github.com/microsoft/monaco-editor/blob/gh-pages/node_modules/monaco-editor/monaco.d.ts), [diff-editor sample](https://github.com/microsoft/monaco-editor/blob/dbf1945df2ff7e46512d2f548cc5c0977a3eadd8/samples/legacy/browser-amd-diff-editor/index.html)

This makes Monaco a credible editor/diff dependency. It does not choose Git baselines, resolve external-file conflicts, persist user buffers, or supply a VS Code workbench. Those are escode requirements to settle, not reasons to fork VS Code.

### T3 Code's larger modules have application dependencies

T3 assigns provider processes, terminals, Git, and project files to its server. Shared connection/domain state lives in client-runtime, while orchestration persists events, projections, and effects. This is a substantial application architecture, not just a chat widget. [Architecture](https://github.com/pingdotgg/t3code/blob/e34067edef2eba03c1e40bca7d2b2d933ae12b85/docs/internals/overview.md)

| Candidate | Source evidence | Reuse boundary |
| --- | --- | --- |
| `@t3tools/provider-core` | Private workspace package depending on contracts, shared code, and Effect | Extraction carries workspace contracts and runtime choices. |
| `@t3tools/client-runtime` | Private package with provider, source-control, shared, Effect, and other dependencies | Broad application state; not established as a standalone chat SDK. |
| `effect-codex-app-server` | Private package with Effect as its runtime dependency | Narrower protocol-client candidate if Effect fits the chosen foundation. |

Sources: [provider-core manifest](https://github.com/pingdotgg/t3code/blob/e34067edef2eba03c1e40bca7d2b2d933ae12b85/packages/provider-core/package.json), [client-runtime manifest](https://github.com/pingdotgg/t3code/blob/e34067edef2eba03c1e40bca7d2b2d933ae12b85/packages/client-runtime/package.json), [protocol-client manifest](https://github.com/pingdotgg/t3code/blob/e34067edef2eba03c1e40bca7d2b2d933ae12b85/packages/effect-codex-app-server/package.json).

Source inspection confirms actual coupling: provider-core imports T3 contracts and Effect types; the narrower protocol client uses Effect process/stream primitives plus generated protocol/schema modules and local helpers. Copying its entry file alone would not reproduce the client. [Provider client source](https://github.com/pingdotgg/t3code/blob/e34067edef2eba03c1e40bca7d2b2d933ae12b85/packages/provider-core/src/client.ts), [Codex client source](https://github.com/pingdotgg/t3code/blob/e34067edef2eba03c1e40bca7d2b2d933ae12b85/packages/effect-codex-app-server/src/client.ts)

`private: true` describes package publishing; it does not prohibit copying. Both repositories use MIT licences requiring the stated notices with copied or substantial portions. Check the actual copied files and any additional dependencies when adopting code. [T3 licence](https://github.com/pingdotgg/t3code/blob/e34067edef2eba03c1e40bca7d2b2d933ae12b85/LICENSE), [Monaco licence](https://github.com/microsoft/monaco-editor/blob/dbf1945df2ff7e46512d2f548cc5c0977a3eadd8/LICENSE.txt)

## Recommendation for the foundation discussion

**Inference:** Monaco as a library, T3 Code as a workflow reference, and a direct Codex integration are a plausible small starting point. Adopting T3's backend would also bring concepts beyond this v1, so its lower implementation cost has not been demonstrated.

The narrower Effect client deserves comparison if the chosen foundation already uses Effect. Do not select a framework merely to make that extraction possible. Small, individually useful T3 helpers can be assessed when a concrete requirement reaches them; there is no need to pre-copy a provider framework.

This report informs [Choose the desktop foundation](https://github.com/ejjsharpe/escode/issues/4); it does not resolve that human decision. Navigation and file-state behaviour remain covered by the existing behaviour and prototype tickets. No new decision ticket is required from this investigation.

Method: official documentation, package manifests, licence files, and selected source imports inspected. No dependencies installed, app run, extraction attempted, or performance/compatibility measured. A supported standalone T3 embedding SDK was not established by this inspection.
