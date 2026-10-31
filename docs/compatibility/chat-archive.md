# Chat Archive and Restore (#149)

Archive is host-owned metadata on the existing SQLite chat record. Authenticated actions use the existing chat transition lock and expected-state check. The storage queue preserves concurrent composer writes; SQLite atomically checks retained command receipts before Archive and rejects new Sends against archived chats. Running/preparing/opening/completing sessions, outstanding requests, uncertain first Sends and uncertain historical operations block Archive. Restore changes no recency fields.

Agents and exact-checkout Chats filter the shared summary catalog. Their footer icon beside Settings toggles Archived/Recent with an accessible action label and pressed state. Selection and composer text remain independent of the list filter; an outside-list notice explains retained selection. The conversation action restores the same identity. No provider archive command, transcript copy, Stop, resource deletion or cleanup is involved.

Focused host tests cover restart persistence, draft/identity/creation-time preservation, stale action rejection, preparation races, uncertain work and both orderings of durable Send/Archive admission. Electron Agents scenarios cover archive/restore in global and checkout-local views, retained draft/history/editor context and footer state. A rendered Archived capture was inspected at `/tmp/escode-149-archived.png` during development.

Qualification limits: manual VoiceOver, packaged/native and 200% zoom checks remain with integrated parent qualification. The full host suite was interrupted after failures in expiry, dropped-response reconnect, lookup, shutdown and worktree preparation under concurrent machine load; it is not a passing full-suite claim. Focused rerun results are recorded in the implementation handoff. The first Agents run passed all four tests; a concurrent expanded run hit the existing 45-second test/teardown deadlines, prompting an isolated longer-deadline rerun.

Final focused result: 14 host admission tests passed. The expanded global/local Electron archive scenario passed alone (14 seconds, 120-second allowance). Typecheck and build passed; lint retains four pre-existing warnings.

The five host files that failed under concurrent load subsequently passed with one worker: 32 passed, one opt-in test skipped (`checkpoint-expiry`, `durable-send`, `lookup`, `shutdown`, `worktree-drafts`). This bounds the observed failures without claiming completion of the interrupted full suite.

Final complete Agents rerun: all four tests passed in 40.9 seconds with the command-line 120-second allowance. The global/local archive test passed in 12.2 seconds. Settings remains available in Files/Diff sidebar footers and chat-list footers without duplicating it in the top strip.
