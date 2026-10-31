# Shared conversation titles (#148)

The host retains titles, bounded first-message source text and the current generation
request identity in the existing SQLite chat records. Authenticated `titleAction`
commands rename or regenerate; Agents and checkout-local Chats consume the same
validated summary title. Client workspace/composer snapshots cannot write this metadata.

First task dispatch schedules title generation independently. Its own Codex connection
uses an ephemeral read-only thread with approval `never`, separate from the task's
thread and turn. The installed catalog selects `gpt-6-luna`, or the older
`gpt-5.1-codex-mini` when available, independently of the task model. No supported
lightweight model, errors, empty/oversized output or a 30-second timeout retain the
first-message fallback (120 characters) or existing title. Generation asks for 3–8
words and fewer than 40 characters; manual titles accept 1–256 single-line characters.
An initial request runs once; explicit Regenerate supersedes earlier requests. Rename
invalidates the current request. Late results cannot replace either operation.
Unfinished requests are retained across restart and are never automatically replayed.
Existing chats can explicitly regenerate from the first loaded user message in the
bounded initial provider-history page; absent history reports unavailability.

## Verification

- TDD: the first Electron test failed because seeded shared titles were absent.
- `tests/chat-titles.spec.ts`: controlled provider success, initial failure, empty
  output and delay; useful fallbacks; Send reaches Ready while the title is delayed;
  late results after Rename and after a newer Regenerate; unchanged creation recency;
  exactly one task `turn/start`; shared project/Agents labels and long manual titles
  surviving restart. Fixtures use isolated directories and user data.
- Targeted host regressions: 47 passed, two existing opt-in skips across chat,
  project drafts, scratch, SQLite controls and command admission.
- Typecheck, lint and desktop build pass. Screenshot reviewed from the actual
  Electron title fixture (`test-results/chat-titles.png`, generated locally).
- Installed Codex 0.166.0 catalog inspection returned `gpt-6-luna`. No real title
  inference was submitted; model availability does not qualify output quality.

## Limits

No packaged-app, live paid inference or manual VoiceOver qualification was performed.
The broad Agents run reported a legacy fixture ordering mismatch, project-picker
restart timeout and short-window composer visibility failure. Its obsolete ordinal
expectation for a newly sent chat was updated to the first-message fallback. Those
remaining failures are not claimed resolved or proven pre-existing by this ticket.
Other #144 frame/composer/menu work remains with its owning tickets.
