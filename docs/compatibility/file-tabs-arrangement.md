# File-tab arrangement and accessibility — issue 97

Scope: [Arrange and identify file tabs accessibly](https://github.com/ejjsharpe/escode/issues/97), under [file tabs](https://github.com/ejjsharpe/escode/issues/92). Built in an isolated worktree from integration `b7a005b5891f59b277c861020dadbb53e68d97e1`, containing the foundation, shared comparisons, previews and safe-close slices. This is bounded ticket evidence, not complete parent qualification.

Dragging a tab onto another moves its existing identity to that visual position without selecting another file, changing MRU or creating a buffer. Moving a preview to a different position promotes it; dropping on itself or cancelling the drag preserves preview status. Drag data is local to the mounted checkout strip; unrelated/native/tree drags cannot reorder tabs. New files still insert immediately right of the active identity. Order uses the existing client-owned `openFiles` metadata; no storage/authority changes were needed.

The existing single horizontal strip reveals the active tab and close control after activation, reorder, workspace activation and resize. Kept-open files remain available. Labels use the shortest distinct path suffix among open files, with exact checkout-relative accessible names and full absolute-path hover. Preview italics, active selection and a separate unsaved dot/accessible description retain distinct meanings from Git status. The existing comparison toolbar continues identifying the view and path.

Only the active tab participates in ordinary Tab navigation; close buttons remain pointer accessible and Close is also available from the tab menu. Left/Right wrap and activate adjacent tabs; Home/End activate the ends. Enter/Space activate the focused tab and focus its editor after mounting. Shift+F10 opens the existing menu, menu keys traverse actions, Escape returns focus to the context tab, and close retains the shared close gate and editor/empty-content focus restoration.

## Verification

The agreed existing Electron harness is the primary seam. Three vertical red/green journeys in `tests/file-tabs-arrangement.spec.ts` cover pointer reorder in both directions, preview promotion and same-position preservation, right-of-active insertion, persisted order after reload, duplicate filenames, unsaved semantics, narrow overflow with eleven retained tabs, roving focus, wrapping arrows/Home/End, Enter/Space, menu Escape and post-close focus. They run against real temporary repositories without a provider turn.

The first slice failed at unchanged order before drag implementation, then passed. Its initial reload assertion raced debounced persistence; the fixture now waits for the real durable snapshot, matching existing tab tests. The second fixture initially used a nonexistent tree expansion button; after correcting it to the existing tree interface it failed on missing Unsaved semantics. The initial reveal implementation exposed subpixel clipping at the filename edge; revealing the whole tab including Close fixed the narrow check. The third slice failed at missing roving tabindex before its implementation, then passed. A rendered 650px-wide capture was inspected; the mechanical UI detector reported no findings.

Checks on 2026-10-31:

- Desktop typecheck, lint and `git diff --check`: passed. Mechanical UI detector: no findings.
- Full unit suite: 267 passed, four skipped (29 passing files, one skipped).
- Focused development Electron arrangement suite: three passed. The broader development run across arrangement, file-tabs, safe-close, editable-diff and navigation passed 16 of 17, with the existing editable-comparison journey timing out at 45 seconds and worker teardown also timing out. An immediate unchanged isolated retry passed in 8.4 seconds. All seventeen scenarios passed across runs; no clean single broad development run is claimed. Other worktrees had concurrent GUI harnesses, but causation was not established and no production change was made for the timeout.
- Build and macOS arm64 package: passed, retaining the existing bundle-size warning, default icon and unsigned development configuration.


Prior [integration evidence](file-tabs-integration.md), [comparison evidence](file-tabs-comparisons.md) and [preview evidence](file-tabs-previews.md) retain the earlier startup failure, intermittent mock-provider Send/Running uncertainty and mixed broad-run history. This slice does not establish their causes or qualify provider behavior. No live provider turns, manual VoiceOver sessions, exhaustive desktop suite or full parent-spec qualification were run. The user's testing amendment removes manual VoiceOver as an acceptance gate. Recovery remains best effort; saving retains check-before-save limits; packaging is an unsigned local development artifact.
