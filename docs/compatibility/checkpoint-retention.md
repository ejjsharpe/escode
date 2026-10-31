# Configurable checkpoint retention (#138)

Implemented only the standalone configuration slice of #117, from isolated
`c0d0c41` on `t3/spec117-durable-state-2`, preserving `0a9c981`. Merged the
integration tip `8edb20e` (including summarized continuation and concurrent
packaged history fixes) into this branch as `a3f554c`; the integration branch was
not changed. No PR, issue closure or map operation was performed.

The app-wide Settings disclosure is available with or without a project. One
host-owned SQLite policy defaults to 30 days; validated whole days from 1 to
36500 and Never are supported. The preload/client RPC uses the existing
single-use-ticket authenticated connection, validates values in the host and
again in the SQLite worker, and persists before returning success. Database
constraints also reject invalid persisted day values. Reading settings is not
chat activity.

Before accepting a changed policy, the service finishes eligible expiry batches
under the previous policy. The new policy applies to remaining eligible contents
on subsequent cleanup/inspection. Thus extending an already elapsed period or
choosing Never cannot resurrect expired files. Activity timestamps are neither
reset nor rewritten by settings changes. Existing open/message/agent activity,
polling exclusion, operation/recovery/uncertain-evidence protection and independent
branch receipt contents remain authoritative. Never skips inactivity expiry;
capacity limits still apply. No physical reclamation, conversation/worktree
removal or recurring cleanup dialog is added.

The disclosure explains restoration and historical branching limitations,
shortening/extension timing, protected dependencies and storage consequences.
Native summary, checkbox, number field and submit semantics support keyboard use;
Save retains focus through asynchronous persistence, errors remain visible in a
status region, and reopening reloads authoritative settings.

## Executed verification (2026-10-31)

- TDD: the first policy test failed with Unknown SQLite operation, then passed
  after worker implementation. An initial test startup required installing the
  locked workspace dependencies.
- Real SQLite, controllable clock and authenticated host tests:
  `bun run --cwd apps/desktop test -- host/checkpoint-expiry.test.ts
  host/boundaries.test.ts --maxWorkers=1`: the initial combined run passed 20/20.
  Fresh runs on merged source passed retention 5/5 (3.22s) and the expanded
  boundary suite 20/20 (185.47s), including summarized continuation.
  Coverage includes defaults, shorter/longer policies, Never, persistence/restart,
  invalid values, elapsed-before-change/no resurrection, deliberate open, messages,
  agent activity, polling exclusion, retained branch copies, recovery drafts,
  active/pending operations, uncertain evidence, batch limits and rollback.
  The protection fixture additionally uses a configured seven-day policy.
- `host/host-client.test.ts`: 7/7 passed, exercising the existing authenticated
  transport and client boundaries.
- Typecheck, lint, build and unsigned arm64 package passed on merged source.
- Packaged `tests/retention.spec.ts`: 1/1 passed (5.9s), including keyboard
  disclosure, editing, focus after Save, Never keyboard selection, disabled days,
  Tab navigation and persistence across full app restart. Screenshot
  `apps/desktop/test-results/retention-settings.png` was visually inspected.
  The first packaged run exposed the panel extending outside the viewport;
  moving Settings to the header's right edge fixed it before the passing rerun.
- Impeccable detector returned no findings for the settings component.

No known functional #138 criterion remains unmet at these automated seams.
Manual VoiceOver and paid live-provider checks were not performed; provider
activity uses deterministic fixtures. No physical power-loss/ENOSPC or storage
reclamation guarantee was tested. Conservative protection can delay expiry for
unrelated chats, as documented for #137. Full repository tests were not run.
