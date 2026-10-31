# Workspace navigation and sidebar (#146)

The permanent Agents tab and fixed exact-checkout editor tabs share one compact strip
with Open project, Find file and Settings. Project sidebars begin with icon-labelled
Files, Diff and Chats switches. Diff is the existing Source Control mode: comparison
selection, working buffers and host authority are unchanged. Open checkout continues
to use the existing exact-checkout opener; Agents selection does not retarget editors.

All sidebars share a window-session width, initially 270 pixels, bounded to 190–380.
Drag the separator or focus it and use Left/Right (10 pixels), Home or End. The
separator retains focus and resizing does not remount the sidebar or its scroll area.
Session storage retains width through renderer reload; a fresh window session uses
the default. No collapse action or host-owned layout state is introduced.

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
