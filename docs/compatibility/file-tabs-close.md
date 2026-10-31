# Safe file closing — issue 98

Scope: [single and captured-batch close](https://github.com/ejjsharpe/escode/issues/98), under [file tabs](https://github.com/ejjsharpe/escode/issues/92), on integration baseline `5e426d7fd1af3801c23fb7ed05cec6498d6ae8f7`. This is bounded ticket evidence, not complete parent qualification.

Each tab's Close control, toolbar Close file, contextual Cmd+W, and tab-menu Close/Close Others/Close to the Right/Close All share the same close path. The menu captures the context identity and visual order without activating the context tab. Targets are fixed before dirty choices. Each shared working buffer receives one Save/Discard/Cancel gate, including comparison views; read-only comparisons without working buffers can also close.

The batch resolves all choices before applying proposed discards or removing any tab. Saves already completed remain disk facts after later Cancel/failure. Fresh persistence must succeed before staging removal, and the snapshot removing recovery drafts and tab identities must succeed before releasing Monaco models. A failed snapshot restores the client's targeted drafts and tab metadata; retry attempts fresh persistence even after rollback persistence failed. Existing host save receipts, ownership, recovery and conflict baselines remain authoritative.

Inactive closure retains the active identity/view. Active closure selects the most recently activated remaining identity, falling back to visual order for unvisited restored tabs. Closing the final file leaves the checkout open and focuses the empty editor region. Surviving editors receive focus after close resolution. Cmd+W operates only in the active Files/Source Control workspace, including sidebar focus; no files is a no-op. Chats, Agents, menus, dialogs/conflicts and ordinary input controls retain their scope. Tab-menu keyboard entry, traversal and Escape restore tab focus.

`prepareFileClose` is also used by existing project/Quit preparation with its deferred-discard callbacks. `closeFiles` owns explicit file-close transactions; its captured targets and pre-removal view metadata remain available at the successful persistence boundary for later reopen work. No recently-closed history or reopening is implemented here. No new storage contract or host authority was added.

## Verification

The requested Electron seam uses temporary real Git checkouts, native Save/Discard/Cancel dialog choices, disk bytes, recovery snapshots and the existing host filesystem persistence fault control. `tests/file-tabs-close.spec.ts` covers inactive targeting, MRU distinct from visual order, empty focus, keyboard menu dismissal, exact prompt paths, earlier Save/later Cancel, deferred discards, contextual bulk commands, failed Save/conflict retention, failed persistence and retry without intervening navigation, comparison shared text, restart after successful discard, hidden Chats/Agents scope, input scope and read-only comparison closure.

Vertical red/green evidence: the first journey failed waiting for the missing context menu; after implementation it failed on survivor editor focus, then passed after focus moved to the post-render editor lifecycle. The persistence journey exposed a retry failure after both staged removal and rollback writes failed; fresh pre-close persistence repaired it. The later-cancel journey also exposed that saving an inactive batch target cleared the active file’s Unsaved indicator; saving now updates that indicator only for the displayed file. Additional journeys passed against the implemented shared gate without additional production behavior. No mock-provider Send behavior was changed. The intermittent Send uncertainty recorded in [shared-view evidence](file-tabs-comparisons.md) remains a qualification limitation.

Recovery remains best effort and saving retains the existing check-before-save guarantee. Preview/Keep Open, reordering, reopen history and broader restoration qualification belong to their other tickets. No manual VoiceOver gate applies under the accepted 2026-10-31 amendment.


Final results on 2026-10-31:

- Desktop typecheck, lint and `git diff --check`: passed.
- Full unit suite: 266 passed, four skipped (29 passing files, one skipped).
- Development Electron: the first broader run passed 14/15, with the crash-recovery case timing out before its initial Open project control appeared while a local rebuild overlapped startup. Its rerun passed. The next broader run passed 15/16 across close, file tabs, editable diffs, lifecycle and Agents/file recovery; the mock-provider editor-close case timed out waiting for Running before editor closure. No clean single broad run is claimed. All sixteen scenarios passed across runs.
- After the inactive-save indicator fix, the final focused development run passed all five close journeys and the isolated mock-provider editor-close lifecycle retry (six passed). The final packaged run also checks comparison Cmd+W from sidebar focus, its single shared-buffer Cancel prompt, and retained text.
- Final build and macOS arm64 package: passed, with the existing chunk-size warning, default icon and unsigned local development configuration.
- Final packaged Electron with restricted PATH (`ESCODE_PACKAGED=1`): all five close journeys passed.

No live provider turns, exhaustive desktop suite, manual VoiceOver session or complete parent-spec qualification were run. The prior mock-provider Send uncertainty remains unresolved; the local package is not a release. No PR was created and no issue was closed.

Combined preview/safe-close merge checks and repairs are recorded in [integration evidence](file-tabs-integration.md); the original startup and mock-provider uncertainties above remain qualification limits.
