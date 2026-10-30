# Authenticated Files transfers

Implements [Copy, duplicate and paste with recoverable outcomes](https://github.com/ejjsharpe/escode/issues/82) under the fresh-state prerelease amendment.

Files clipboard capture, drag capture, paste, Duplicate and internal move/copy drag now use the authenticated Effect socket. Named, discriminated request schemas validate operation-specific fields and cap selections at 10,000 entries. Replies validate per-item outcomes, durable intents, staging paths and copied recovery drafts. File-size socket budgets cover transfer replies containing available unsaved source text. Consent and native copying do not expire under the ordinary query timeout. Connection loss never automatically retries an operation.

The former project IPC routes reject capture and transfer requests; preload dispatches directly to the shared client. Clipboard tokens and drag captures remain process-local host references, bound to checkout/native object identities. The host retains native clipboard ownership because reading or writing the system clipboard grants no independent filesystem authority. Existing native import behavior follows the same transfer dispatch; native-source capture remains a separate OS bridge.

The descriptor-scoped asynchronous native copier, protected-path checks, captured-source/destination confirmation, collision handling, Replace through native Trash, intent journal, batch overlay, copied disk baselines and renderer reconciliation are reused unchanged. No migration, compatibility fallback, new dependency or product concept is introduced. Existing [transfer](files-transfer.md) and [drag](files-drag.md) descriptions remain applicable, subject to the current verification below.

## Verification

Environment: macOS 26.3.1 (25D2128) arm64, Node 26.13.0, Bun 1.4.4, Git 2.50.1 (Apple Git-155), locked Electron 45.1.0. Isolated worktree based on `2e820dd`.

- Frozen install, typecheck, lint and build passed.
- Full host/native suite: 210 passed, four opt-in skips, 22 files passed and one skipped.
- Unsigned macOS arm64 packaging passed; existing chunk-size, default-icon and unsigned-package limitations remain.
- Existing transfer/drag/recovery Electron journeys exercise the replacement through preload. The clean Replace test now explicitly checks rejection of all three superseded IPC routes.

The initial built run passed 30/35; a second run passed 31/35. All four consistent failures reproduced on the unmodified `2e820dd` baseline: drag edit/save before completion, two restart fixtures retaining the dead host ownership lock, and direct bridge acknowledgement without client reconciliation of returned copies. The tests now wait for completed move delivery, explicitly remove only a confirmed-dead fixture host lock, and reconcile copied drafts before acknowledging. The unchanged Trash Quit request can also reject at recovery-session admission after authorized Quit, rather than returning individual denials. Its test now accepts that rejection only for Quit and checks both original files and the absence of native Trash effects. These exploratory runs are not final passes.

Crash/restart tests qualify recovery after explicit test-operator removal of the confirmed-dead host ownership lock; they do not establish automatic restart after a crash. Standards and specification reviews found no blocking findings after replacing positional request arguments with named discriminated schemas.

Final verification of the replacement:

- `bun run --cwd apps/desktop typecheck`, `lint`, `build` and `package`: passed, plus `git diff --check`.
- Final `bun run --cwd apps/desktop test`: 210 passed, four opt-in skips (39.00 s).
- Built Electron selection `tests/files-transfer.spec.ts tests/files-drag.spec.ts tests/files-trash-handoffs.spec.ts`: 34 passed, with only the unchanged Quit-session rejection requiring the test adaptation described above. All 21 transfer/drag checks passed. The adapted Quit check was rerun separately.
- `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-transfer.spec.ts tests/files-drag.spec.ts tests/files-trash-handoffs.spec.ts`: **35 passed**, no skips (2.0 min), using restricted PATH and the final unsigned arm64 package. This includes the adapted Quit check.
- Generated 500 MiB / 8,000-file copy: built native copy 5,282 ms, concurrent visible Stop 20 ms; packaged native copy 3,398 ms, Stop 25 ms. Agents navigation completed during copying and the suite verified destination bytes. These are bounded observations with a controlled provider fixture, not capacity guarantees or authenticated live-provider evidence.

## Limits

No new manual keyboard/focus/VoiceOver pass is claimed. Controls, focus handling and UX copy are unchanged; earlier manual evidence remains historical. No live-provider turn, broader capacity qualification, multi-client qualification or revocation acceptance is claimed. Copy publication, Replace and batches remain nontransactional; recovery is best effort. Ambiguous outcomes retain journal/staging evidence and require explicit recovery, never automatic replay.
