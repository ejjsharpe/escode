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

## Fresh combined merger qualification

The isolated `t3/merge-fresh-spec` checkout fast-forwarded from integration
`c03fe1c04053722fab95f8c9e0aa858d0341c7d2` to composer commit
`788e8a8f5e61546eb4fe0034abc04f7ecd5f4e62`, then merged the concurrent
permissions integration tip `e09a0e23cc43ef504d3e6d2340506276557eaa41`
without conflicts (merge `626db58`). No integration ref, PR or issue was changed.

- Combined merged-tree typecheck, lint and build passed.
- Focused host checks passed: 42 tests, one opt-in skipped, across
  `project-drafts`, `worktree-drafts`, `chat-commands`, `models` and `permissions`.
  These retain first-Send admission, reservation failures, cancelled preparation,
  retry/no-reallocation and captured next-message settings coverage.
- Combined Electron run with a 120-second per-test limit: 15 passed, one timed
  out across Agents, titles, models, permissions, project drafts, scratch and
  worktree drafts. The retained trace located the project-draft timeout at the
  restart `app.close()` after its draft/context assertions passed. The test had
  handled native quit confirmation only in final cleanup. Adding the same
  confirmation handler before that restart made the unchanged scenario pass in
  14.8 seconds (15.2-second standalone run). The earlier pre-permissions run had
  the same timeout, with 14 other scenarios passing. Both timed-out test-owned
  Electron processes needed termination to release worker cleanup; neither run
  is counted as a wholly passing suite.
- Together the final combined run and corrected standalone rerun provide passing
  evidence for all sixteen targeted scenarios. They cover focused composer
  defaults, original/remembered exact checkout identity, checkout-local capture,
  unavailable/restarted draft retention, text preservation without allocation,
  first-Send binding, read-only bound context, independent editor navigation,
  archive/title/recency coexistence and future-only model/permission edits.
- No production correction was required. The only follow-up change is native
  confirmation handling in the existing Electron test. No new test seam,
  dependency or product concept was introduced.

Limits remain development Electron with controlled provider fixtures; no new
packaged, installed-provider, manual VoiceOver or full-parent acceptance is
claimed. Screenshots and the failed-run trace are local test artifacts, not
committed evidence. Latest integration ancestry was rechecked before reporting.
