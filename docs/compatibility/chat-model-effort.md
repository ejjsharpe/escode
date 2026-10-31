# Chat model and effort (#151)

The composer reads Codex's paginated model catalog through the authenticated host
connection. Model/effort choices live on the existing SQLite chat record, with
remembered effort per model. Selecting controls does not edit configuration, create
provider threads, allocate draft resources, or submit prompts. Unsupported saved
choices block Send and remain visible for explicit correction. Send captures the
choice before preparation and supplies it on turn/start, including resumed sessions.
Controls remain editable during preparation/running; changes do not queue work.

Verification: host catalog persistence/rejection test was red before implementation,
then green. Focused chat/command/project-draft tests: 35 passed, one installed-provider
scenario skipped. Durable Send suite: six passed on isolated rerun following one
combined-run reconnect timeout before integration. After integration, the same
reconnect test also timed out when run alone at the default 15-second limit.
All six tests passed with a 60-second timeout (15.06 seconds total); default-timeout
stability remains unqualified. Typecheck, lint (four existing warnings), build pass.
Electron fixture coverage exercises differing effort sets/defaults, remembered effort,
preserved unsent text, changes during preparation/running, exact captured provider
command and restart without replay, followed by an explicit resumed Send using the retained choices.
Post-merge Electron smoke passed against integration tip `18df68f`; the controls
were visually inspected in the composer. Concurrent combined host runs also hit
reconnect/captured-checkout test timeouts in unmodified tests; isolated reruns are recorded
in the task handoff. The captured-checkout suite passed all 14 tests in isolation. Installed Codex 0.166.0 model/list returned real
models and supported/default effort through the existing protocol adapter.

Limits: permissions (#152) and defaults surfaces/precedence (#153) remain separate.
No live paid turn, packaged-app qualification, VoiceOver or exhaustive multi-client
race qualification is claimed. UI uses existing desktop styling and labelled native
selects. Catalog lookups use short-lived provider connections; no catalog cache added.
