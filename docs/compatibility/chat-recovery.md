# Unavailable chat recovery (issue 36)

This is bounded implementation evidence for issue 36 under the Agents specification
(issue 26), not acceptance of all fourteen parent scenarios.

Ordinary project chats now retain a host-persisted directory identity, alongside
scratch ownership and managed-worktree reservations. A context failure retains the
chat, provider association, exact path, creation order, selection and unsent text.
Availability inspection does not close a live connection: the originating Stop
remains available. New work is blocked for the affected context. Retry checks the
same directory and reloads available Codex history without submitting a turn,
creating replacement resources, or resuming interrupted work. A stale checkout
cache can be reopened only after the recorded original identity validates.

Git is required for choosing/preparing new project execution resources. Existing
chat turns use approved saved membership and directory identity independently of
Git availability. Scratch execution needs no Git. Missing/incompatible Codex and
authentication errors retain drafts and available history with existing setup
instructions. Unapproved historical chats remain listed and their drafts editable;
renderer restoration cannot approve their paths or grant execution access.

Older records retain provider associations and append-relative order, without
invented creation dates. Their directory identity is enrolled on the first
successful host-authorized connection; old data cannot establish an inode it never
recorded. Missing/unapproved records retain their explanation and recovery data.
No transcript cache or reconstruction is introduced: after restart, available
history comes from Codex through a fresh authorized connection.

## Verification

Run from the assigned checkout:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test --output-style=static
bun run build
bun run package
bun run --cwd apps/desktop smoke
ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop test -- host/scratch.test.ts
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/chat-recovery.spec.ts tests/packaged.spec.ts
```

The new host tests use real filesystem rename/replacement, chmod access denial,
and restart with controlled protocol connections. They check project and scratch
identity, retained drafts/history, active Stop, stale tokens, and unchanged turn
counts on Retry. Existing first-Send tests cover failures before preparation,
provider creation rejection/uncertainty, accepted messages with lost acknowledgements,
and retained scratch/worktree reservations without replay.

The new Electron workflow uses real Git/filesystems and a controlled Codex
executable. It closes the project editor, loses its path during an active request,
keeps scratch work usable, Stops only the affected chat, and restarts with a
replacement directory and unavailable Git. It rejects replacement identity, then
restores the original and retries, retaining text/history. Only an explicit Send
adds another turn. It also loses/restores the scratch path without replay. Existing
Agents, availability and Files recovery tests cover historical closed/unapproved
contexts, relative order, approvals and recovery baselines together.

The installed-Codex scratch suite passed all nine tests with codex-cli **0.165.0**,
including its opt-in live test. This is host-adapter evidence; injected access,
acknowledgement and tool failures are simulated protocol evidence, not live Codex
fault-injection claims. Electron **45.1.0** is the tested desktop runtime.

Observed results on 2026-10-29:

- Frozen dependency install, TypeScript, lint, build and macOS directory packaging passed.
- Full host suite: **112 passed, 4 opt-in skipped**. After the final identity-validation ordering correction, the five affected host suites passed **36 tests, 3 opt-in skipped**.
- Full Electron suite: **36 passed, 1 opt-in live chat skipped**. This run preceded the final host validation-order/cache-selection tightening; the final packaged recovery workflow checks those paths again.
- Installed Codex scratch suite: **9 passed**, including live execution with 0.165.0.
- Final packaged recovery and restricted-PATH launch: **2 passed**.
- Impeccable mechanical detector on the changed conversation UI returned no findings. Rendered unavailable-state inspection confirmed exact-path guidance beside Stop/Retry; Electron asserts the warning is in the viewport.

Initial regression runs exposed an approval-guidance mismatch and stale checkout cache after replacement; both were corrected. Test setup also needed to wait for project opening and account for live tab labels. A validation-order experiment failed the recovery tests and was corrected before the final affected-host and packaged runs. No full-parent acceptance is claimed.

## Review handoff

Assigned worktree: `/Users/elliotsharpe/.t3/worktrees/escode/t3-df47acae`.
Branch: `t3/recover-missing-project-context`.
Unchanged base/HEAD: `bfa7d9c8494e265a6fee64d93c45cc83d6c87170`.
Issue 36 was assigned to the signed-in user after verifying `ejjsharpe/escode`.
All changes are uncommitted for a fresh Ponytail review. No commit, push, merge,
PR, issue closure, delegation, other-ticket work or stash operation was performed.

Manual VoiceOver has not been performed for this change. Native keyboard controls,
automated interactions, a rendered unavailable-state screenshot and the existing
viewport regressions provide bounded UI evidence. Existing save/removal race limits,
best-effort recovery, unsigned packaging and large-chunk build notices still apply.

## Change manifest

- `apps/desktop/host/chat.ts`: persisted directory identity and availability explanation; same-path checks.
- `apps/desktop/host/chat-service.ts`: availability inspection independent of live control; durable validation before provider work.
- `apps/desktop/host/main.ts`: host approval boundary, safe checkout cache recovery and Git-independent existing turns.
- `apps/desktop/src/chat.tsx`, `apps/desktop/src/agents.tsx`: unavailable status, visible exact-path guidance and scoped Send disabling.
- `apps/desktop/host/availability.test.ts`, `apps/desktop/tests/chat-recovery.spec.ts`: real filesystem, restart, protocol and Electron regressions.
- `README.md`, `GLOSSARY.md`, this record: bounded behavior and evidence.
