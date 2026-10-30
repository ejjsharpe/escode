# Authenticated rename and move

Issue: [Rename and move entries without losing dirty edits](https://github.com/ejjsharpe/escode/issues/80).

Rename and direct move now use validated `moveEntry` requests on the authenticated
host socket. `ackFileOperation` uses that connection too. Their former project IPC
handlers are removed; there is no fallback dispatch. Transfer/Trash commands retain
their existing routes pending their own replacement tickets.

The host reuses the native move and file-operation journal, checking approved
checkout, project session, source identity and protected state before effects.
Intent is durable before native execution. Native success is recorded before workspace
reconciliation, and the journal survives failed delivery/persistence until durable
client reconciliation and explicit acknowledgement. A lost native reply is reconciled
from original object identity and actual paths on restart, never by repeating a move.
Uncertain outcomes block mutations and cannot be cleared by client acknowledgement.

Available dirty descendants retain text and loaded disk baselines at resulting paths.
Late recovery snapshots are reconciled against completed move facts before storage,
so an old snapshot cannot restore the original draft path before acknowledgement.
Monaco rebinding retains cursor/scroll and discloses earlier undo-history reset;
subsequent edits support undo. Existing per-item transfer results remain unchanged.

## Verification

On the recorded macOS 26.3.1 arm64 installation with Electron 45.1.0, Bun 1.4.4,
Git 2.50.1 and Codex 0.165.0 (no provider turn needed):

- Authenticated transport tests validate move payloads, resulting paths and explicit ACK.
- FileOperations tests cover intent/native effect/outcome/storage/ACK boundaries,
  dirty descendants and baselines, occupied destinations, parent/source/root swaps,
  uncertain restart, late snapshots and refusal to acknowledge uncertainty.
- Electron `file-operations.spec.ts` and `files-inline.spec.ts` exercise actual Monaco
  dirty moves, subsequent undo, conflict saving, retained inline input, interruption
  and restart. The other-window assertion now expects bootstrap rejection, because
  move no longer reaches project IPC.

The initial frozen install used Bun's isolated layout, leaving desktop's existing
undeclared direct Effect imports unresolved. Local ignored node_modules symlinks to
packages/host's Effect dependencies allowed verification; no dependency versions or
lockfile were changed. This existing installation-layout limitation remains.

No new VoiceOver validation is claimed. Keyboard/focus and inline input behavior
are covered by automation; existing manual accessibility evidence is reused.
Cross-process final-check/mutation races retain the documented practical guarantee,
not transactional isolation. Exhaustive multi-client/revocation and capacity
qualification remain deferred by the approved prerelease amendment.

Recorded results (2026-10-30): typecheck, lint, build, unsigned directory package and
whitespace checks passed. Full unit suite: **206 passed, 4 skipped**. Focused
host directory/operation suite: **46 passed**. Packaged file-operation suite:
**9 passed**. Development file-operation/inline suite: **21 passed, 2 failed**;
the uncertain-rename restart then passed after adding explicit test-owned lock
recovery. The remaining restored-hidden-selection test has existing recovery and
one-shot injected-listing assumptions; diagnostic reruns reached a separate
root-listing alert assertion. It is not counted as passed, and its broader fixture
repair is deferred. All direct move/rename preservation checks passed. Independent
Standards and Spec reviews found no remaining blockers after the recovery fixes.
