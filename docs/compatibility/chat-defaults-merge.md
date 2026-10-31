# Defaults integration qualification — #144 / #153

Fresh isolated merger `t3/implement-spec-144` started at integration commit
`e09a0e23cc43ef504d3e6d2340506276557eaa41` and fast-forwarded the requested
controls commit `9e14b5a576d43c35f39b6b2db75da5b681c6f70d`. Subsequently merged
the concurrent context integration at `abc1798bea50564fccb4d3b0dc5f7f5e87910152`
without conflicts (merge commit `83adf6d`).

Reviewed the shared host/defaults storage, authenticated contracts, renderer controls,
and existing Electron settings coverage. Project overrides precede app defaults,
current selection, remembered model/options and the provider catalog default;
explicit saved choices are retained. Effort memory is per model. New draft
permissions capture project/app defaults or factory Full access independently of
per-chat edits. Defaults do not rewrite existing next-message selections or text.
Send still validates capabilities and policy and captures settings before work.
Existing draft/worktree Electron
scenarios provided failing tests for fixture corrections: capability requests now
return valid config/requirements and thread responses honor captured Full access.
The project scenario then exposed a production bug: standard draft preview
sandbox strings were incorrectly treated as unknown provider policy objects.
The shared policy check now recognizes the three standard preview strings;
unknown strings, custom provider policy objects and managed/config restrictions
remain blocked. The existing application scenario failed before this fix.

## Fresh checks

- Typecheck, lint, build and `git diff --check` passed, including a fresh run after
  merging the context integration.
- Focused host suite (`chat-commands`, `models`, `permissions`, `chat`,
  `durable-state`): 37 passed, one opt-in provider test skipped.
- Combined Electron run: settings `models.spec.ts` and `permissions.spec.ts`
  passed, covering persistence, app/project precedence, model effort memory,
  permission reset, managed-policy rejection, preserved text and captured settings
  during preparation/running work without replay.
- Broader Electron checks did not pass: concurrency times out looking for the
  obsolete exact `Chat 1` label; project-drafts expects no Project context selector
  but finds one; worktree-drafts times out on removed `.view-nav .directory`.
  This initial failure is retained as evidence; context integration updates the
  project/worktree scenarios. Concurrency remains an outstanding parent test update.
- Before the context merge, all six title Electron scenarios passed.
- After the context merge, the model and permission Electron scenarios passed on
  rerun. The first combined permission run timed out at the third explicit Send;
  this did not reproduce on rerun and remains a timing qualification limit.
- After the shared preview-policy fix, project-drafts passed through first Send,
  context binding and restart. The fixture corrections also restored worktree-drafts.
- Final combined Electron run of `models`, `permissions`, `project-drafts` and
  `worktree-drafts`: all four passed (1 minute). Focused host suite rerun after the
  production fix: 37 passed, one skipped. Build/typecheck/lint passed again.

## Limits

The integration ref was merged again before handoff at `abc1798` (including #150).
This record does not qualify future integration commits. Root files, integration ref, issue
state and parent draft PR were not modified.

Saved/provider policy mismatch remains fail closed and a release qualification
limit. No fresh installed-provider, packaged, VoiceOver/native or responsive/zoom
qualification was performed. Fixture success does not establish real-provider
permission compatibility.
