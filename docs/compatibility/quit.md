# Deliberate Quit

Implements [Quit deliberately and stop owned processes](https://github.com/ejjsharpe/escode/issues/74)
under the approved fresh-state prerelease scope.

Explicit Quit identifies active chats by saved identity and checkout, including scratch
chats and chats whose project editor is closed. Native Save/Discard/Cancel choices
precede shutdown. Discard choices are deferred across all checkout buffers: a later
Cancel or failed Save retains earlier proposed discards. Recovery drafts are persisted
before their buffers are reset; failed persistence retains the in-memory text.
Successful saves remain saved when a later choice cancels.

Confirmed Quit uses the existing bounded provider interrupt and owned process-group
TERM/KILL cleanup, closes project watchers, the authenticated directory host and the
foundation owner lock. No process-name search or unrelated PID targeting is introduced.
Restart reads new-format associations and drafts without dispatching stored turns,
replies or preparation. A crash leaves the foundation owner lock fail-closed: explicit
recovery must first establish that the previous owner is dead. This does not import
legacy state or promise automatic crash-lock recovery.

## Verification (2026-10-30)

- Typecheck and lint passed; full host suite: 189 passed, 4 skipped.
- Build and unsigned macOS packaging passed on macOS 26.3.1, Electron 45.1.0,
  embedded Node 24.22.1; shell Node 26.13.0, Git 2.50.1, installed Codex 0.163.0.
  Lifecycle checks use a deterministic provider fixture, not live provider turns.
- Packaged `tests/lifecycle.spec.ts`: all four scenarios passed. It covers cancelled Quit after an earlier Discard, failed
  Save with active work intact, confirmed Quit with TERM-resistant descendants,
  closed-project and scratch work, and restart without repeated turns. Its SIGKILL
  recovery fixture explicitly releases the lock after observing process exit.
- Native dialog controls and labels are retained; the active-work dialog adds detail.
  Manual keyboard/focus and VoiceOver checks of this change remain unperformed.
  Exhaustive multi-client, revocation and capacity qualification remain deferred.
