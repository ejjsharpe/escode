# Agents: existing project-backed chats

This is bounded evidence for [Open and continue existing chats from Agents](https://github.com/ejjsharpe/escode/issues/31), under the [Agents specification](https://github.com/ejjsharpe/escode/issues/26). It does not certify the full fourteen-scenario amendment.

Implementation baseline: `4074446747fd67e99d783cbc9c580ac304ad369e`. Verified on macOS 26.3.1, Bun 1.4.4, Node 26.13.0 and Electron 45.1.0, on 2026-10-29.

## Delivered scope

Agents is the permanent leftmost navigation button. Its flat list opens existing saved project-backed chats through the same renderer store and conversation component as project Chats. Global selection persists separately and leaves the editor's checkout, mode, selections and buffers intact. Project-local selection still follows the chat's checkout.

Saved project registration is stored separately from open editor tabs. Migration retains old open projects and reconstructs historical registration from host approval records and saved chat identities. Registration grants no directory authority: native chooser approvals remain separate host-owned records. Unapproved chats stay visible with retained text and guidance to approve the directory. Existing chat actions retain host-owned chat/checkout associations and sender, identity and argument checks.

New chats receive a creation timestamp. Earlier chats keep only their relative append order, with no invented creation date. Agents and project-local Chats use the same newest-first comparator without changing their original chat labels or identities. Both orders are stable across loading, draft edits and history reopening; equal creation times use chat identity as a tie-breaker. Existing chat/provider IDs, draft text, view memory and recovery baselines remain readable.

Creation remains in project Chats. Project-close still confirms and stops active work; continuing work after editor closure, new draft creation/context changes and No project execution belong to later slices. No product concept changed, so GLOSSARY.md is unchanged.

## Checks

- `bun run typecheck`: pass.
- `bun run lint`: pass.
- `bun run --cwd apps/desktop test`: 67 passed, 2 skipped across 8 files (7 passed, 1 skipped). Live Codex tests are opt-in.
- `bun run build`: pass.
- `bun run package`: pass (unsigned local macOS application).
- `bun run --cwd apps/desktop smoke`: **22 passed, 1 skipped** (live Codex), 0 failures after the independent-review fixes. Includes the rebuilt packaged application.
- `git diff --check`: pass.
- Impeccable mechanical detection over changed UI targets: no findings.

`tests/agents.spec.ts` uses two real temporary repositories, a real linked worktree, a closed saved project and legacy records with provider identities. It verifies shared text/history, one connection across entry points, global versus local checkout selection, dirty-buffer retention, stable list order, unapproved identity rejection, malformed catalogue arguments, restart selection/text/recovery and no automatic Send. A separate seed retains an unavailable remembered chat selection. Enter activates Agents through keyboard focus. Layout captures are generated at 1100, 1024 and 728 pixels; the normal and narrow renders were visually inspected against the approved dark-neutral/lavender interaction study.

`tests/concurrency.spec.ts` additionally visits Agents while Send awaits acknowledgement, then preserves the prerequisite regression: approvals and input remain answerable before Send acknowledgement, per-request response locks survive remount, duplicate form submissions produce only one response, overlapping IDs stay with their originating session, Stop remains scoped and stale responses fail. Existing navigation, availability, lifecycle, accessibility, worktree, development and packaged workflows provide regression coverage.

Earlier verification runs exposed outdated empty-workspace/tab-count assertions and a close test that waited only for the now-permanent Agents button. The assertions now identify project tabs and wait for completed project closure before checking shutdown.

## Independent review fixes

The fresh review found two defects: long histories expanded the Agents document and displaced the composer, and local Chats retained append order while Agents showed newest first. Both were corrected within the existing-chat slice.

Agents now fills the remaining window space with shrinkable grid/flex children. Its transcript (including live request controls and errors) owns scrolling; the conversation heading, actions and composer stay in the panel. The Electron history fixture returns 150 lines. At 1100 × 768, the regression asserts that document height stays within the viewport, the composer remains fully within it, history actually overflows and scrolls, and scrolling changes neither the heading nor composer geometry. Narrow 728- and 1024-pixel captures also assert viewport containment. The long-history render was visually inspected.

Local Chats now sorts a copied list using the existing shared comparator, while labels still derive from original chat identity/order. A dedicated Electron workflow seeds a legacy chat and two timestamped chats and asserts `Chat 3, Chat 2, Chat 1` in both entry points. It verifies preserved selected identity/text and stable order during selection, Send, Needs input and Stop/completion.

`bun run --cwd apps/desktop smoke -- tests/agents.spec.ts tests/concurrency.spec.ts`: **4 passed** after these fixes. The delayed-Send approval/input and response-lock regression remains green. The host suite passed again with **67 passed, 2 skipped**; typecheck, lint, build and package passed again. The final full Electron suite passed **22 tests with 1 live-Codex skip**. Mechanical UI detection returned no findings.

The first fix pass changed `apps/desktop/src/chat.tsx`, `apps/desktop/src/style.css`, `apps/desktop/tests/agents.spec.ts` and this evidence record. All earlier uncommitted implementation changes are retained.

## Expanded-settings review fix

The second fresh review confirmed the history containment and shared ordering fixes, then found that expanded Effective Codex settings still displaced the composer. The settings disclosure now lives inside the existing transcript scroll area alongside messages, requests and errors. This is a markup move; no additional sizing rules or state changes were needed. The heading, actions and composer remain outside that scrolling area.

The 150-line history fixture now supplies ordinary workspace-write settings with writable roots, reasoning and sandbox flags. At 1100, 1024 and 728 pixels wide, all at 768 pixels high, the Electron regression opens the settings and asserts a transcript height of at least 80 pixels, no document overflow, full composer visibility and actual visibility of the final history line after scrolling. Heading and composer geometry stay unchanged while history scrolls. The expanded-settings render at 1100 × 768 was visually inspected.

Neighboring expandable and large content were checked: MCP schema details and approval/request text are already inside the same scrolling area. The activity/order workflow now expands a 100-field MCP schema, scrolls to its response control and asserts that the request remains reachable, the history area stays usable and the composer stays fully on screen. Existing order/selection/activity checks and the delayed-Send approval/input response-lock regression remain intact.

After this fix, `bun run typecheck`, `bun run lint` and `bun run build` passed. Focused Electron checks (`bun run --cwd apps/desktop smoke -- tests/agents.spec.ts tests/concurrency.spec.ts`) passed all **4 tests**. The host suite passed again with **67 passed, 2 skipped**. Mechanical UI detection returned no findings. `bun run package` passed again, and the final full Electron rerun (`bun run --cwd apps/desktop smoke`) passed **22 tests with 1 live-Codex skip and 0 failures**. `git diff --check` also passed.

The expanded-settings round changed `apps/desktop/src/chat.tsx`, `apps/desktop/tests/agents.spec.ts` and this evidence record, preserving the stylesheet and all other uncommitted #31 work.

## Native composer resize and size-constraint audit

The third fresh review confirmed the previous fixes, then reproduced native textarea resizing displacing Send below the clipped panel. Agents now disables native composer resizing. Long prompts retain the normal 100-pixel textarea and scroll internally. Project-local textarea resizing is unchanged.

The regression uses actual Playwright mouse down/move/up gestures at Chromium's native resize handle, without assigning inline size or resize styles. A positive control first grows the existing project-local textarea by dragging its handle. Before the Agents fix, the new assertion failed because the same gesture grew its textarea from 100 to 280 pixels. After the fix, three repeated downward drags at each of 1100, 1024 and 728 pixels wide (768 high) retain the textarea height, a usable transcript and fully visible Send. A 400-line prompt remains intact and scrollable throughout.

The constraint audit found no declared native minimum width/height in the host window configuration. The approved study and existing checks validate widths down to 728 pixels; the full pinned layout is checked at 728 × 768. A shorter 728 × 600 stress case now has a scrolling conversation-panel fallback instead of clipping: the transcript keeps at least 80 pixels, and users can scroll to both history and the complete composer. This does not impose a new native window minimum or change other editor surfaces.

The audit also exercises expanded workspace-write settings with 150 history lines, a large expanded MCP schema and a 200-line provider error. Large request controls are checked at both 728 × 768 and the shorter stress height; the large error is checked at the shorter height. In each case, the content and Send remain reachable. Variable-sized settings, requests and errors are contained in the transcript; only fixed context/actions/composer occupy the outer panel. The short-window error render was visually inspected.

This round changes exactly `apps/desktop/src/style.css`, `apps/desktop/tests/agents.spec.ts` and this evidence record. The production change consists of disabling Agents composer resizing, retaining a minimum usable transcript and allowing the outer panel to scroll when its fixed content cannot fit. All earlier #31 work remains uncommitted; no Files work, branch or HEAD changes are included.

The initial focused Electron run passed **4 tests**, including the native resize and delayed-Send response-lock checks. Typecheck, lint and build passed; mechanical UI detection returned no findings. Final checks passed: `bun run typecheck`, `bun run lint`, `bun run --cwd apps/desktop test` (**67 passed, 2 skipped**), `bun run package` (including the build), and `bun run --cwd apps/desktop smoke` (**22 passed, 1 live-Codex skip, 0 failures**). `git diff --check` passed; branch `main` and HEAD `4074446747fd67e99d783cbc9c580ac304ad369e` are unchanged.

## Files for review

- `README.md`, this evidence record.
- `apps/desktop/host/chat.ts`: creation metadata and legacy relative order.
- `apps/desktop/host/main.ts`: saved registration migration, catalogue and approved access independent of editor selection.
- `apps/desktop/host/workspace.ts`: optional saved registration and Agents selection with validation.
- `apps/desktop/src/agents.tsx`, `src/chat-order.ts`: global list/navigation and deterministic ordering.
- `apps/desktop/src/chat.tsx`, `src/main.tsx`, `src/style.css`: shared conversation entry, permanent Agents tab, independent selection and approved visual hierarchy.
- `apps/desktop/host/agents.test.ts`, `tests/agents.spec.ts`: migration/order and Electron workflows.
- `apps/desktop/tests/concurrency.spec.ts`, `tests/navigation.spec.ts`, `tests/lifecycle.spec.ts`, `tests/lifecycle-races.spec.ts`: routing regression and permanent-tab expectations.

## Limits

Provider behavior in the new workflow is simulated using Codex 0.165.0 protocol fixtures; no new live authenticated Codex turn was consumed. New Agents controls have keyboard automation but no manual VoiceOver certification. Existing v1 VoiceOver evidence does not certify Agents. The approved prototype was used as design authority, without importing its demonstration controls or future features.

All changes are left uncommitted for fresh independent Ponytail review and the subsequent merge agent. The implementation agent does not commit, push, create a PR, close the issue or claim full Agents acceptance.

## Project editor lifetime (#32), reconciled with Files

The #32 implementation is based on approved Files main commit
`f08183dfac74e805cd51dca64e50dd2675f5a2e6` (initial baseline
`2e453812759cde9eecab1a73e5eb3c179cc24b83`). Changes remain uncommitted in the
assigned worktree for fresh independent review.

Project close resolves file Save/Discard/Cancel and removes only editor membership.
Saved registration, host approval authority, checkout objects, shared conversation
state and live requests remain available. Selected closure activates Agents;
background closure preserves selection. A project tab supports middle-click and
focused Delete/Backspace closure, with the shortcut in its tooltip. Reopening via
any linked checkout restores the saved original checkout and independent memory.
Quit still confirms active work and shuts down every app-owned session, including
closed projects and descendant process groups.

Files reconciliation keeps the existing lifecycle-load composition of recovered
disk state with derived saved registration. Native file mutations retain sender,
approved project ownership, quitting, source identity, protected state and idle
checks; editor closure no longer revokes saved-project authority. No Files recovery
or mutation implementation was replaced. A combined regression seeds a closed
project with an interrupted move and recovery draft, verifies path reconciliation
and closed membership across crash/restart, reopens through a linked worktree and
checks ordinary save-conflict protection against external edits.

Validation on the reconciled base:

- `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`,
  `bun run package`, and `git diff --check` passed.
- `bun run --cwd apps/desktop smoke -- tests/lifecycle.spec.ts tests/lifecycle-races.spec.ts tests/concurrency.spec.ts tests/navigation.spec.ts tests/worktrees.spec.ts tests/agents.spec.ts tests/agents-files-recovery.spec.ts tests/file-operations.spec.ts tests/retained-project.spec.ts`:
  18 passed. This includes #30 pending-Send approval/input response guards and
  #31 order, shared-state, navigation and layout regressions.
- `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/packaged.spec.ts tests/lifecycle.spec.ts tests/agents-files-recovery.spec.ts tests/retained-project.spec.ts`:
  7 passed with the restricted packaged PATH.
- An additional lifecycle assertion then verified failed dirty-file saving during
  app quit leaves the editor and live processes intact; all 3 lifecycle tests passed.

The new retained-project regression covers dirty background close cancellation,
failed save, discard, live approval response through Agents, scoped Stop while
another project runs, retained-chat worktree removal protections for active work,
recovery drafts and local files, and reopening the same editor context. Lifecycle
checks cover saving on close, quit cancellation for closed-project work, descendant
shutdown, restored closed membership and no turn replay. A host workspace test
covers independent durable catalogue/membership, selections, recovery baselines,
approvals and rejected invalid recovery updates.

Provider behavior uses controlled Codex 0.165.0 protocol fixtures with real processes,
Git repositories and filesystems. No new live Codex turn or manual Finder/VoiceOver
validation was performed. These results establish this bounded slice, not full
Agents/No project acceptance. Any later substantive integration fix requires
combined tests and fresh review again.

Final verification also reran the expanded lifecycle suite in the packaged app:
3 passed, including the failed-save quit case. Final typecheck, lint and whitespace
checks passed again.

Exact #32 review files (relative to this worktree):

- `README.md`, `GLOSSARY.md`, `docs/compatibility/agents-existing-chats.md`.
- `apps/desktop/host/main.ts`, `apps/desktop/host/workspace.test.ts`.
- `apps/desktop/src/main.tsx`.
- `apps/desktop/tests/agents-files-recovery.spec.ts`.
- `apps/desktop/tests/concurrency.spec.ts`.
- `apps/desktop/tests/lifecycle-races.spec.ts`.
- `apps/desktop/tests/lifecycle.spec.ts`.
- `apps/desktop/tests/retained-project.spec.ts` (new).

The pre-Files safety stash is retained at
`7b4a2120bfc0a749a018d8e0d4639117bcd5ede1`; it is a backup, not the final combined
patch. The working directory contains the complete reconciled changes. No #32
commit, push, PR or issue closure was performed.
