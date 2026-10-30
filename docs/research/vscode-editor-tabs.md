# VS Code editor tabs reference for escode

Researched **2026-10-30** against `microsoft/vscode` commit **`c254b82c637ec4ee275483e6e4dcb31360a8b7d7`** ([commit][vscode-commit]). This is an observed `main` snapshot, not a claim about a stable release. Official documentation was also read at `microsoft/vscode-docs` commit **`5a54a294d553935c53374f43c668e37d08f0118e`** ([commit][docs-commit]). All upstream implementation/documentation links below are pinned.

Scope: ordinary desktop file editors, especially macOS; behavior and constraints for a future specification, with no product decisions or application changes. The open [Specify search throughout escode][search-map] map is a separate effort and was left untouched. This report follows the repository's [research branch convention][tracker]. The delegated background research agent read README, GLOSSARY, tracker instructions and that map before investigating. Sources are official Microsoft documentation, source and selected upstream tests; neither VS Code nor escode was launched or tested interactively.

## The important distinctions

- **Tab** is the visible header for an editor input in an **editor group**. Groups still contain open editors when tab headers are hidden. Files, comparisons and other editor types can be inputs; the tab is not the text buffer itself. [Group documentation][docs-groups], [model][model-open], [diff input][diff-input]
- **Preview** is an open editor eligible for replacement by another preview in the same group. At most one preview exists per group. Its label is italic. **Keep Open**, double-clicking the preview's header, double-clicking its Explorer file, or editing it promotes it to a kept-open editor. Promotion keeps the existing editor; it does not create a duplicate tab. [Settings and semantics][preview-settings], [existing-editor handling][model-open], [promotion][group-promotion]
- **Terminology trap:** the model calls a kept-open, non-preview editor **`pinned`** (`pinEditor`, `isPinned`). The UI's separate **Pin Editor** action calls **`stickEditor`** and produces a **sticky** editor. Sticky editors are also kept open, but kept-open editors need not be sticky. UI Unpin removes sticky status, not ordinary kept-open status. These are VS Code terms, not proposed escode glossary additions. [Commands][keep-pin-commands], [model pin/stick][model-pin-stick]
- **Dirty** means unsaved changes, independently of tab focus or stickiness. A dirty editor is promoted out of preview. Saving or undoing to clean does not itself turn it back into a preview. UI Pin does not save. [Dirty promotion][group-dirty], [pin/stick operations][model-pin-stick]

## Opening and keeping files

Under normal defaults, a single Explorer click opens a file as the group's preview while preserving Explorer keyboard focus. A double-click keeps it open and moves focus to the editor. Directories do not open file editors. Tree keyboard selection can request preview with preserved focus; explicit keyboard opening can request a kept-open editor. Focus, selection and opening are separate inputs to the operation. [List event consumer][list-open], [Explorer event consumer][explorer-open]

Opening A, then B by single click leaves B in place of preview A. After Keep Open or an edit in B, opening C leaves B and adds preview C. Selecting an already-open editor reuses it rather than creating another entry in that group. Opening a kept-open file does not have to remove a different existing preview. Replacement and MRU membership are tested upstream. [Open model][model-open], [preview replacement test][preview-test]

Relevant defaults and variants, rather than one universal “VS Code behavior”:

- `workbench.editor.enablePreview=true`; setting it false promotes an existing preview and makes ordinary subsequent opens kept-open. [Defaults][editor-defaults], [configuration change consumer][group-dirty]
- `workbench.list.openMode="singleClick"`; `"doubleClick"` changes the tree/list mouse opening gesture. This is separate from whether preview is enabled. [List setting and consumer][list-open-mode], [pointer behavior][list-open]
- `workbench.editor.enablePreviewFromQuickOpen=false` at this revision. Do not infer Quick Open's default from Explorer's default. `enablePreviewFromCodeNavigation=false` controls whether a preview remains a preview when code navigation starts from it; it is not a blanket statement that every navigation destination opens kept-open. [Setting descriptions][preview-settings], [defaults][editor-defaults]
- Double-clicking an already kept-open header has another purpose: by default it toggles group expansion (`doubleClickTabToToggleEditorGroupSizes="expand"`), with `maximize`/`off` variants. [Double-click handler][tab-keys], [defaults][editor-defaults]

## Closing, choosing the next editor, and reopening

Ordinary tabs have a close action; middle-click and Close Active Editor are other entry points. A dirty ordinary text editor normally asks to save, discard changes, or cancel. Save failure/still-dirty state vetoes closing; Cancel vetoes it. Certain Auto Save modes attempt saving first, and custom editor types can provide a close handler. If the same editor remains editable in another group, closing one presentation can skip the confirmation. This is presentation lifetime versus buffer lifetime, not a guarantee that every dirty tab close displays a dialog. [Tab close actions][tab-close], [close confirmation][close-confirm]

The default `focusRecentEditorAfterClose=true` activates the most recently active remaining editor **within that group** when its active editor closes. Closing an inactive editor does not replace the active one. With the setting false, choose the right neighbor, or the left neighbor when closing the last tab. The final close leaves no active editor; empty secondary groups normally close (`closeEmptyGroups=true`). Visual order and MRU order are maintained separately. [Model][model-close], [upstream MRU/neighbor tests][mru-tests], [defaults][editor-defaults]

**Reopen Closed Editor** (`Cmd+Shift+T` on macOS) uses a bounded recently-closed list (20 entries). At this pinned revision, editors closed together in one batch are reopened together, as kept-open inputs in the currently active group, retaining recorded index/stickiness where applicable. Replacement and move closes are excluded, so browsing through previews does not fill this list. Reopening a deliberately discarded file is not recovery of its discarded text. The batch behavior is explicitly tested upstream. [History implementation][reopen], [command binding][reopen-command], [tests][reopen-tests]

UI-pinned/sticky tabs lead the ordinary tabs and are excluded from routine Close Others, Close All Editors and editor-limit eviction. Default `preventPinnedEditorClose="keyboardAndMouse"` also protects them from keyboard and middle-click closes; the keyboard command can move to a recent non-sticky editor instead. They are not uncloseable: an explicit contextual close or closing groups can include them, and protection is configurable. The pin icon normally offers Unpin. [Close handler][sticky-close], [bulk actions][bulk-close], [pin display/actions][tab-actions], [defaults][editor-defaults]

## Ordering and overflow

The precise default is **insert to the right of the active editor**, not always append at the far end. `openPositioning` can instead be left/first/last. Ordinary opens stay after the sticky prefix. A replacement preview follows insertion rules and does not own a permanently reserved slot. Dragging reorders tabs; moving a preview within its group promotes it when its index changes. Tabs can also be moved/copied between groups, including multiple selected tabs. [Insertion model][model-open], [preview position test][preview-position-test], [reorder/drop][tab-drop], [promotion on reorder][group-reorder]

Defaults are multiple tabs, one row (`wrapTabs=false`), content-fit labels (`tabSizing="fit"`), an automatic horizontal scrollbar, and scrolling rather than wheel-based tab switching (`scrollToSwitchTabs=false`). The layout reveals the active tab as needed. Variants include shrinking/fixed widths, wrapped rows, single active header or hidden headers, and sticky tabs on a separate row. These are optional configuration surfaces, not necessary parts of a basic tab interaction. [Defaults][editor-defaults], [setting descriptions][tab-settings], [scroll/reveal consumer][tab-overflow]

Documentation describes pinned tabs as staying visible, but the implementation qualifies this: non-scrolling sticky positioning is applied to `compact`/`shrink` pinned sizing, while default `normal` inherits ordinary tab layout. The control can also disable sticky positioning when the remaining width is too small. Avoid promising that every pinned tab can always remain visible. [Official pinned tabs description][docs-pinned], [sticky CSS][sticky-css], [width fallback][tab-overflow]

The optional open-editor limit is **disabled** by default. When enabled it evicts eligible least-recently-used clean editors, globally or per group; dirty editors and sticky editors are protected, so it is not an unconditional hard cap. The configured default value of 10 has no effect while disabled. [Defaults][editor-defaults], [limit consumer][editor-limit]

## Labels and accessibility

Default labels use editor names (normally the filename) and add shortened parent-path descriptions when names collide within the group's tab model. When necessary, the implementation tries longer descriptions before shortening them. Full titles are available in hover text. `labelFormat` offers short/medium/long alternatives; custom label patterns are a separate optional feature. A filename label is not an editor identity. [Label computation][tab-labels], [custom-label documentation][docs-custom-labels]

Preview italics, unsaved markers, active selection and UI-pin indicators communicate different states. The normal unsaved marker is a dot, not Git's modified status; decoration badges/colors and optional modified-tab borders are separate configuration. The dirty styling is suppressed while the editor reports saving. [Save documentation][docs-save], [tab rendering][tab-render], [defaults][editor-defaults]

The tab strip uses `role="tablist"` with multi-selection support; headers use `role="tab"`, `aria-selected` and roving focus (only the active tab has `tabIndex=0`). With header focus, arrows/Home/End navigate while retaining tab-control focus; Enter/Space opens/focuses the editor; Shift+F10 opens its context menu. Accessible labels explicitly include preview, UI-pinned and group information where relevant. This report does not establish real VoiceOver output. [Strip role][tab-roles], [header role][tab-header], [keyboard handler][tab-keys], [selection rendering][tab-render], [accessible labels][tab-aria]

Useful built-in macOS reference bindings (user keymaps can override them):

- Keep Open: `Cmd+K`, then `Enter`; UI Pin/Unpin: `Cmd+K`, then `Shift+Enter`. [Commands][keep-pin-commands]
- Close active: `Cmd+W`; reopen: `Cmd+Shift+T`. [Close command][sticky-close], [reopen command][reopen-command]
- `Ctrl+Tab` / `Ctrl+Shift+Tab`: active group's MRU picker, distinct from visual-order next/previous commands (`Cmd+Option+Right/Left`, which can continue into other groups). [MRU bindings][mru-bindings], [sequential navigation][sequential-keys]

## Groups, diffs, and restoration

Each group owns its editor order, active selection, preview, MRU list and sticky prefix. The same file can appear in more than one group. Ordinary opening prefers the active group; optional `revealIfOpen=true` can reveal an already-open editor in another group. Explicit side/group requests and locked groups affect targeting. Pinning a tab and locking a group are different operations. [Group model][model-open], [group targeting][group-finder], [settings][group-settings], [locked-group documentation][docs-locked]

A diff is an editor input with **both original and modified identities**; matching compares both sides, rather than just the displayed filename. A comparison and an ordinary file editor can therefore be distinct tabs. The modified/primary side supplies the usual dirty/save state; when it is the same file resource, its text model can be shared with an ordinary file view. Tabs/groups should not be mistaken for independent copies of the file's unsaved text. [Diff identity][diff-input], [primary-side behavior][side-input], [comparison resolution][diff-input]

Group serialization records serializable inputs in visual order, MRU/active selection, preview, sticky boundary and lock state. Editor-part storage records the grid, active group and group MRU. Unsupported/nonserializable inputs are skipped, so this is not unconditional restoration of every possible editor. `workbench.editor.restoreEditors=true`; false restores only dirty editors. `restoreViewState=true` restores editor view state such as scrolling per group; `sharedViewState=false` by default. [Serialization][group-serialize], [layout storage][layout-storage], [restoration settings][restore-settings]

Restoring tab identity/layout and preserving unsaved text are separate mechanisms. Native `files.hotExit="onExit"` backs up unsaved work for applicable application exits; `onExitAndWindowClose` broadens window-close behavior and `off` disables it. macOS closing a window is distinct from Quit. `window.restoreWindows` additionally controls which windows return. Hot Exit does not make explicit close/discard non-destructive. [Native configuration][hot-exit-config], [official explanation][docs-hot-exit], [window restoration][docs-windows]

## Rename, deletion, and external disk changes

- **An in-app move/rename:** open affected editors are renamed/replaced, preserving focus, preview/kept-open state, stickiness, index and inactive state. The text-file model manager separately carries dirty snapshots to moved targets, including descendants of renamed folders. [Editor move consumer][editor-moves], [working-copy snapshots][model-moves]
- **External deletion/rename:** `closeOnFileDelete=false` normally leaves the open editor available at its old identity; an external rename need not be recognized as a move. Enabling the option closes eligible clean editors after validating disappearance. In-app deletion closes clean affected editors; dirty editors are excluded from this automatic-close path. Missing text models enter orphaned state. This does not establish the separate Explorer delete-confirmation workflow. [Delete consumer][editor-deletes], [orphan state][orphan-state], [setting semantics][preview-settings]
- **External content updates:** clean models are queued for reload; dirty ones are skipped and are not silently reloaded over the user's edits. Modified-since save failures offer Compare/Overwrite through the save-error handler. There are additional source paths for reconciling retained content at this revision; this report makes no blanket guarantee about merging external edits. Tab replacement/closure must not substitute for disk-conflict handling. [Reload consumer][model-reload], [save-error actions][save-errors]

## Existing escode constraints

Inspected baseline: **`fc8643912b79fab9279256cde75e9af0843bf9a1`** ([commit][escode-commit]), in isolated worktree `/Users/elliotsharpe/.t3/worktrees/escode/t3-63afdfff`. Paths below are exact repository-relative paths under that root; source links use the baseline, independently of the report commit. These are observed constraints and consequences, not a proposed tab design.

- **Two existing navigation levels:** `apps/desktop/src/main.tsx` contains app-wide Agents/project selection and project-local Files/Source Control/Chats selection. `ProjectView` remembers `mode`, `checkout`, `roots` and `chat` by project identity. Linked checkouts share a project; selecting an existing non-draft chat selects its checkout. A future file-tab scope must be reconciled with Current checkout and existing project-tab terminology. [Project navigation][escode-project-nav], [app selection][escode-app-nav], [glossary][escode-glossary]
- **File identity and open state:** `CheckoutView` owns a buffer map per checkout root, keyed by checkout-relative file path; Monaco URIs include root plus path. `select` reuses that buffer, remembers one current `path` per root and clears the displayed diff. It has no preview/kept-open list or MRU model. Visiting files retains their models until explicit closure or unmount; a single title/Close file toolbar displays the current document. [Buffers/select][escode-buffers], [current state][escode-current], [toolbar][escode-toolbar]
- **Files selection is independent:** `apps/desktop/src/files.tsx` stores expanded paths, multi-selection, focus and scroll per checkout. A plain row click or Space opens a file with tree focus retained; arrow navigation changes tree focus/selection, and Enter currently begins Rename. There is no separate double-click promotion event. Adding one must preserve the existing tree keyboard and multi-selection contract. [Tree memory][escode-tree-memory], [row click][escode-tree-click], [tree keys][escode-tree-keys], [open callback][escode-tree-open]
- **File and diff share unsaved text:** `showDiff` persists a selected `{path, area}` and binds its modified side to the same working buffer as Files when available. Staged comparisons use HEAD against the editable working copy (including unstaged edits); unavailable working files get a read-only comparison. Saving writes the working file without staging. A future tab identity cannot safely collapse every comparison into `{path}` without deciding how staged/unstaged/untracked comparisons relate. [Renderer diff][escode-diffs], [host baseline query][escode-diff-query], [accepted diff terminology][escode-glossary]
- **Close and recovery already protect data:** `closeFile` asks Save/Discard/Cancel for dirty buffers, vetoes failed Save, persists removal of recovery text before disposing its model, and currently clears the active path rather than choosing a next editor. Project close/Quit visits all buffers and defers proposed discards until the broader close succeeds. `apps/desktop/src/workspace.ts` coalesces persistence for 150 ms and exposes explicit flush; recovery is best effort. A tab's disappearing header cannot be equated with discarding its dirty buffer. [File close][escode-close], [whole-view close][escode-app-close], [persistence][escode-persist], [native choices][escode-dialog]
- **Saved view identity is currently sparse:** `packages/contracts/index.ts` defines `views` with project/checkout navigation, a single `path`, and one selected change; `drafts` contain `{root,path,text,disk}`. There is no persisted ordered file-tab list, preview marker, sticky state or MRU. Ordinary Monaco cursor/scroll state is retained on its in-memory buffer; it is not serialized by this workspace schema. `apps/desktop/host/workspace.ts` validates state and host/client ownership. New persisted tab state would cross this validated schema/storage boundary, not just a component. [Contract][escode-contract], [memory view state][escode-editor-view], [host validation][escode-workspace]
- **Moves and disappearance already have rules:** `fileOperation` migrates affected models, baselines and available cursor/scroll state on successful moves, resets earlier undo history, clears selected diffs, then persists before acknowledging. `apps/desktop/host/file-operation-state.ts` reconciles recovery draft paths, active paths, tree memory and selected changes after moves/Trash. External disappearance retains available dirty drafts; Save retains Compare/Overwrite/Reload/Cancel conflict behavior. Future tab references must participate in the same successful/failed/uncertain outcomes. [Renderer reconciliation][escode-file-operations], [durable reconciliation][escode-reconcile], [watch evidence][escode-watch], [save/recovery evidence][escode-recovery]

## Decisions left for the parent interview

The evidence does not settle these product choices:

1. Does a project have one file-tab set across checkouts, or separate sets per checkout? What happens to Current checkout when a tab from another checkout activates?
2. Which inputs appear: Files only, Source Control comparisons, save-conflict comparisons, chats, or other views? Can the same working file and multiple comparison kinds remain distinct tabs?
3. Is Explorer preview enabled, and which existing click/keyboard/open/create gestures keep an editor open? Are UI Pin/sticky behavior and editor groups in scope at all?
4. What does close target, what remains recoverable, which editor becomes active, and is Reopen Closed Editor required? How do project close and Quit compose with tab close?
5. Which order, overflow, labels and accessibility behavior are required? How are equal filenames and equal relative paths from different checkouts distinguished?
6. What restores after project reopen/restart: clean tabs, previews, order, active tab, cursor/scroll, history? What happens to unavailable roots and missing files? Which successful/partial/uncertain file operations update tab identities?

## Verification and gaps

Source readers traced event consumers and models rather than relying on settings alone, and inspected upstream tests for preview replacement, MRU close, preview positioning and batch reopen. Report links were checked against their pinned files and line bounds; `git diff --check` was run before commit. No application suite was needed for this documentation-only branch. No issues, glossary entries, product decisions or app code were changed; no PR is intended.

Not covered by interactive evidence: exact rendered themes/overflow at narrow widths, macOS/VoiceOver announcements and focus behavior, crash-timing guarantees, every custom editor/extension/remote filesystem, or a released-build compatibility matrix. The report describes the pinned source snapshot; later `main` and installed builds can differ. It does not recommend adopting VS Code's settings surface or internal module architecture.

[vscode-commit]: https://github.com/microsoft/vscode/commit/c254b82c637ec4ee275483e6e4dcb31360a8b7d7
[docs-commit]: https://github.com/microsoft/vscode-docs/commit/5a54a294d553935c53374f43c668e37d08f0118e
[search-map]: https://github.com/ejjsharpe/escode/issues/87
[tracker]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/docs/agents/issue-tracker.md
[docs-groups]: https://github.com/microsoft/vscode-docs/blob/5a54a294d553935c53374f43c668e37d08f0118e/docs/editing/getting-started/userinterface.md#L68-L81
[model-open]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/common/editor/editorGroupModel.ts#L290-L438
[diff-input]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/common/editor/diffEditorInput.ts#L34-L244
[preview-settings]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/workbench.contribution.ts#L331-L351
[group-promotion]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorGroupView.ts#L1143-L1188
[keep-pin-commands]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorCommands.ts#L1338-L1445
[model-pin-stick]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/common/editor/editorGroupModel.ts#L780-L925
[group-dirty]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorGroupView.ts#L868-L892
[list-open]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/platform/list/browser/listService.ts#L705-L772
[explorer-open]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/contrib/files/browser/views/explorerView.ts#L599-L623
[preview-test]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/test/browser/parts/editor/editorGroupModel.test.ts#L1145-L1176
[editor-defaults]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editor.ts#L35-L82
[list-open-mode]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/platform/list/browser/listService.ts#L1398-L1407
[tab-keys]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts#L1201-L1285
[tab-close]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts#L1183-L1199
[close-confirm]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorGroupView.ts#L1753-L1909
[model-close]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/common/editor/editorGroupModel.ts#L526-L586
[mru-tests]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/test/browser/parts/editor/editorGroupModel.test.ts#L1262-L1368
[reopen]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/history/browser/historyService.ts#L663-L824
[reopen-command]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorActions.ts#L1691-L1716
[reopen-tests]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/history/test/browser/historyService.test.ts#L634-L685
[sticky-close]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorCommands.ts#L786-L887
[bulk-close]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorActions.ts#L789-L840
[tab-actions]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts#L1722-L1786
[preview-position-test]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/test/browser/parts/editor/editorGroupModel.test.ts#L1947-L1962
[tab-drop]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts#L2729-L2792
[group-reorder]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorGroupView.ts#L1448-L1475
[tab-settings]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/workbench.contribution.ts#L42-L105
[tab-overflow]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts#L2419-L2600
[docs-pinned]: https://github.com/microsoft/vscode-docs/blob/5a54a294d553935c53374f43c668e37d08f0118e/docs/configure/custom-layout.md#L309-L330
[sticky-css]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/media/multieditortabscontrol.css#L241-L291
[editor-limit]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorsObserver.ts#L347-L409
[tab-labels]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts#L1599-L1720
[docs-custom-labels]: https://github.com/microsoft/vscode-docs/blob/5a54a294d553935c53374f43c668e37d08f0118e/docs/editing/getting-started/userinterface.md#L450-L473
[docs-save]: https://github.com/microsoft/vscode-docs/blob/5a54a294d553935c53374f43c668e37d08f0118e/docs/editing/codebasics.md#L120-L135
[tab-render]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts#L1828-L1965
[tab-roles]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts#L264-L275
[tab-header]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts#L1008-L1018
[tab-aria]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/editor.ts#L275-L292
[mru-bindings]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorActions.ts#L1867-L1904
[sequential-keys]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorActions.ts#L1267-L1360
[group-finder]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/editor/common/editorGroupFinder.ts#L107-L217
[group-settings]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/workbench.contribution.ts#L353-L377
[docs-locked]: https://github.com/microsoft/vscode-docs/blob/5a54a294d553935c53374f43c668e37d08f0118e/docs/configure/custom-layout.md#L332-L349
[side-input]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/common/editor/sideBySideEditorInput.ts#L183-L225
[group-serialize]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/common/editor/editorGroupModel.ts#L1163-L1265
[layout-storage]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/parts/editor/editorPart.ts#L1486-L1520
[restore-settings]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/browser/workbench.contribution.ts#L410-L430
[hot-exit-config]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/contrib/files/browser/files.contribution.ts#L124-L145
[docs-hot-exit]: https://github.com/microsoft/vscode-docs/blob/5a54a294d553935c53374f43c668e37d08f0118e/docs/editing/codebasics.md#L147-L161
[docs-windows]: https://github.com/microsoft/vscode-docs/blob/5a54a294d553935c53374f43c668e37d08f0118e/docs/editing/getting-started/userinterface.md#L563-L574
[editor-moves]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/editor/browser/editorService.ts#L238-L320
[model-moves]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/textfile/common/textFileEditorModelManager.ts#L202-L331
[editor-deletes]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/editor/browser/editorService.ts#L323-L410
[orphan-state]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/textfile/common/textFileEditorModel.ts#L158-L207
[model-reload]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/services/textfile/common/textFileEditorModelManager.ts#L134-L196
[save-errors]: https://github.com/microsoft/vscode/blob/c254b82c637ec4ee275483e6e4dcb31360a8b7d7/src/vs/workbench/contrib/files/browser/editors/textFileSaveErrorHandler.ts#L113-L136
[escode-commit]: https://github.com/ejjsharpe/escode/commit/fc8643912b79fab9279256cde75e9af0843bf9a1
[escode-glossary]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/GLOSSARY.md
[escode-project-nav]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L838-L978
[escode-app-nav]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L979-L1076
[escode-buffers]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L173-L313
[escode-current]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L103-L124
[escode-toolbar]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L765-L783
[escode-tree-memory]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/files.tsx#L37-L42
[escode-tree-click]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/files.tsx#L833-L872
[escode-tree-keys]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/files.tsx#L727-L805
[escode-tree-open]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L684-L711
[escode-diffs]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L370-L414
[escode-diff-query]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/host/project.ts#L516-L555
[escode-close]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L416-L466
[escode-app-close]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L988-L1025
[escode-persist]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/workspace.ts#L11-L58
[escode-dialog]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/host/main.ts#L221-L231
[escode-contract]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/packages/contracts/index.ts#L109-L121
[escode-editor-view]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L217-L290
[escode-workspace]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/host/workspace.ts#L31-L114
[escode-file-operations]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/src/main.tsx#L536-L617
[escode-reconcile]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/apps/desktop/host/file-operation-state.ts#L8-L54
[escode-watch]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/docs/compatibility/files-watch.md
[escode-recovery]: https://github.com/ejjsharpe/escode/blob/fc8643912b79fab9279256cde75e9af0843bf9a1/docs/compatibility/foundation-files.md#L5-L11
