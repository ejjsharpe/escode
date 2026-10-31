# Recent chat list (#147)

Agents and exact-checkout Chats share one row renderer and comparator. The existing SQLite chat records and authenticated bounded summaries carry optional title and recency metadata; no background transcript subscription or second catalog is introduced. Existing fallback chat names remain until title generation/rename metadata is supplied by its separate implementation slice.

Last user message uses latest user-role update, user-message creation, chat update, then chat creation; descending identity breaks ties. Accepted Send records its submission time, observed user-message item updates advance it, and monotonic persistence protects newer observations from delayed Send completion. Assistant events, completion, reading and title changes do not update this field. Relative times use the comparator's exact timestamp and refresh each minute. Existing records without user-message metadata use timestamp fallbacks; this slice does not scan old provider transcripts to backfill them.

Rows expose full project/checkout paths, scratch context and status in accessible names and hover text. Leading outline clock/alert icons disclose running, needs input, unavailable and uncertain states without a routine idle indicator. The list has no headings, activity groups, count filters or search. Existing checkout scoping remains authoritative.

## Evidence

- TDD: the Electron recent-row test failed on the original created-first list (`Chat 2` first), then passed with Last user message ordering and title/time/context presentation.
- `tests/chat-summaries.spec.ts`: three application tests cover timestamp fallbacks and identity ties, empty/global lists, private composer exclusion, detail subscription release, five identically named projects/thirty chats/three active chats, user Send promotion, stable order through assistant output and Stop, and exact paths in labels.
- Focused host tests: `host/agents.test.ts`, `host/chat.test.ts`, `host/chat-commands.test.ts`: 21 passed, one opt-in installed-provider test skipped.
- Typecheck, lint, build and macOS directory packaging pass. Lint retains four warnings outside this change.

## Limits

Generated titles, archive, composer/settings redesign and frame/sidebar resizing belong to other #144 tickets. No installed-provider or manual VoiceOver qualification is claimed. Provider notifications do not supply message timestamps here; user-message updates use the host observation clock. No transcript bodies are loaded solely to establish recency. Existing historical chats without metadata retain the specified timestamp fallback.

Packaged qualification: `ESCODE_PACKAGED=1 ... smoke -- tests/chat-summaries.spec.ts` passes all three tests in the built macOS application. A rendered desktop capture was inspected for density, truncation and status presentation.

Broader Agents regression: the unavailable-selection and project-picker/restart scenarios pass. The long-request composer full-visibility assertion fails with viewport ratio 0.8555555; the identical failure was independently reproduced at untouched integration commit `237ff32` in a temporary detached checkout. That existing composer layout limitation belongs to the composer/frame slices, and its assertion remains intact. The closed-project/share-context/restart scenario passes after narrowing an obsolete details selector and allowing the obsolete post-crash lock cleanup to find no file.
