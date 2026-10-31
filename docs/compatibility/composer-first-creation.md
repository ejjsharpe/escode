# Composer-first creation (#150)

Implemented under the [Agents sidebar specification](https://github.com/ejjsharpe/escode/issues/144) and [creation ticket](https://github.com/ejjsharpe/escode/issues/150), 2026-10-31.

Agents New chat creates a saved draft and focuses its composer directly. It reads the existing saved-project targets after flushing client navigation, chooses the most recent editor-use entry with a remembered checkout, and otherwise uses the saved original checkout or No project. Selecting Agents conversations and creating drafts no longer promote editor recency. Checkout-local creation continues to pass the exact checkout to the existing host action.

Project and checkout edits reuse the existing authenticated draft actions and client composer storage. Missing project identities retain a selectable unavailable option. Exact checkout paths and branch/copy actions are expandable; the shared-files warning remains visible. Project controls are compact, and existing deferred-worktree controls retain the displayed local base and first-Send reservation lifecycle. Binding, resources, Stop, retry and durable Send remain owned by their existing host paths. Bound chats have no context selectors. Model/effort controls and merged archive actions remain integrated; permission qualification belongs to #152.

## Verification

- TDD red: updated Electron creation/defaults scenario failed because New chat still opened Choose project. The revised behavior passed with focused composition and retained unavailable checkout identity after restart.
- Build, typecheck, lint and diff whitespace checks passed. Lint retains existing warnings outside this slice.
- Focused host suite: `bun run --cwd apps/desktop test -- host/project-drafts.test.ts host/worktree-drafts.test.ts host/chat-commands.test.ts`: 40 passed, one opt-in test skipped.
- Merged Electron run of Agents, project drafts, scratch and worktree drafts: six passed; two failed on obsolete navigation selectors. Updated selectors preserve the original assertions (activity suffix on Chats; visible navigation scope; first-message title after Send).
- Final bounded rerun: project drafts and deferred worktree drafts both passed (15.6 and 21.2 seconds; 37.2 seconds total, 120-second per-test limit). Combined with the six passing merged scenarios, all eight targeted scenarios have passing evidence. These check exact non-default checkout capture, context/text edits, restart, immutable binding, one task turn, reservation identity, original files and recovery buffers, and active-resource removal rejection. The restored unavailable-selection persistence assertion also passed independently.
- Screenshot `apps/desktop/test-results/composer-first-default.png` was inspected after compact-control changes. Existing tests also capture narrow draft and bound views.

## Limits

This is fixture-driven development Electron qualification, not packaged-app, installed-provider or manual VoiceOver acceptance. One intermediate project-draft rerun exceeded the default 45-second test budget; the bounded follow-up passed. Earlier focus and obsolete picker/title/locator failures were corrected, not counted as passing runs. Creation tests now await the new blank composer before changing its context; changing the still-visible previous draft had cleared its deferred-worktree choice, which the retained reservation assertion caught. Broader model/permission qualification and full parent acceptance remain with the parent effort.

Based on isolated `t3/composer-first-creation` at `8ab8812`; merged integration tip `c03fe1c` without updating the integration ref. No PR or issue state was changed.
