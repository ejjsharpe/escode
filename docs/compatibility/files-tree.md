# Lazy Files tree (issue 40)

This bounded slice implements nested browsing in the existing Files sidebar and single main editor, retaining branch/checkout context and the accepted rename/Trash preservation boundary. It adds no filesystem mutation APIs or dependencies. Implementation is authorized by the assigned ticket and explicit user instruction after the completed specification maps.

Each directory is listed only when reachable and expanded. Collapsing retains its cache; Refresh clears caches and reloads root and visible expanded directories. Loading, empty and failed listings appear in context; errors explain Refresh recovery. Protected .git paths continue through the native listing boundary. The host also filters protected app-state entries and folders containing them, and rejects direct listing/read/save requests for protected state. Refresh reflects Finder Put Back and other external changes without replacing unsaved buffers. Automatic watchers remain issue 47.

Tree focus uses one tab stop and an active descendant, with treeitem/group levels, expanded and selected semantics. Selected background, focused outline, active-document underline and unsaved marker communicate separate states. Arrows, Shift-arrows, Home/End, type select, Cmd-click, Shift-click and Cmd+A navigate/select visible rows. Space opens while retaining tree focus; Cmd+Down opens/focuses Monaco. Navigation and multiple selection do not open another document. Shift+F10/context-menu key and right-click expose the existing single-entry Rename/move and Trash actions. Right-click inside selection retains it; other targets select without opening. Escape restores tree focus. Multiple-entry mutation gestures remain later slices; the menu explains choosing one entry.

Workspace memory stores expansion, focus, selection and scroll per checkout. Legacy directory and active-path ancestors migrate on host read without changing drafts or host-owned approvals. Move/Trash intent reconciliation maps or removes affected tree paths alongside existing buffer/draft paths. Refresh removes selection/expansion for paths proven missing by loaded listings and falls back to an available focus ancestor. Hidden checkout scroll events cannot overwrite saved navigation. Restoration waits for reachable expanded listings before applying scroll.

Verification uses temporary repositories and isolated Electron profiles, leaving the user's manual snapshot, port 5173 and Desktop test repository untouched. `tests/files-tree.spec.ts` checks keyboard browsing/open/editor focus, selection independent of the document, menu dismissal, visible refresh and dirty-buffer restart; it also checks actual native listing calls to establish lazy loading/cache reuse, error recovery and project/restart scroll. `host/workspace.test.ts` checks fresh-store migration, drafts/baselines, stored scroll and independent host approvals. Existing Files-operation, lifecycle, navigation, accessibility and Agents recovery journeys cover their shared integration.

Reproducible commands and final results are recorded below. Build artifacts and screenshots are local, ignored outputs. No application release or independent review approval is claimed.

Manual gap: the user has not yet tested this new tree with VoiceOver. First-slice VoiceOver and Finder Put Back path restoration were confirmed in dev snapshot `9342650`; contents were separately automated, not user-confirmed. Parent owns new tree manual verification after independent review. No live authenticated Codex turn is needed for this slice.

## Changed files

- `apps/desktop/src/files.tsx` (new), `apps/desktop/src/main.tsx`, `apps/desktop/src/style.css`.
- `apps/desktop/host/workspace.ts`, `apps/desktop/host/file-operation-state.ts`, `apps/desktop/host/main.ts`.
- `apps/desktop/host/workspace.test.ts`, `apps/desktop/host/file-operations.test.ts`.
- `apps/desktop/tests/files-tree.spec.ts` (new), `apps/desktop/tests/file-operations.spec.ts`, `apps/desktop/tests/navigation.spec.ts`, `apps/desktop/tests/accessibility.spec.ts`.
- Updated Files locators in `apps/desktop/tests/agents.spec.ts`, `apps/desktop/tests/availability.spec.ts`, `apps/desktop/tests/lifecycle.spec.ts`, `apps/desktop/tests/lifecycle-races.spec.ts`, `apps/desktop/tests/packaged.spec.ts`, `apps/desktop/tests/project.spec.ts`, `apps/desktop/tests/worktrees.spec.ts`.
- `README.md`, `GLOSSARY.md`, `docs/compatibility/file-operations.md`, `docs/compatibility/files-tree.md` (new).

## Final verification (2026-10-29)

On the existing macOS arm64/Electron 45.1.0/Monaco 0.57.0 setup:

```sh
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
bun run --cwd apps/desktop test
bun run --cwd apps/desktop build
bun run --cwd apps/desktop package
bun run --cwd apps/desktop smoke
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-tree.spec.ts tests/file-operations.spec.ts tests/agents-files-recovery.spec.ts
git diff --check
```

- Typecheck, lint, production build, unsigned macOS directory package and diff check passed.
- Full host suite: **83 passed, 2 opt-in live tests skipped** (9 files passed, 1 skipped). Fresh-store migration retains available drafts, baselines and host approvals; native move/restart tests now also assert mapped tree memory.
- Full combined Electron suite: **28 passed, 1 live-Codex test skipped**. Includes navigation between chat checkouts, Agents, approvals/unavailable checkout, concurrency, accessibility, lifecycle/races, native file operations, new tree journeys, development and packaged baseline journeys.
- Additional packaged tree, native operations and combined Agents recovery journeys: **6 passed** under the packaged restricted-PATH launch.
- The generated 100-file root fixture has 101 initial rows; native invocation assertions show exactly one root listing and no descendant listing before expansion, then one listing for the expanded folder. Collapse/reopen reuses its cache. Permission failures are injected at native invocation; missing-path failures use actual disk removal. Explicit Refresh recovers both. This bounded fixture is not a large-repository performance certification; no virtualization was introduced.
- Electron screenshots `apps/desktop/test-results/files-tree-nested.png` and `files-tree.png` were visually inspected for nested hierarchy, independent active/selected states and restored scroll. These are ignored local artifacts.

Early checks exposed and fixed disabled-menu focus, hidden-checkout scroll handling, stale click/toggle state and test locators still expecting the former directory buttons. The scroll journey also needed to await asynchronous project-open completion before returning to the original project. Final runs use the completed source and rebuilt package. Existing renderer chunk-size and development duplicate-createRoot warnings remain; the development style-update assertion passes. No live authenticated turn, new tree manual VoiceOver check or release signing was performed.

Ready for **fresh independent Ponytail review**. No independent approval is granted here. All changes remain unstaged and uncommitted on `t3/implement-issue-38` at `f08183dfac74e805cd51dca64e50dd2675f5a2e6`. No commit, stage, push, merge, PR, issue-state change or delegation was performed. The main checkout, separate Agents worktree and parent-owned manual snapshot were not modified. The parent's user app on port 5173 was left running; the development regression uses its own ephemeral port and isolated profile.

## Independent review follow-up: redundant guard and pending manual acceptance

The parent reports that the fresh independent Ponytail reviewer found no confirmed functional, data-loss or approval regression. The review independently passed 83 host tests with 2 opt-in skips, 22 Electron tests, typecheck, lint, build and diff checks, plus deep-scroll Refresh and menu-focus probes. These are reviewer-reported results, separate from the implementer runs above.

**Manual acceptance remains pending.** The review's required evidence finding is new-tree VoiceOver verification. The user previously checked the first-slice controls, not this tree. No new VoiceOver pass is claimed. The parent will launch an updated app in a separate snapshot, collect the user's tree verification and arrange a fresh independent code review. Automated accessibility and focus probes do not satisfy this manual acceptance requirement.

The optional cleanup is confirmed redundant and applied: `apps/desktop/host/main.ts` removes only the later six-line read/save app-state guard. The earlier trust-boundary guard already rejects protected state for read/save/diff before dispatch. The new directory-listing filter and protected-directory rejection remain unchanged. No tests, renderer code, schema or other application behavior changed in this follow-up.

Follow-up verification:

```sh
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
# From apps/desktop:
node scripts/host.mjs
bun run smoke -- tests/file-operations.spec.ts -g 'mutation IPC rejects'
# From repository root:
git diff --check
```

Typecheck, lint, host rebuild and diff check passed. The focused Electron safety test **passed (1 test)** against the rebuilt host using an isolated profile. It verifies hidden app-state entries, rejected direct protected listing/read/save requests, mutation rejection for protected/unapproved paths and rejection of another sender. No full-suite or packaged rerun is claimed for this six-line deletion.

Exact changes since that review: six lines deleted from `apps/desktop/host/main.ts`; this follow-up section appended to `docs/compatibility/files-tree.md`. Ready for fresh independent code review; overall acceptance still requires new-tree manual VoiceOver evidence. No staging, commit, merge, push, issue write, main-worktree modification or delegation occurred. The user app on port 5173 and its snapshot were untouched.
