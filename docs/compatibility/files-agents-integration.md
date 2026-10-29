# Completed Files tree/inline integration with Agents

Integration checkout: `/private/tmp/escode-files-40-41-integration-5c4e752`, branch
`integrate/files-40-41`. This record describes an uncommitted pending merge for
fresh independent review, not completed main integration.

- HEAD: `5c4e7522c10e689d0b7f95e4102ba4d5ba2e8f7d` (Agents through recovery).
- MERGE_HEAD: `3ed89ca9162802cbb69cac9a89aba3ef0ba96764` (approved completed Files tree and inline controls).
- Scope: reconcile completed Files 40–41 with Agents 32–36 and their existing
  integrated preservation baseline. No Files 42 implementation was imported.

## Resolutions

- `apps/desktop/host/workspace.test.ts`: retain both appended tests. The
  closed-editor test still compares the entire restored state exactly, including
  closed membership, saved catalogue, global/local selections, checkout memories,
  recovery text/baseline and host approvals. Its expected state now explicitly
  includes migrated tree memory for both project and secondary checkout. The
  invalid-draft rejection still compares the full retained state afterward.
  The independent legacy-tree migration/scroll/invalid-memory test is retained.
- `apps/desktop/src/style.css`: concatenate the Agents context-select/focus styles
  and Files toolbar/tree/menu/inline styles, retaining every rule from both sets.
- `apps/desktop/host/main.ts`: remove the two obsolete `closingProjects` checks
  from the auto-merged creation handler. Agents no longer has that set: editor
  closure retains host checkout authority and live sessions. Keep sender and
  explicit checkout approval checks, quit/mutation/journal guards, destination
  recovery checks, protected app-state checks and post-await session validation.
- `apps/desktop/tests/retained-project.spec.ts` and `chat-recovery.spec.ts`:
  update the newer Agents file locators from buttons to treeitems. Existing
  Source Control button locators remain appropriate and unchanged.
- `apps/desktop/tests/lifecycle.spec.ts`: scope the two expected ENOENT assertions
  to the main editor status. Files loading also exposes a status, so an unscoped
  locator became ambiguous. Error text, retained edits, conflict handling and
  process-lifetime assertions are retained.
- `apps/desktop/tests/agents-files-recovery.spec.ts`: strengthen both existing
  combined restart journeys with exact moved expansion/selection/focus/scroll
  assertions; verify the selected dirty descendant and expanded parent after
  linked-worktree reopening. Recovery baselines and ordinary conflict assertions
  remain intact.
- `apps/desktop/tests/files-inline.spec.ts`: explicitly await tree focus after
  two completed create actions before beginning another action. The packaged
  journey exposed a detached menu after opening it immediately following creation;
  queued focus restoration is the suspected timing cause. The added assertions
  verify the promised focus return instead of bypassing menu interaction.
- Screenshot destinations in `agents.spec.ts`, `chat-recovery.spec.ts`,
  `project-drafts.spec.ts`, `scratch.spec.ts` and `worktree-drafts.spec.ts` now use
  checkout-local `test-results` instead of shared fixed `/tmp` filenames.

## Connected paths inspected

Reviewed the auto-merged renderer Files callbacks and checkout navigation against
Agents editor closure, project/draft and scratch lifetimes; shared workspace
migration and journal reconciliation; create/rename IPC validation and host
checkout restoration; native no-follow/exclusive creation; public Monaco model
rebinding, destination resource/language identity, dirty-buffer recovery and
save-conflict baselines. Existing shared chat/provider routing and approval
ownership code is retained from HEAD, without replacing it with the older fork.
README/glossary and Files evidence auto-merges retain both implemented slices.

## Checks (2026-10-29)

Environment: Apple Silicon macOS 26.3.1, Node 26.13.0, Bun 1.3.14, Electron
45.1.0. Existing installed dependencies are linked into this checkout only;
no install or lockfile modification was needed. No protected manual fixture,
profile or ports 5173–5175 were used. The development test uses an ephemeral port.

Commands are run from the integration checkout:

- `bun run --cwd apps/desktop typecheck`: pass.
- `bun run --cwd apps/desktop lint`: pass.
- `bun run --cwd apps/desktop test`: 116 pass, 4 opt-in live skips.
- `bun run --cwd apps/desktop build`: pass.
- `bun run --cwd apps/desktop package`: pass; rebuilt after the final host edit.
- `bun run --cwd apps/desktop smoke -- --reporter=line`: 51 pass, 1 live skip,
  1 locator ambiguity in the closed-project quit journey. Corrected as described
  above; the failed assertion did not indicate lost edits or stopped chat work.
- `bun run --cwd apps/desktop smoke -- tests/agents-files-recovery.spec.ts tests/lifecycle.spec.ts --reporter=line`:
  5 pass after the correction and new tree-state assertions. This covers the
  sole full-run failure and both strengthened combined recovery journeys.
- `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-tree.spec.ts tests/files-inline.spec.ts tests/file-operations.spec.ts tests/agents-files-recovery.spec.ts tests/retained-project.spec.ts tests/chat-recovery.spec.ts tests/project-drafts.spec.ts tests/scratch.spec.ts tests/worktree-drafts.spec.ts tests/lifecycle.spec.ts tests/navigation.spec.ts tests/concurrency.spec.ts --reporter=line`:
  33 pass, 1 timeout when the inline test's root context menu detached. Added
  the explicit post-create focus checks above. Then
  `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-inline.spec.ts --grep 'inline create and rename:' --repeat-each=3 --reporter=line`:
  3/3 pass. The repeated checks retain the original mouse/context-menu and disk
  assertions plus the new focus assertions; no retry configuration was added.
- `git diff --check`: pass.
- Impeccable CSS detector: no findings. Inspected rendered Files inline and
  Agents screenshots; retained both incumbent layouts and focus/selection styles.

The full Electron run covers keyboard accessibility, approvals, navigation,
protected/unapproved state, unavailable/replaced contexts, missing Git, draft
promotion, scratch/worktree preparation, native operations, destination Monaco
URI/language/undo, uncertain outcomes, restart, live request ownership and app
shutdown. Its packaged smoke and baseline editing journeys also passed.
Build retains the existing large-chunk warning. Packaging reports absent
metadata/default icon and deliberately disabled signing. Development HMR emits
an existing duplicate-createRoot diagnostic while its workflow passes. Logs for
the final build/package are under `.nx/integration/` in this checkout.

## Limits and handoff

No live-provider or new manual VoiceOver acceptance was run. Prior separately
accepted manual Files evidence is unchanged. Protocol fixtures establish only
their tested routing/lifecycle behavior. No transfer/reveal/ignore/watcher or
other Files 42+ capability was added. Existing save/removal race and best-effort
recovery limitations remain documented in the original evidence.

The final combined changes, including this evidence, are staged; the two conflict
entries are resolved. Dependency-only `node_modules` symlinks at checkout root
and `apps/desktop` are untracked local environment support and are not staged.
`src/files.tsx` is byte-identical to MERGE_HEAD; the Agents chat/service,
preload and chat-state modules and lockfile are unchanged from HEAD.

No commit, merge completion, push, PR or tracker write was performed. The merge
must remain pending for a NEW full independent Ponytail review of the entire
combined tree, both parents and these resolutions. The main/root and parent
Files checkout are outside this implementation task.
