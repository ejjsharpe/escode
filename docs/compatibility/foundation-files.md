# Authenticated file editing and recovery

Delivery for [Read, edit and save files through the host](https://github.com/ejjsharpe/escode/issues/78).

File read/save and workspace load/persist now use validated Effect RPC contracts over the authenticated local host connection. Superseded project read/save and lifecycle load/persist IPC routes reject requests. Native selection, dialogs and remaining Files operations retain their existing platform paths. There is no fallback or dual dispatch.

The existing native adapter retains the 2 MiB UTF-8 editor boundary, binary/symlink rejection, descriptor checks, loaded-baseline conflicts and practical final-check/replacement race limit. Compare/Overwrite/Reload/Cancel and editor controls are unchanged. Ordinary saves now use the durable operation journal, reconcile completed disk baselines and retain newer recovery text. Late snapshots carrying pre-save baselines are reconciled until matching durable client acknowledgement. Uncertain journal outcomes block subsequent operations; pending persistence is disclosed without retiring available edits.

Fresh `client-workspace-v1.json` and `client-file-operation-v1.json` records include storage version 1 and the authenticated installation's stable host/client identities. Unsupported or differently owned records fail without replacement. Old workspace/journal files are neither imported nor deleted. Project bytes, existing worktrees and provider history are unaffected. Current desktop snapshots represent one client; exhaustive second-client arbitration remains deferred.

Files/recovery frames have a separate 32 MiB encoded ceiling to accommodate JSON escaping and multiple recovery buffers; ordinary messages retain the 1 MiB ceiling. Larger/non-Files frames are rejected before dispatch. Existing socket admission and queue bounds remain; this is an initial limit, not a measured production-capacity claim. Recovery writes coalesce for 150 ms; explicit flush writes immediately. Unacknowledged keystrokes remain best effort.

Verification on the actual local macOS installation (Electron 45.1.0, Node 26.13.0, Bun 1.4.4):

- Typecheck, lint and build pass.
- Final full unit suite after rebasing onto parallel work: 204 passed, 4 opt-in tests skipped. This includes coalesced flush and late-snapshot save reconciliation.
- Native/file-operation tests cover stale saves, descriptor/replacement races, denied persistence and fresh-store journal recovery, checking actual disk bytes, available text and baselines.
- Authenticated transport test round-trips a full 2 MiB document, saves it and rejects malformed payloads; existing authentication, ordinary oversized-frame and exhaustion tests pass.
- Development and packaged restricted-PATH `tests/lifecycle.spec.ts --grep 'crash recovery|cancelled Quit'`: 2/2 pass each. These exercise durable crash recovery, conflict baseline, failed Save, Cancel, Discard/restart and cancelled Quit preserving earlier Discard choices. Packaged recovery acknowledged the draft about 434 ms after typing began in this run.

Standards review found no documented-standard breach; its duplicate transport allowlist finding was resolved. Specification review verified the stale-snapshot correction and found no remaining concrete blockers.

No new manual VoiceOver claim is made. Existing controls and focus behavior are retained; manual accessibility qualification, broader installation matrices, exhaustive multi-client checks and full capacity benchmarking remain deferred.
