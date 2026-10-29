# Saved project drafts

Bounded implementation evidence for [Create saved project drafts and bind them on first Send](https://github.com/ejjsharpe/escode/issues/33), under [the Agents specification](https://github.com/ejjsharpe/escode/issues/26). This does not certify the full amendment. Baseline: `e2d5e07116d4dd512812b96e6828dc2551cbf407`; macOS, Electron 45.1.0, Codex 0.165.0, 2026-10-29.

Agents creates drafts from saved projects without opening editor tabs. Multiple project targets use a picker and offer a contextual shortcut; project Chats supplies its own project. No project/zero-target creation belongs to #34. Current checkout resolves from the host's saved project editor memory, including closed projects, with the saved original root as fallback. Its absolute path is retained until an explicit context change or Use current checkout action. Existing worktree creation/reuse remains available through its established project controls; adapting preparation into the draft flow belongs to #35.

New drafts save identity, actual creation time, project, resolved path and text. Untouched empty drafts can be reused only for the same context/path; a text-bearing draft is never overwritten. Changing projects preserves text and moves a local draft into Agents. Both views use the shared renderer store. First Send validates host-approved repository membership before provider startup, binds the existing identity, persists the returned thread identity and submits the message. The context controls disappear after binding. Legacy records retain their provider identity, including known unsent threads: reconnect attempts that identity instead of starting a replacement.

Persistent first-Send bookkeeping distinguishes preparation, provider creation, definite nonacceptance, uncertainty and acknowledgement. A protocol rejection is distinguished from transport loss. Prompt and known identity survive failures. Retry and restart never submit a message. Known provider threads reconnect and read history; an unknown provider-creation outcome with no returned thread ID blocks replacement creation and discloses that uncertainty. Codex may not retain an empty provider thread after disconnect; an unavailable known thread remains bound and reports the provider error rather than silently replacing it. There is no automatic reconciliation that resumes work.

## Verification

`host/project-drafts.test.ts` uses real temporary storage and controlled protocol peers. It covers text-bearing context changes, protection/reuse of other drafts, no provider allocation on opening, stable identity/time/path, pre-preparation failure, definite and uncertain provider-creation failures, turn rejection, accepted-message acknowledgement loss, restart and Retry without replay, retained history and legacy unsent provider identity. Existing host chat/routing, worktree, workspace and Files tests remain regression checks.

`tests/project-drafts.spec.ts` uses real Git repositories and a linked checkout with a controlled provider. Both editors begin closed. It checks the project picker, text-preserving context changes, the remembered linked Current checkout, another nonempty draft, restart before promotion, one accepted initial message, fixed identity/path after promotion and Retry without replay. It also moves a local Chats draft into Agents and checks retained text. Draft and bound renders were inspected; narrow 728 × 600 controls remain reachable through the existing conversation scroll area. Native select controls have explicit labels and focus styling.

Live `ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop smoke -- tests/chat.spec.ts` passed with installed Codex **0.165.0**. It creates a saved draft, explicitly sends one prompt, checks streamed user/agent messages, reloads via fresh connections and verifies exactly one user message with retained unsent text. Failure injection uses simulated peers, not a claim of real Codex transport failure.

Typecheck, lint, build, package, full host and Electron results are recorded in the implementation handoff. New controls have automated keyboard coverage; **no new manual VoiceOver evidence** is claimed. Scratch, deferred worktree preparation, broader availability and full integrated acceptance remain their separate slices.

## Recorded results

- `bun run typecheck`, `bun run lint`, `bun run build`, `bun run package`, `git diff --check`: passed. Package is an unsigned local macOS application.
- `bun run --cwd apps/desktop test`: **91 passed, 2 skipped** across 11 files (10 passed, 1 skipped). The final draft-path validation change was additionally checked with `host/project-drafts.test.ts host/chat.test.ts`: **15 passed, 1 opt-in skip**.
- `bun run --cwd apps/desktop smoke`: **29 passed, 1 opt-in live skip**. This includes Files preservation/recovery, closed-project sessions, migration, worktrees, keyboard controls, availability, routing and packaged launch.
- After the final pending-Send status refinement, `tests/concurrency.spec.ts tests/project-drafts.spec.ts`: **2 passed**, including independent request-response locks and visible Needs input while acknowledgement is pending.
- `ESCODE_PACKAGED=1 ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop smoke -- tests/chat.spec.ts tests/project-drafts.spec.ts`: **2 passed**, using the rebuilt package with restricted PATH and installed Codex 0.165.0. The same live chat workflow also passed unpackaged.

No main advancement was observed: both local main and this worktree's HEAD remained `e2d5e07116d4dd512812b96e6828dc2551cbf407`. Work remains uncommitted for independent review.

## Changed manifest

- `README.md`
- `GLOSSARY.md`
- `apps/desktop/host/chat-service.ts`
- `apps/desktop/host/chat.ts`
- `apps/desktop/host/main.ts`
- `apps/desktop/host/tools.ts`
- `apps/desktop/host/chat.test.ts`
- `apps/desktop/host/project-drafts.test.ts` (new)
- `apps/desktop/src/agents.tsx`
- `apps/desktop/src/chat-state.ts`
- `apps/desktop/src/chat.tsx`
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/style.css`
- `apps/desktop/tests/accessibility.spec.ts`
- `apps/desktop/tests/agents.spec.ts`
- `apps/desktop/tests/availability.spec.ts`
- `apps/desktop/tests/chat.spec.ts`
- `apps/desktop/tests/concurrency.spec.ts`
- `apps/desktop/tests/lifecycle.spec.ts`
- `apps/desktop/tests/project-drafts.spec.ts` (new)
- `docs/compatibility/project-drafts.md` (new)

## Independent review: authorization/context race

The fresh review identified a gap between host checkout authorization and the service's later draft read. The new overlapping Electron IPC test reproduced it against the previous build: while Send's host validation was suspended in real filesystem IO, a same-project context change selected an unrelated, unapproved directory. The controlled provider then logged `initialize`, `account/read`, `thread/start` and `turn/start` in that directory. This was a failing regression, not live Codex evidence.

Send now acquires a per-chat exclusion guard before reading its saved draft and invoking the host's authorization callback. Provider setup consumes that same frozen saved snapshot. The guard remains held through binding/submission; competing context/setup operations fail explicitly instead of being queued or replayed. Context changes, history connection setup and unavailable marking use the same guard. The public history-open operation cannot invoke the internal first-Send path reentrantly.

The adjacent-path audit covered every chat store/session caller. Creation adds a new record or returns an untouched empty draft without changing its context; workspace persistence changes editor memory, not the captured chat target. Migration does not rewrite checkout paths. Draft-text writes and live request responses remain independent of the context guard. Snapshot and control reads no longer create retained placeholder sessions; failed stale-owner setup calls discard empty placeholders, so a caller that passed an earlier list check cannot wedge the moved draft's new owner. Unavailable marking validates current ownership before creating a session. Session epoch checks across authorization/preparation prevent shutdown from being followed by delayed provider startup. Unknown provider creation, known thread identity and uncertain-message no-replay behavior remain unchanged.

Added regression coverage in the existing test files:

- Electron: Send-first holds host validation while concurrent context IPC is attempted; only the authorized checkout reaches the provider. Context-first holds the durable context write while Send IPC is attempted; Send rejects the new unauthorized checkout before any provider startup. A subsequent nonconcurrent Send of that saved unauthorized checkout also rejects with zero protocol calls. Identity, binding, prompt and accepted-message counts are checked.
- Host: context/setup exclusion and reentrant calls; stale snapshot, control, open, Send and unavailable calls after a project change; shutdown suspended in both host authorization and preparation with zero provider connections.
- Existing concurrency Electron checks retain early approval/input responses and independent per-request locks while Send awaits acknowledgement.

This correction changes only `apps/desktop/host/main.ts`, `apps/desktop/host/chat-service.ts`, `apps/desktop/host/project-drafts.test.ts`, `apps/desktop/tests/project-drafts.spec.ts` and this evidence record relative to the first review. The full 20-file implementation manifest above is retained, uncommitted. No new manual VoiceOver result or full Agents acceptance is claimed.

Post-review verification:

- `bun run typecheck`, `bun run lint`, `bun run build`, `bun run package`, `git diff --check`: passed.
- `bun run --cwd apps/desktop test`: **94 passed, 2 opt-in skips**, 10 files passed and 1 skipped. An earlier run overlapping the native-helper rebuild failed one worktree check while executing that helper; the clean serial rerun passed all 94 tests. No worktree implementation or test expectations were changed for that failure.
- `bun run --cwd apps/desktop smoke`: **31 passed, 1 opt-in live skip**, including both real overlapping IPC regressions and the existing pending-Send routing/response-lock checks.
- `ESCODE_PACKAGED=1 ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop smoke -- tests/project-drafts.spec.ts tests/chat.spec.ts`: **4 passed** against the rebuilt package with restricted PATH. This includes both authorization race orderings, saved draft promotion/restart, and the real installed Codex **0.165.0** streaming/history/count workflow. Race failures are injected using the controlled protocol child, not live Codex.

The correction is ready for a fresh independent reviewer. HEAD and local main still equal `e2d5e07116d4dd512812b96e6828dc2551cbf407`; no integration reconciliation was needed. No commit, push, PR, merge, delegation or issue closure was performed.

## Independent review round 2: immediate creation order

The second review confirmed the authorization correction and found that global New chat's immediate catalogue refresh bypassed the shared ordering comparator. The one-line correction sorts that catalogue with `compareChats` before `setChats`. The other catalogue refresh is the shared load function used by initial load, polling and context-change events; it already sorts. Project-local Chats already sorts a copied list with the same comparator at render. No additional refresh path or comparator change was needed.

The new Electron test seeds three saved drafts in append order, then creates a fourth from global New chat. The renderer's polling clock is paused before Agents mounts, so no interval refresh or outstanding poll can repair a bad creation render. The test checks `Gamma, Beta, Alpha` before creation and `Delta, Gamma, Beta, Alpha` immediately afterward while polling remains paused. The initial regression reproduced `Alpha, Beta, Gamma, Delta` against the previous build. It passed after the one-line fix. The post-creation render was captured for inspection.

Round-2 verification:

- `bun run typecheck`, `bun run lint`, `bun run build`, `bun run package`, `git diff --check`: passed.
- `bun run --cwd apps/desktop smoke -- tests/agents.spec.ts tests/project-drafts.spec.ts tests/concurrency.spec.ts`: **8 passed**. This includes shared/global-local ordering, the new pre-poll creation assertion, both overlapping authorization IPC orders, and early approval/input responses with independent response locks while Send is pending.
- The final clock setup was additionally checked with `tests/agents.spec.ts --grep 'global creation'`: **1 passed unpackaged and 1 passed packaged** (`ESCODE_PACKAGED=1`), against the rebuilt package.
- Host logic was unchanged in this correction, so the prior **94 passed, 2 skipped** host result is retained without claiming a new host run. No live Codex or manual VoiceOver check was repeated for this list-order-only correction.

This correction changes only `apps/desktop/src/agents.tsx`, `apps/desktop/tests/agents.spec.ts` and this evidence record relative to review round 2. The complete implementation now has 21 changed files, listed above; all earlier implementation and security corrections remain uncommitted in the assigned worktree. No full Agents acceptance is claimed.
