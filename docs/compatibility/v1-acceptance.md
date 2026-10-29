# V1 acceptance evidence

Validation on 2026-10-29 for [Complete the v1 acceptance gates](https://github.com/ejjsharpe/escode/issues/19), against [the v1 specification](https://github.com/ejjsharpe/escode/issues/11). The starting revision was `5c00a67b336d765037556f97de51ba054734ca81`.

The twelve functional scenarios below have integrated service and desktop coverage. **VoiceOver validation was deferred at the user's explicit request.** Keyboard automation and native accessibility-tree inspection are evidence of their own checks, not a completed VoiceOver pass. The manual checklist below is the remaining user validation.

Validation passed: all **68 host tests** (including live Codex settings and four-chat concurrency), **19 desktop workflows**, TypeScript and lint. The complete desktop run includes Nx build/package, the StyleX development check and the restricted-PATH packaged workflows. An observed crash-recovery sample acknowledged its draft **425 ms** after typing began.

## Reproduce

Test host: macOS 26.3.1 (25D2128), arm64; Bun 1.4.4, Node 26.13.0, Electron 45.1.0, Git 2.50.1 and installed/authenticated Codex 0.165.0. The support policy remains stable Codex 0.163.0 or newer with runtime protocol checks; this run does not certify every admitted version or permission profile.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
ESCODE_LIVE_CHAT=1 bun run test
ESCODE_PACKAGED=1 ESCODE_LIVE_CHAT=1 bun run smoke
```

The last command uses Nx's build/package dependencies. `ESCODE_PACKAGED=1` selects the packaged app for navigation, concurrency, worktree, lifecycle, unavailable-state, keyboard and live-chat workflows. Their application PATH is `/usr/bin:/bin`; controlled protocol tests prepend only their temporary tool directory. The development hot-reload check and the explicitly named unpackaged editing check still exercise the development runtime. All app launches use isolated user-data directories.

Live checks consume bounded model turns. Run portable service tests without `ESCODE_LIVE_CHAT=1`; the live settings/concurrency and Electron chat checks then skip. Use `ESCODE_TEST_CODEX_DIR` to select a different installed Codex for the live Electron chat check. Installation/authentication and configuration remain external.

Host integration tests allow 15 seconds per case for real Git/filesystem subprocesses; live protocol cases have their own longer deadlines. Two real-Git cases exceeded the earlier five-second default under concurrent load, without assertion failures. The assertions and preservation checks remain unchanged.

## Functional gates

1. **Toolchain and packaged launch.** An isolated install from the unchanged manifests/lockfile installed 468 packages and ran the root Electron installer; the installed binary reports 45.1.0. The blocked electron-winstaller hook concerns Windows only. TypeScript now checks the smoke tests as well as the host/renderer. Nx build/package, production StyleX CSS, bundled Monaco workers and restricted-PATH launch are exercised. `tests/packaged.spec.ts` opens invalid JSON and waits for actual worker diagnostics, checks renderer isolation and captures the packaged window. `tests/development.spec.ts` verifies a visible StyleX update on a private ephemeral port, leaving the existing development server untouched.

2. **Project and view memory.** `tests/navigation.spec.ts` uses two repositories and a linked worktree, checks tab deduplication, branch switches, remembered file/diff/chat selections, retained editor buffers and chat drafts, and checkout context. It rejects another project's checkout. Restart tests preserve tab order and independent project selections.

3. **Safe editing.** `host/project.test.ts` and both editing workflows in `tests/project.spec.ts` cover external changes, comparison, repeated overwrite confirmation, Reload, Cancel, failed saves, retained edits and correct disk contents. Native filesystem checks cover parent/root replacement, symlinks, staging failures, metadata, hard links and concurrent saves. A deterministic separate-process write after the final content check records the explicitly agreed check-before-save limitation; no transactional replacement is claimed.

4. **Correct diffs.** Real Git tests compare HEAD/index/disk for staged, unstaged and untracked files, including unborn HEAD and literal wildcard names. Binary and oversized text has an unavailable result. Desktop checks verify read-only diffs, external refresh, view memory and exclusion of unsaved buffers. An unchanged refresh retains the same editor so keyboard/diff-review focus survives polling.

5. **Saved chats and Stop.** The live packaged chat workflow creates, sends, streams, completes and reconnects through a fresh connection, with one user message and retained unsent draft. The live concurrency test interrupts one real chat after command execution starts and verifies the other three complete. Controlled protocol tests additionally check completed activity, duplicate-turn rejection, stale callbacks and interruption without replay.

6. **Concurrent chats and scoped requests.** The live host test runs four Codex chats: two sharing one checkout, one on a newly app-created managed worktree, and one in another repository. `tests/concurrency.spec.ts` uses independent real stdio subprocesses with overlapping wire request IDs; approval replies, Stop and disconnect stay with their originating project/chat/turn/request while background indicators retain focus. Host checks also cover file/permission approval and question/MCP responses, resolved/stale requests and lost stdout. Controlled requests establish routing without claiming every live approval policy was reproduced.

7. **Inherited effective settings.** `host/acceptance.test.ts` runs installed Codex against an isolated private configuration home. Alpha inherits home defaults: gpt-6.1-sol, low effort, on-request approval and read-only sandbox. Beta has trusted checkout-specific overrides: gpt-6.1-terra, high effort, never approval and workspace-write sandbox. Each case independently checks `config/read`, then asserts all four actual settings for new and freshly resumed conversations, reloads the same saved thread with one user turn, and retains its draft. A private temporary copy of existing authentication is removed after every connection stops. SHA-256 checks establish that the user's configuration stayed unchanged without printing its contents; both fixture configurations are also unchanged. The unavailable-state desktop fixture checks that start/resume send checkout/thread identity only, with no escode setting overrides. The installed schema was checked using `codex app-server generate-ts`; [official app-server documentation](https://learn.chatgpt.com/docs/app-server) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) support these contracts. This establishes contrasting home/project settings on the tested build, not every possible managed policy.

8. **Committed-state creation.** Real-repository tests exercise every category of original local change, the displayed commit, moved/missing bases, empty repositories, same-name repositories, occupied destinations, separate-process concurrent creation, changed Git metadata and partial failures. The desktop workflow retains an unsaved original buffer, creates from the displayed committed state, and reports a real checkout-filter failure and fresh-destination retry. The live concurrency gate now uses the app's actual managed-worktree creation service for its separate checkout.

9. **Explicit reuse and retention.** Desktop worktree checks explicitly reuse a discovered checkout and show the shared-files notice. Navigation/lifecycle tests retain saved chat associations/drafts, branches and managed worktrees through project close and quit/reopen, with no automatically sent turn or cleanup. Existing protocol history is loaded through its original provider-thread identity.

10. **Protected removal.** Real Git/filesystem checks cover app ownership, retained branch/commit, tracked/untracked/ignored files introduced after inspection, hidden index entries, uncertain checks, a locked worktree and retry, external-worktree rejection, and missing-but-registered removal recovery. Desktop/protocol checks block drafts and active work, confirm the affected identities, retain chat drafts, and make removed chats unavailable without rebinding. The agreed late-ignored-file race remains documented and tested: ordinary non-force Git removal can delete a file arriving after the last preservation check.

11. **Quit, interruption and recovery.** `tests/lifecycle.spec.ts` waits for an acknowledged persisted recovery draft, SIGKILLs the actual desktop host, changes disk externally, and verifies unsaved recovery/conflict handling, remembered state, cancellation, failed close-save and durable discard through restart. One packaged run acknowledged the draft 425 ms after typing began; the suite prints this measurement on each run. This is an observed sample, not a latency/durability promise. Active close/quit tests verify cancellation, interruption, process exit and reopening history without another turn. Real protocol-process tests kill resistant descendants, wait for opening/failed connections, and preserve other projects. Delayed IPC and file-close regressions check lifecycle races.

12. **Scoped unavailable states.** `tests/availability.spec.ts` removes the original checkout, crashes/restarts the app, checks its retained tab/recovery edits/chat draft and disabled send, uses another project, restores the exact original directory and explicitly retries. Another workflow fails the selected Codex executable, fails authentication and loses Git: history/drafts stay visible, explicit file saving works before and after restarting without Git, an existing chat reconnects independently of Git, and a wire log proves retry sent no extra turn. A separate secondary-worktree regression seeds an acknowledged recovery draft through the public persistence contract, restarts without Git, saves the recovered secondary buffer and verifies that original-checkout bytes and the saved chat association/draft remain unchanged. Previously approved canonical checkouts restore file capabilities independently of Git, including secondary checkouts identified by host-owned saved-chat associations; arbitrary view-memory roots do not confer that capability. Recovering Git revalidates directory/repository identity before enabling Git operations. Host tests separately cover absent executable discovery and reject new turns on missing/replaced checkout directories without losing history/drafts or blocking another checkout. Retry never creates a replacement checkout or changes saved associations.

## Failures resolved during this gate

- A connected chat could send into a missing or replaced checkout. The adapter now validates directory identity/access during connection setup and immediately before sending turns or responding to live requests. Stop remains available independently of checkout access.
- A failed Git refresh made an otherwise successful file save appear to fail. Git status now reports a scoped unavailable result with Retry Git, retaining file editing and existing chats.
- Specification review caught a remaining restart dependency on Git. Restoration now retains guarded file capabilities for previously approved canonical checkouts when Git cannot run, with lazy identity validation when Git returns. Host and packaged desktop checks cover saving after restart in this state.
- Security review found that renderer-persisted project entries could otherwise authorize arbitrary directories during Git loss. A separate host-owned approval ledger now records native chooser consent; restoration checks that ledger, secondary checkouts use immutable saved-chat associations, and project file operations protect session/approval/chat state files and their temporary replacements. Regression checks reject forged entries and state-file overwrites, then verify native reapproval recovers legacy buffers.
- An unavailable repository disappeared from the tab strip after restart. Saved project sessions now retain their tabs and read/draft access while live checkout capabilities require successful validation. Retry checkout restores access to the original directory.
- The development smoke test failed whenever port 5173 was occupied. Its isolated port is explicitly allowed by the development-only host origin/CSP validation.
- All Monaco worker requests used the generic editor worker. JSON/CSS/HTML/TypeScript worker assets now have their proper dispatch; the packaged JSON diagnostics test failed before this fix.
- File/diff editors lacked useful accessible names, and Monaco's initial diff option pass cleared side labels. Editors now use the standard textarea path with screen-reader support, named sides and native read-only semantics. Sidebar selections expose pressed state; conversation history is a named region. Polling no longer recreates an unchanged diff editor.
- The unavailable-state fixture tried to quit after disk replacement but before Save had finished its persistence/status work. The app correctly prevented closing during that operation, leaving the test waiting for an exit. The fixture now waits for completed Save UI before teardown, and resolves close prompts consistently with the other smoke workflows.
- Project-opening fixtures continued after clicking Open project before asynchronous approval and selection completed. They now wait for the selected project header before issuing IPC, editing another project's file, or restarting; the affected workflows passed three consecutive repetitions.

## Accessibility evidence and remaining manual validation

`tests/accessibility.spec.ts` navigates two project tabs and sidebar modes using Tab/Enter, edits and saves a file, leaves Monaco using Ctrl+Shift+M, opens its read-only diff, reads the accessible diff viewer with F7 and Escape, retains focus across polling, sends a chat message and answers its exactly scoped input request using the keyboard.

Native macOS accessibility inspection of the packaged app exposed project/view/file toggle states and an `a.txt editor` with its text value. The mechanical rendered UI detector returned no findings. Attempts to access VoiceOver itself returned `Computer Use server error -10005: timeoutReached`; the user then explicitly requested skipping further VoiceOver checks and will validate it separately. No VoiceOver speech/output pass is claimed.

With VoiceOver enabled, validate:

1. Project and Files / Source Control / Chats navigation announce the correct names, selected state and checkout context without unexpected focus changes.
2. File text is read and editable; Cmd+S saves; Ctrl+Shift+M allows Tab to leave Monaco and continue through app controls.
3. Read-only staged/unstaged/untracked diffs are understandable; F7 / Shift+F7 read changes, Escape returns to the diff, and refresh preserves focus.
4. Saved history, running/needs-input states, permission controls and question fields are announced. Answers and Stop affect the originating chat while switching projects or handling background work.
5. Native Save / Discard / Cancel and Stop and Close prompts are announced, cancellation retains work, and focus returns to a usable control.

## Upgrade from earlier builds

Saved roots without a host approval record remain visible with their available recovery buffers. Choose the original directory through **Open project…** once to approve it; the project view reloads its retained buffers and chats. Approval records are written only by the native chooser path, separately from renderer-controlled workspace data. Unapproved tabs can still be closed with the ordinary dirty-buffer handling.

## Limits

This evidence covers one arm64 macOS host and the stated installed tools. Signing, notarization, Gatekeeper distribution, Intel macOS and other OS releases are unverified. Crash recovery before IPC delivery/acknowledgement, machine power loss and arbitrary storage failure have no durability guarantee. Deliberately daemonized descendants outside the owned process group are outside the shutdown guarantee. The previously agreed save/removal race limits remain in force. Historical slice evidence in [desktop.md](desktop.md) retains its original scope; this integrated record supersedes those slices' remaining implementation deferrals, with VoiceOver explicitly left to the user.
