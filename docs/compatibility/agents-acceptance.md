# Integrated Agents acceptance evidence — issue 37

Verification for [Integrated Agents acceptance](https://github.com/ejjsharpe/escode/issues/37), applying the fourteen scenarios of [the Agents specification](https://github.com/ejjsharpe/escode/issues/26) together with [the accepted v1 baseline](v1-acceptance.md). Historical baseline VoiceOver acceptance is preserved; it does not cover the new controls.

**Status: the Agents workflow is accepted within the tested scope below. The user confirmed the remaining manual VoiceOver gate on 2026-10-29 for the built app at `0347eaf4abe355a598752dff63bb72320e425570`.** Earlier pending/review states below describe the implementation chronology. This three-document acceptance update remains uncommitted for fresh Ponytail review; the parent will close issues 37/26 only after approved documentation is merged and pushed. No runtime behavior, test evidence or product terminology changes in this update.

## Provenance and reproduction

Assigned worktree: `/Users/elliotsharpe/.t3/worktrees/escode/t3-da7685e9`, branch `t3/issue-37-acceptance`. Original implementation/R1 baseline: `5c4e7522c10e689d0b7f95e4102ba4d5ba2e8f7d`. Reconciled verification base: **`f1ee9449bdecbd944046ed431296d23e833b7a0d`**, the approved Files 40/41 integration (parents `5c4e7522c10e689d0b7f95e4102ba4d5ba2e8f7d` and `3ed89ca9162802cbb69cac9a89aba3ef0ba96764`). Main/origin/main and the advertised remote main matched this base at the start of reconciliation. The implementation was subsequently merged as `0347eaf4abe355a598752dff63bb72320e425570`, the revision used for the manual validation below. No other checkout or stash was modified by this implementer. Issue 37 was assigned to `@me` after `gh repo view --json nameWithOwner` verified `ejjsharpe/escode` and the tracker instructions were read. Issues 26/37 remain open. Completed maps and explicit user authorization govern implementation; no new map was opened.

Host on 2026-10-29: macOS 26.3.1 (25D2128), arm64; Bun 1.4.4, Node v26.13.0, Git 2.50.1 (Apple Git-155), installed codex-cli 0.165.0. Application 0.1.0, Electron 45.1.0, React 19.3.1, TypeScript 7.0.2, Vite Plus 1.4.0, Playwright 1.64.1, electron-builder 26.18.0; unchanged lockfile. Stable Codex >=0.163.0 still requires runtime protocol checks; this evidence covers 0.165.0 only.

Run from the assigned worktree, serially (live tests consume turns):

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
ESCODE_LIVE_CHAT=1 bun run test
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop test
bun run --cwd apps/desktop build
bun run --cwd apps/desktop package
ESCODE_PACKAGED=1 ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop smoke
ESCODE_PACKAGED=1 ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop smoke -- tests/chat.spec.ts --grep 'installed Codex accepts'
ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop smoke -- tests/chat.spec.ts tests/lifecycle.spec.ts tests/retained-project.spec.ts
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/retained-project.spec.ts tests/accessibility.spec.ts
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/availability.spec.ts --grep 'unavailable checkout retains' --repeat-each=3
bun run --cwd apps/desktop smoke -- tests/retained-project.spec.ts
git diff --check
```

Root typecheck/lint reused Nx cache; direct desktop invocations executed the checks afresh. The initial root host run passed; the final direct host run gives an uncached result for the amended tests. An accidentally overlapping duplicate host invocation was cancelled; no result is claimed from it. Build/package ran serially; no source/runtime behavior changed afterward. Only tests and evidence changed. Frozen install installed 468 packages; `bun pm untrusted` identifies the single blocked hook as electron-winstaller 5.4.0 (Windows packaging), which was not enabled. Build retains its large-chunk warning. Packaging produces an unsigned arm64 directory app, with existing missing-description/author and default-icon notices; signing/notarization is unverified.

## Original implementation results and corrections (before Files integration)

- Frozen install, direct TypeScript and lint, build, package and `git diff --check`: passed. Final checks ran after the test edits; runtime source and lockfile are unchanged.
- Final uncached `ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop test`: **116 passed, zero skipped, 14 files** in 46.64 seconds. Includes real settings, five-chat mixed concurrency/Stop, scratch byte/cwd retention and deferred-worktree provider acceptance. Raw log: `/tmp/escode-37-host-final.log`.
- Initial full packaged run: **37 passed** in 3.3 minutes, including installed Codex streaming, Files operations/recovery, layout, lifecycle and authorization races. The subsequently added live Electron case passed separately (**1 passed**, 10.2 seconds), with three actual installed-provider conversations/settings/fresh histories. Logs: `/tmp/escode-37-desktop.log`, `/tmp/escode-37-live-electron.log`.
- The final full packaged run discovered **38 tests**: **37 passed, 1 failed** in 2.8 minutes. All new mixed routing, keyboard, live Electron and scratch lifecycle checks passed. The existing unavailable-checkout crash fixture failed to restore the selected project because its file poll could observe an older snapshot before queued selection writes finished. This diagnosis is inferred from the visible restored selection and the persistence queue, rather than evidence of data loss after an acknowledged write. The fixture now waits for the visible selection and acknowledges the public lifecycle persistence checkpoint before SIGKILL. Its corrected targeted repetitions are recorded below. **A clean full 38-test run after that test-only correction is not claimed.** Log: `/tmp/escode-37-desktop-final.log`.
- The first unpackaged six-workflow run passed both installed-provider cases and all three lifecycle cases, but the new mixed fixture omitted `open` for its legacy immediate shared chat. That fixture was corrected to follow the existing connect-before-send contract. A subsequent packaged attempt caught a premature catalogue read; it now waits for five visible rows. The final full packaged run above passed the corrected mixed case. The expanded keyboard case separately passed in the packaged app. These were test setup corrections; no provider/context guard was relaxed.
- Final correction verification: `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/availability.spec.ts --grep 'unavailable checkout retains' --repeat-each=3`: **3 passed** (13.4 seconds). `bun run --cwd apps/desktop smoke -- tests/retained-project.spec.ts`: **1 passed** (5.4 seconds). Logs: `/tmp/escode-37-recovery-final.log`, `/tmp/escode-37-retained-final.log`. Every discovered workflow now has a passing result against its final test body, with the full-suite chronology/limit above retained.
- The first new live Electron attempt used a noncanonical temporary project path (`/var` versus `/private/var`). Native chooser approval correctly rejected the mismatch; the fixture now canonicalizes its temporary root. Subsequent packaged and unpackaged live runs passed with actual installed Codex 0.165.0.
- Crash-recovery samples acknowledged the draft 433 ms (initial package), 426 ms (final package) and 434 ms (unpackaged) after typing began. These are measured samples, not a guarantee for unacknowledged keystrokes.
- Inspected generated screenshots: packaged installed-provider conversation and 728×600 scratch/worktree drafts. Dark neutral surfaces, lavender selection, the flat sidebar and reachable scrolling composer remain intact. The full layout assertions cover the other stated viewports. Generated screenshots live in `apps/desktop/test-results/` and `/tmp/escode-34-draft.png`, `/tmp/escode-35-draft.png`; test runs may replace them. This is visual/keyboard evidence, not VoiceOver.

## R1 independent review and approved-base reconciliation

The parent supplied the fresh R1 review result for the **original nine-file patch**: **Ship**. Its independent full packaged run discovered all 38 tests, with **36 passed, two opt-in live skips and zero failures**; host checks were **112 passed, four opt-in live skips**; TypeScript, lint and diff checks passed. The reviewer found the acknowledged recovery checkpoint meaningful and corroborated the prior 116-test/live Codex 0.165.0 evidence. These are parent-relayed independent results against the original baseline, not new live runs or approval of the reconciled patch. They resolve the original full-suite coverage limitation above without inventing new manual VoiceOver evidence.

On explicit user authorization, incorporated approved base `f1ee9449bdecbd944046ed431296d23e833b7a0d` in this assigned worktree only. Before moving the branch, preserved a binary diff, all nine original file bytes with SHA-256 manifest, and the stash listing under `/var/folders/n4/62rjd1sj31s9v1gv1x74fr000000gn/T/escode-37-reconcile-0kepco6o`. Restored only the eight tracked patch files to the original HEAD, moved this branch to the already-existing approved commit using `git reset --keep`, applied the saved patch with `git apply --3way`, then unstaged it. No new commit or merge was created. The untracked evidence document and existing shared stash were retained throughout.

All eight tracked files applied cleanly with **no textual conflicts or substantive reconciliation fixes**. Compared the patch against the original backup: the same added acceptance assertions remain. A documentation-only follow-up corrects README’s live concurrency count from four to five and names the added No project context; there is no test/runtime change. The approved base's treeitem locators, specifically scoped status locators, file/tree view memory and migration tests, journal recovery and combined styles remain intact. Host chat runtime, auth/context first-Send guard, unknown-launch/no-replay behavior, exact request/Stop ownership, scratch/worktree ownership and lifecycle code have no issue-37 application-source delta. No Files worktree, root main ref, remote ref or stash was mutated. Files 42, including `812b1c5`, is outside this base/pass.

The reconciled-base verification used direct commands without Nx cache; its results are recorded separately from the historical runs above. At that stage fresh independent review was required before parent-controlled integration, and no new manual accessibility result was available. The implementation has since been integrated as `0347eaf4abe355a598752dff63bb72320e425570`; the later user confirmation is recorded below.

```sh
bun install --frozen-lockfile
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop test
bun run --cwd apps/desktop build
bun run --cwd apps/desktop package
ESCODE_PACKAGED=1 ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop smoke
git diff --check
```

### Reconciled-base results (2026-10-29)

- Frozen install: pass, checked 471 installs across 606 packages with no changes. Existing Electron install script ran; no manifest/lockfile change.
- Direct TypeScript/lint: pass. Logs: `/tmp/escode-37-reconciled-typecheck.log`, `/tmp/escode-37-reconciled-lint.log`.
- Uncached full host suite with `ESCODE_LIVE_CHAT=1`: **120 passed, zero skipped, 14 files**, 54.97 seconds. The four additional tests over the original 116 come from the approved Files base. This reruns installed Codex 0.165.0 against the combined host source; controlled failures remain controlled evidence.
- Build and unsigned macOS arm64 package: pass; existing large-chunk/default-icon/unsigned notices remain. Logs: `/tmp/escode-37-reconciled-build.log`, `/tmp/escode-37-reconciled-package.log`.
- Full packaged suite with `ESCODE_PACKAGED=1 ESCODE_LIVE_CHAT=1`: **54 passed, zero skipped, zero failures**, 3.9 minutes. This clean combined run includes all Files tree/inline, migration/recovery, keyboard/layout, mixed-request/Stop, project/scratch quit and both real installed-Codex Electron workflows. Packaged application PATH is restricted to `/usr/bin:/bin` (controlled tests add their temporary tool directory); installed-provider cases discovered actual Codex 0.165.0. This supersedes the original final-full-run limitation for the current reconciled tree. Log: `/tmp/escode-37-reconciled-desktop.log`.
- Acceptance-test patch line verification: every added/removed test line matches the preserved pre-reconciliation patch exactly; no acceptance assertion was removed or weakened. Index is empty and the saved stash inventory matches. `git diff --check` passes.

Inspected fresh `test-results/agents-728.png` and `test-results/files-tree.png` from this combined run: the approved Agents hierarchy and the approved Files tree layout remain intact. The crash-recovery sample acknowledged its draft 949 ms after typing began; this is an observation, not a durability promise. At completion of this reconciled run, no automated gate remained pending; fresh independent review and manual VoiceOver were the remaining steps. The implementation was subsequently merged, and the user-confirmed manual gate below completes acceptance.

## Fourteen scenario coverage

Each numbered item maps the parent scenario to reproducible Electron workflows and supporting host tests. Electron tests use the real window, preload IPC, host service and real filesystem/Git. Controlled providers are independent stdio subprocesses, not model simulation presented as live Codex. Public IPC seeds some arrangements; visible selections, text, requests, files and restored outcomes are asserted afterward.

1. **Shared identity.** `tests/agents.spec.ts`, `tests/project-drafts.spec.ts` and `tests/chat.spec.ts` assert global/local shared draft/history, one provider identity, creation-time retention, no duplicate accepted message on reconnect and no editor retargeting. `host/chat.test.ts` and `host/project-drafts.test.ts` check connection/session counts and no replay. The live packaged chat test actually streams, completes and opens fresh history.
2. **Flat catalogue/order.** `agents.spec.ts` tests Alpha/Beta, closed saved projects, equal timestamp ordering, original labels, independent selection and creation before the next poll. `retained-project.spec.ts` now combines a closed Alpha, Beta, Alpha original and managed checkouts, scratch and an unsent draft in one five-row catalogue; strong-label order survives approval/Stop. Scratch and project draft workflows cover local filtering and promotion order. `host/chat.test.ts` covers legacy relative ordering.
3. **Independent editor context.** `agents.spec.ts`, `navigation.spec.ts`, `retained-project.spec.ts`, `worktree-drafts.spec.ts` retain dirty Alpha buffers, Beta's view, global versus local checkout selection, reopen memory, closed-project Current checkout and stable draft targets. `host/workspace.test.ts` retains closed-editor membership and independent memories.
4. **Creation entry points.** `scratch.spec.ts` covers zero-target disabled New chat, Start without a project, one-project explicit No project and multi-target picker after scratch use. `project-drafts.spec.ts` and `agents.spec.ts` exercise global/contextual and project-local creation without reopening a project editor. No provider/scratch allocation occurs merely on opening drafts.
5. **Draft promotion.** `scratch.spec.ts` and `project-drafts.spec.ts` retain text/identity/time across context changes, project-local departure to Agents, restart and first Send; another nonempty draft survives. `host/project-drafts.test.ts` covers transition exclusion and provider-start counts. Both real overlapping IPC orderings still reject unauthorized context/provider cwd divergence.
6. **Project execution.** `worktree-drafts.spec.ts`, `worktrees.spec.ts`, `retained-project.spec.ts` test Current checkout, explicit reuse, closed-project deferred creation, displayed commit/path, preserved staged/unstaged/untracked/ignored/unsaved work, retained branches, and active/recovery/local-file removal blocks. `host/worktrees.test.ts` and `host/worktree-drafts.test.ts` cover real Git, occupied destinations, no silent reuse, durable reservations and partial failures. The opt-in host and new live Electron test send in newly prepared managed worktrees.
7. **Scratch/settings.** `scratch.spec.ts` proves two distinct non-Git paths, retained bytes and request routing without host Git. `host/scratch.test.ts` actually runs two installed-Codex scratch chats concurrently with a project chat, writes exact SCRATCH_0/SCRATCH_1 bytes, reconnects with one user message each and sends an explicit follow-up in the original path. The new live Electron test concurrently binds two scratch drafts plus a deferred project worktree through the packaged host and checks all three fresh histories. Effective settings observed in both scratch host and packaged runs: gpt-6.1-sol, xhigh, on-request, readOnly, networkAccess false. `host/acceptance.test.ts` separately asserts contrasting home/project settings and unchanged user/config bytes. These are observations, not a separate profile or sandbox guarantee.
8. **Close/reopen/live request.** `retained-project.spec.ts` exercises dirty background Alpha close cancellation, failed saving, continued work, exact Alpha approval in Agents while Beta/shared/scratch exist, protected removal and editor reopen. `lifecycle.spec.ts` checks closing selected project activates Agents without stopping work. No project-close Stop and Close prompt is expected; app quit still has that prompt.
9. **Mixed routing/Stop.** The amended retained-project test uses the same request ID 99 in four actual provider subprocesses, accepts scratch and managed Alpha requests through visible controls, verifies response bytes only in those cwd paths, Stops those chats and checks Beta/shared Alpha continue. `concurrency.spec.ts`, `chat-recovery.spec.ts`, `scratch.spec.ts` and host chat/recovery tests cover pending-Send requests, independent answer locks, stale response rejection, connection loss and Stop despite missing context. The amended live host concurrency test runs five actual Codex chats (two shared Alpha, managed Alpha, Beta, scratch), interrupts Alpha after command activity and verifies the other four finish. Deliberate approval/error cases remain controlled protocol evidence.
10. **Unavailable paths/tools.** `chat-recovery.spec.ts`, `availability.spec.ts` and `host/chat-recovery.test.ts` cover missing/replaced project and scratch directories, access denial, exact-path warnings, history/text retention, other usable chats, Git-independent recovery/save and explicit Retry without reconstruction/rebinding/replay. Missing Codex/authentication/Git are injected failures, not claims of live service outages. Stop remains independent of filesystem access.
11. **First-Send uncertainty.** `host/project-drafts.test.ts`, `host/scratch.test.ts`, `host/worktree-drafts.test.ts` inject pre-allocation failure, occupied destination, mkdir/ownership handoff, prepared worktree final-persistence failure, explicit thread rejection, unknown thread creation and accepted turn/lost acknowledgement. They assert retained prompt/provider identity/reservation/bytes and zero duplicate accepted messages after Retry/restart. Electron draft tests cover the real authorization/context-first and Send-first IPC races; deferred worktree UI retries load history without another turn. Real installed Codex confirms normal first-Send acceptance; artificial loss/uncertainty is controlled at host/protocol seams, not induced against the live provider.
12. **Quit/restart/retention.** Amended `lifecycle.spec.ts` starts project and scratch processes plus resistant descendants, retains scratch bytes/unsent text, keeps every PID alive through cancellation/failed save, then verifies interrupts and death of every recorded process on confirmed quit. Restart keeps scratch cwd/bytes/draft and stopped state with one sent turn. The same workflow retains managed worktree/branch/draft and closed editor memory. `scratch.spec.ts` adds pending requests and retained scratch bytes; `agents-files-recovery.spec.ts`, `file-operations.spec.ts` and crash lifecycle tests verify acknowledged recovery, conflict baselines and move intent recovery across restart. Fresh history opens are allowed; no automatic Send/resume is allowed.
13. **Earlier saved state.** `agents.spec.ts`, `agents-files-recovery.spec.ts`, `availability.spec.ts` and `host/chat.test.ts`, `host/workspace.test.ts` cover pre-Agents records without creation dates, closed/open projects, provider association, selected linked checkout, recovery drafts and separate host approvals. Unapproved roots stay visible but cannot gain authority from renderer state; native reapproval restores retained drafts. New drafts sort ahead of older entries.
14. **Layout/accessibility.** `agents.spec.ts` asserts the approved flat sidebar/conversation/composer geometry, long history, settings, empty/no-selection/draft/unavailable/error states at 728/1024/1100 widths and short windows. `scratch.spec.ts` and `worktree-drafts.spec.ts` cover new controls in a 728×600 window. `accessibility.spec.ts` exercises keyboard project navigation, Monaco escape, diff review, Agents → No project creation, reaching its context selector/composer, exact scratch input response and Stop; other Electron workflows use named native controls and selected states. New manual VoiceOver was required and pending after these automated checks; the later user confirmation below completes that gate. Neither these assertions nor a native accessibility tree provide manual evidence.

## Baseline twelve gates and lifecycle amendment

The historical [v1 record](v1-acceptance.md) remains unchanged. This run repeats its applicable gates against the integrated source:

1. Toolchain/package: frozen install, direct checks/build/package, `packaged.spec.ts` restricted-PATH CSS/Monaco worker/tool discovery and `development.spec.ts` private-port hot reload.
2. Project/view memory: `navigation.spec.ts`, `agents.spec.ts`, lifecycle restoration and deduplication.
3. Safe editing: `project.spec.ts`, `host/project.test.ts`, native helper and file-operation recovery checks.
4. Correct diffs: real Git host tests and project/navigation/accessibility read-only/refresh workflows.
5. Saved chats/Stop: installed-provider host concurrency, packaged streaming and fresh-history tests.
6. Concurrent scoped requests: mixed integrated workflow plus existing protocol and live host tests.
7. Effective settings: live isolated home/project settings assertions and scratch/package settings above.
8. Committed creation: host worktree tests, deferred Electron creation and packaged live first Send.
9. Explicit reuse/retention: worktree, navigation and mixed lifecycle workflows.
10. Protected removal: real Git host checks and closed-project active/recovery/local-file blocks.
11. Quit/recovery: mixed project/scratch cancellation, failed save, process groups, crash/conflict restoration. Deliberate amendment: closing an editor retains work in Agents; only app quit interrupts all work.
12. Scoped unavailable states: availability and chat-recovery host/Electron workflows, including approvals, exact original identity, independent file saving without Git and no replay.

The approved Files 40/41 base adds the lazy nested Files tree, checkout-local tree memory, New File/New Folder and inline Rename on top of native rename/move/Trash preservation. The reconciliation retains those controls and their migration, recovery and authority boundaries; scratch directories never become project Files roots. Combined Files/Agents evidence is in [files-agents-integration.md](files-agents-integration.md). No Files 42 code is included, and no accepted save/removal race guarantee has changed.

## Manual VoiceOver gate and safe launch

### User-confirmed acceptance (2026-10-29)

The user replied in the parent conversation, **“Yep all good with voiceover”**, in response to the parent's request to complete the linked seven-step checklist below. This is **user-confirmed manual acceptance**, completing the remaining manual gate for issues 37/26. No detailed per-step notes were supplied; no individual control utterances, per-control observations or agent-performed VoiceOver pass are asserted.

The parent reported that the dedicated built app was successfully built and launched from this assigned checkout after issue 37 was merged, at revision `0347eaf4abe355a598752dff63bb72320e425570`. The host is macOS 26.3.1, as recorded in the existing environment evidence. Validation used isolated app state at `/private/tmp/escode-agents-voiceover-jbv08fdf/app-state` and disposable Alpha/Beta repositories under the same parent directory. These artifact/launch details and the user's confirmation are relayed by the parent; this documentation update did not rebuild, relaunch or rerun tests.

At the earlier implementation stage, no genuine supported manual VoiceOver workflow was available to this implementer, so the gate was explicitly pending. Baseline v1's older user confirmation was not used to certify Agents. The new confirmation above supplies the missing manual evidence while retaining that chronology and all existing runtime/platform limits.

### Checklist and launch instructions supplied for validation

After parent-controlled integration, launch the reviewed application from the parent-confirmed integrated checkout. The concrete commands below use this assigned checkout for review; after integration substitute the confirmed checkout path on the first line and rebuild there. Record `git rev-parse HEAD` alongside the result so the manual report identifies the actual artifact. The shell must retain installed Git/Codex discovery. This launches a built development app with isolated escode state and no development server:

```sh
cd /Users/elliotsharpe/.t3/worktrees/escode/t3-da7685e9
git rev-parse HEAD
bun run --cwd apps/desktop build
cd apps/desktop
manual_data=$(mktemp -d /tmp/escode-37-manual.XXXXXX)
env -u ELECTRON_RUN_AS_NODE -u ESCODE_DEV_URL ./node_modules/.bin/electron . --user-data-dir="$manual_data"
```

Keep `manual_data` for restart checks; do not delete it while the app is running. This isolates escode workspace state, not Codex authentication/configuration/history. Use disposable Git projects and harmless prompts; actual Send uses installed Codex and consumes turns. Quit via the app before relaunching with the same `--user-data-dir`. No global user-data reset, cleanup or VoiceOver preference change is needed. Enable/disable VoiceOver using Cmd+F5 (or the system's configured shortcut).

1. From empty Agents, navigate by keyboard and VoiceOver. Hear Agents selected, ordinary New chat disabled, and Start without a project / No project. Open Alpha and Beta; hear their tab names/selected state and Files / Source Control / Chats.
2. Create project and No project drafts. Hear Project context and execution choices, resolved absolute checkout or displayed worktree base, draft status and composer label. Change context with typed text; confirm text survives and the selected row/context is understandable. Tab reaches all controls at a short window size.
3. Send a harmless prompt, navigate Agents ↔ project Chats, and confirm the same history/draft and running/ready status are readable. Global selection keeps editor context. Hear the actual project/No project path and effective settings.
4. With simultaneous harmless work, open an actual approval/input request if the installed policy produces one. Hear the originating chat, question/command and answer controls. Answer from Agents after closing that project's editor; confirm only that request resolves. If the provider produces no request, leave this manual check pending rather than claiming a pass.
5. Send “Run sleep 30, then reply done. Do not change files” in one chat and Stop it while another harmless reply runs. Hear Stop's originating context and state change, and verify focus is usable without being moved by background activity.
6. Close a dirty project: hear Save/Discard/Cancel; Cancel keeps edits/work. Close it successfully and hear Agents selected with its live chat still available. Reopen the project and confirm remembered context. Quit with mixed work: hear Stop and Close, cancel safely, then confirm quit and restart stopped.
7. Make a disposable bound directory temporarily unavailable externally. Hear the exact unavailable path, Retry guidance and retained draft; active Stop remains reachable. Restore the original directory and Retry without an automatic message. Record any missing names, wrong selected state, trapped/lost focus or unreadable request/history as a failure.

## Limits and review handoff

No new application source change was necessary in this acceptance pass. Added coverage uses existing public seams and test architecture. Artificial protocol failures, overlapping approval IDs, access denial and absent tools are controlled evidence. Live runs establish actual installed-provider acceptance/settings/history/interruption on this machine; they do not certify every provider policy, sandbox, OS or admitted Codex version. Best-effort recovery begins from acknowledged persistence, not an arbitrary final keystroke. Existing check-before-save/removal races and daemonized descendants outside owned process groups retain their historical limits.

The implementation and its acceptance checks were merged as `0347eaf4abe355a598752dff63bb72320e425570`; the earlier uncommitted/review handoff is historical. Only the three documentation files listed below are now uncommitted for a NEW independent Ponytail review. No runtime/test edits or reruns were needed for this user-confirmation update. Diff, local-link and status consistency checks passed. This update performs no commit, merge, push, PR, issue closure, delegation, other-worktree mutation or stash mutation. The parent retains issue closure until the approved documentation merge is pushed.


## Exact change manifest

The following is the historical implementation manifest, merged at `0347eaf4abe355a598752dff63bb72320e425570`; the current three-file documentation update is listed afterward.

- `apps/desktop/host/chat.test.ts`: extend the installed-Codex concurrent/Stop gate with a fifth scratch chat; retain existing shared/separate/project assertions.
- `apps/desktop/tests/chat.spec.ts`: opt-in installed-provider Electron first Send for two scratch drafts and one deferred worktree; fresh history/settings and three distinct bound directories.
- `apps/desktop/tests/lifecycle.spec.ts`: include scratch processes/resistant descendants, retained bytes and unsent draft in dirty-file cancellation, failed saving, confirmed quit and stopped restart.
- `apps/desktop/tests/retained-project.spec.ts`: integrated Alpha original/managed, Beta, scratch and unsent draft; overlapping request IDs, visible approvals/Stop, exact response cwd bytes, stable order and independent background work.
- `apps/desktop/tests/availability.spec.ts`: establish an acknowledged selected-project checkpoint before the crash/recovery assertion, avoiding a stale on-disk snapshot witness.
- `apps/desktop/tests/accessibility.spec.ts`: extend keyboard navigation through Agents and No project context/composer, request answer and Stop; controlled interruption completion.
- `README.md`, `GLOSSARY.md`: linked integrated evidence and recorded the then-pending manual VoiceOver gate; the current confirmation supersedes that historical status.
- `docs/compatibility/agents-acceptance.md`: this integrated scenario/baseline map, runtime results, manual checklist and review handoff.


## Current documentation update manifest

- `docs/compatibility/agents-acceptance.md`: record the dated user confirmation, exact artifact and isolated-state provenance, lack of detailed per-step notes, and current acceptance/review status; preserve historical runtime evidence and limits.
- `README.md`: state Agents acceptance with the dated user-confirmed manual result and artifact revision.
- `GLOSSARY.md`: align the bounded acceptance status with the new Agents confirmation, separately from baseline v1.
