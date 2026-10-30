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
