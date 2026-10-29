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
