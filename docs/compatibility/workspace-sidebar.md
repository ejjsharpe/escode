# Workspace navigation and sidebar (#146)

The permanent Agents tab and fixed exact-checkout editor tabs share one compact strip
with Open project, Find file and Settings. Project sidebars begin with icon-labelled
Files, Diff and Chats switches. Diff is the existing Source Control mode: comparison
selection, working buffers and host authority are unchanged. Open checkout continues
to use the existing exact-checkout opener; Agents selection does not retarget editors.

All sidebars share a client workspace width, initially 270 pixels, bounded to 190–380.
Drag the separator or focus it and use Left/Right (10 pixels), Home or End. The
separator retains focus and resizing does not remount the sidebar or its scroll area.
The existing client-owned SQLite workspace recovery path retains width through renderer
reload and full Quit/relaunch. A separate client starts at the default. The validated
workspace contract and recovery reader bound saved widths to 190–380 pixels. No collapse
action is introduced.

Verification on 2026-10-31:

- TDD: the existing Electron/Playwright navigation test first failed because the
  Resize sidebar separator did not exist; it passed after implementation.
- Navigation and editable-diff suites passed together (3 tests), covering isolated
  alpha/beta repositories and a linked worktree, dirty text, saved text, unsent
  messages, view selection, exact Open checkout, lookup cancellation and shared
  comparison buffers. Added checks cover keyboard/pointer resizing, focus, scroll,
  width retention on reload and an 800 × 500 screenshot. The final focused navigation
  run passed (24.5 seconds), including opening and closing Settings at that size.
- TypeScript and production build passed. Lint reported existing warnings outside
  this change (checkpoints, recovery-copy, boundaries test and SQLite qualification).
- Broader Agents/accessibility runs did not pass: old Agents ordering assertions,
  duplicate fixture-error alerts, missing newly-created drafts, and keyboard fixture
  status remaining Preparing rather than Draft. These are not qualified by this slice.
  Simultaneous Electron test runs in other worktrees were observed; no changes were
  made to those worktrees or processes.

Native VoiceOver, packaged-app, installed-provider and 200% zoom qualification remain
for the parent integration effort. This slice does not implement chat ordering,
archive/title metadata, settings-default policy or composer redesign.

Merger qualification on 2026-10-31, based on integration `237ff32`:

- Restart regression first failed (380 became 270), then passed using existing workspace
  persistence. A separate isolated client retained its own default width.
- Typecheck, production build, lint and 25 workspace/contract tests passed.
- Combined Electron run: 7 passed, 2 failed. Both navigation scenarios, restart/client
  isolation, editable diff and three Agents scenarios passed. Keyboard/pointer resize,
  focus/scroll, non-default worktree context and 800 × 500 checks are included.
- The Agents restoration test expects `unapproved` first but receives `Chat 1 alpha
  Stopped`; the same assertion fails on unchanged integration `237ff32` in a separate
  temporary checkout. No ordering code changed in this slice.
- The keyboard test reaches its third scratch Send but cannot reach Send by Tab.
  A repeated unchanged-baseline run reproduces the exact same failure at line 132
  (the initial baseline run failed earlier at Monaco accessible diff activation).
  No slice-caused regression was found; this is not passing accessibility qualification.

No root checkout files or integration branch reference were modified. No PR or issue
mutation was performed. Native VoiceOver, packaged/installed-provider and 200% zoom
checks remain outside this merger qualification.
