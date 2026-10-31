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
  output, failed completion with partial text and delay; useful fallbacks; Send reaches Ready while the title is delayed;
  late results after Rename and after a newer Regenerate; unchanged creation recency;
  exactly one task `turn/start`; shared project/Agents labels and long manual titles
  surviving restart. Fixtures use isolated directories and user data.
- Full host suite before the final recency merge, with two workers: 382 passed, six skipped (44 files passed,
  two skipped). Targeted chat, project-draft, scratch, SQLite-control and command
  admission regressions also passed: 47 passed, two skipped.
- Typecheck, lint and desktop build pass. Screenshot reviewed from the actual
  Electron title fixture (`test-results/chat-titles.png`, generated locally).
- Installed Codex 0.166.0 catalog inspection returned `gpt-6-luna`. No real title
  inference was submitted; model availability does not qualify output quality.

## Limits

No packaged-app, live paid inference or manual VoiceOver qualification was performed.
The initial broad Agents run reported a legacy fixture ordering mismatch,
project-picker restart timeout and short-window composer visibility failure. After
merging integration tip `769633c`, the focused activity regression passes the
short-window checks and reaches an unrelated strict alert-locator failure (two
matching error elements). The other broad scenarios were not rerun after merging.
Its obsolete ordinal expectation for a newly sent chat was updated to the
first-message fallback. A completely passing Agents regression suite is not claimed.
Other #144 frame/composer/menu work remains with its owning tickets.

Integration handoff: implementation began at `237ff32` in a clean isolated worktree.
Local integration tips `769633c` and then `18df68f` were merged. The CSS append
conflict retained both the shared sidebar rules and compact title actions. The
recency merge retains the shared ChatRow, new timestamp fields and user-message
promotion behavior, while displaying the shared title. Title operations leave the
sent-chat recency timestamp unchanged (asserted through public summaries). All six
title Electron scenarios, typecheck, lint and build pass after the final merge.
Post-merge host Agents/chat regression checks: ten passed, one skipped.
The integration branch and issue states were not modified by this ticket.
