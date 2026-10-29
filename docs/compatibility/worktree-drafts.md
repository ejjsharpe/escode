# Deferred project worktree evidence — issue 35

This is bounded implementation evidence for [Deferred worktree choices](https://github.com/ejjsharpe/escode/issues/35), under [the Agents specification](https://github.com/ejjsharpe/escode/issues/26). It does not establish full Agents acceptance, issue 36 availability acceptance, issue 37 acceptance, or new VoiceOver results.

Worktree: `/Users/elliotsharpe/.t3/worktrees/escode/t3-3a1cf11e`.
Branch: `t3/implement-issue-35`. Parent: `819f081ba9e93fb9f900295378fc052b558890ed`.
Changes are intentionally uncommitted for a fresh review.

## Behavior and preservation

Project drafts in Agents and project Chats offer the saved Current checkout, explicit Git-discovered reuse, and a displayed resolved local base for a new managed worktree. Saved closed projects use their remembered editor checkout. Refreshing choices does not change the saved target; selecting a new base requires an explicit action. New worktrees show their source path and selected commit before Send; the actual unique branch/path is allocated on Send, then displayed and copyable. Existing checkouts show their branch and copy controls.

First Send uses the existing per-chat transition guard and authorization snapshot. It reserves a repository-specific managed container, persists branch/path intent before Git mutation, and invokes the existing Git service with hooks disabled and the displayed commit. Provider startup follows successful preparation and membership validation. No fetch, setup, snapshot, local-edit copying or integration is added. Responses to live requests remain independent of pending Send.

A prepared reservation locks context even if provider startup fails. Occupied destinations, Git failures and incomplete persistence preserve the reservation and any resources. Retry never creates a replacement for that reservation. Incomplete ownership records fail closed and require external inspection; the app does not infer ownership or reconstruct directories. Known provider IDs and uncertain first messages use the existing no-replay lifecycle. A missing original source checkout is not needed to continue an already prepared chat. Legacy records without a worktree target retain their existing behavior.

Removal uses the existing saved-project chat catalogue and recovery-draft checks, including closed editor tabs. The no-force policy, retained branches/history, and accepted final-check race with external writers are unchanged. No cleanup is added.

## Reproducible verification

Run from the assigned checkout:

```sh
bun install --frozen-lockfile
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop lint
bun run --cwd apps/desktop test
ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop test -- host/worktree-drafts.test.ts
bun run --cwd apps/desktop build
bun run --cwd apps/desktop package
bun run --cwd apps/desktop smoke
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/worktree-drafts.spec.ts tests/packaged.spec.ts
```

- Host real-Git/filesystem tests preserve the original index bytes and staged/unstaged/untracked/ignored content; prove no allocation on open; reject a removed base, an occupied destination and a replaced directory; retain possible leftovers after failed final persistence; prevent provider startup in an unprepared source checkout; and retain prepared paths across provider failures/restart.
- Controlled provider tests simulate explicit creation rejection, uncertain creation, and an accepted first message with lost acknowledgement. Restart/Retry retains the worktree and known thread, loads history and does not accept a duplicate message. These tests are simulated protocol evidence.
- The opt-in test passed using installed **codex-cli 0.165.0**: a real first Send in a newly prepared Git worktree received `WORKTREE_OK`; shutdown followed by a fresh connection loaded one user message and effective settings. This is live host-adapter evidence, not a live Electron or arbitrary Codex-version claim.
- The new Electron workflow uses real Git and a controlled Codex executable. It selects explicit reuse and then a new managed target from a closed project, restarts before Send, retains the displayed target despite editor-memory changes, and verifies the actual prepared commit. Original staged/unstaged/untracked/ignored content and a recovered unsaved buffer survive. Closing the actual project editor leaves its running chat in Agents; active work and subsequently a target recovery draft block removal. Reloading history sends no second turn.
- Existing host and Electron regressions cover concurrent request routing, guarded Send/context IPC races, independent navigation, scratch ownership, editor closure, quit/restart and file-operation recovery. Passing baseline tests do not certify every scenario in issue 26.

Observed results: TypeScript and lint passed; the final host suite passed **110 tests** with **4 opt-in tests skipped**. The focused live worktree suite passed **9 tests**, including one real installed-Codex conversation. The full desktop run passed **34**, skipped **1** live Electron test, and caught a composer-geometry regression caused by the added controls. After moving branch/path controls into compact checkout details, all **5** focused Agents/worktree desktop tests passed, including the existing viewport and expanded-settings checks at 728, 1024 and 1100 pixels. The final packaged workflow and restricted-PATH launch passed **2 tests**. The entire desktop suite was not repeated after this focused layout correction.

The unsigned arm64 package uses Electron 45.1.0. The build retains the existing large-chunk warning. Packaging retains the existing default-icon and unsigned-build notices. Manual VoiceOver for the new controls has not been performed; keyboard-operable native selects/buttons and automated Electron interactions are the available evidence.

## Change manifest

- `apps/desktop/host/project.ts`: split existing reservation from Git creation, reuse both paths.
- `apps/desktop/host/chat.ts`: persist draft target/reservation/identity; validate retained resources.
- `apps/desktop/host/chat-service.ts`: prepare inside the existing guarded Send lifecycle; validate identity before affected provider operations.
- `apps/desktop/host/main.ts`: validate saved project and discovered selection; authorize and prepare through host capabilities.
- `apps/desktop/src/chat.tsx`, `apps/desktop/src/worktrees.tsx`: draft choices, committed-base disclosure and copyable context within the existing layout.
- `apps/desktop/host/worktree-drafts.test.ts`, `apps/desktop/tests/worktree-drafts.spec.ts`: host/failure/live and Electron workflow evidence.
- `README.md`, `GLOSSARY.md`, this file: bounded behavior and evidence updates.
