# macOS window close/reopen

Issue: [Retain work and edits through window close/reopen](https://github.com/ejjsharpe/escode/issues/73).

Native Close (including the window close action used by Cmd+W) hides the window on
macOS. It retains the owning renderer, Monaco models, undo, loaded disk/conflict
baselines, composer text, authenticated connection and host/provider sessions.
Dock activation shows and focuses the same window. No reload, reconnect or Send
occurs. This intentionally retains renderer memory and subscriptions while hidden;
it does not add a second client or promise crash durability for the latest keystroke.

Explicit Quit first shows/focuses the retained window, then uses the existing active
work and Save/Discard/Cancel flow. Cancellation and failed Save preserve work.
Confirmed Quit still stops owned provider processes. Non-macOS Close retains the
existing quit flow.

`tests/lifecycle.spec.ts` exercises native Close and app activation with active fake
provider work, process IDs, one dispatched turn, exact composer text, unchanged chat
snapshot (thread, turn, settings and request identities), and retained dirty recovery
text/baselines. It also retains crash-recovery, failed-Save, Cancel, confirmed Quit,
process-descendant cleanup and restart-without-replay checks.

Manual Dock clicking, Cmd+W/Cmd+Q and VoiceOver focus checks remain unperformed.
Automated activation exercises the same application event; prior accessibility
evidence does not establish these changed native lifecycle interactions.

## Execution evidence — 2026-10-30

Tested macOS 26.3.1 arm64, Electron 45.1.0, terminal Node 26.13.0, Bun
1.4.4, Git 2.50.1. Installed Codex reports 0.163.0; these checks use the
fake 0.165.0 provider fixture and consume no live provider turns.

- `bun run typecheck`, `bun run lint`, `bun run build`, `bun run package`: pass.
- `bun run test`: 20 files passed, one skipped; 189 tests passed, four skipped.
- From `apps/desktop`, `bun run smoke -- tests/lifecycle.spec.ts --grep 'active work'`:
  two passed (35.5 seconds).
- Same command with `ESCODE_PACKAGED=1`: two passed (17.4 seconds), using
  `release/mac-arm64/escode.app`, built from application commit `6abbcca`.
  The final test-only correction reads the snapshot through the current authenticated
  `open` API instead of the removed IPC snapshot route.

The full lifecycle file also exposed a pre-existing crash-restart limitation:
SIGKILL leaves `foundation/owner.lock`; startup requires explicit recovery and
`firstWindow()` times out. This failure is outside window close/reopen, which never
restarts the host. Crash recovery is not claimed as passing here. The first run also
failed the new test's obsolete snapshot call; that test error was corrected before
both focused passing runs above.

Standards review found no issues. Specification review requested recorded packaged
execution evidence, supplied above. Manual native accessibility limits remain as
stated above; broad multi-client and capacity qualification remain deferred.
