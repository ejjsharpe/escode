# Durable-state final review responses

Review baseline: `0a9c981...ac2f4662fc7a700aab2d3993c39a5a56bf2d53da`.
Both complete round-one reports in `/tmp/escode-117-{standards,spec}-review-r1.md`
were read. Standalone #117 implementation is authorized; no open decision map
exists. No product terminology changes were needed.

- **SPEC P2, terminal file receipts suppress expiry:** cleanup distinguishes
  completed creation/rejection and returned transfer results from admitted or
  uncertain commands. Receipts stay available for deduplication. Separate
  intent, file facts, recovery drafts and preparation records still protect
  unresolved effects. Real SQLite tests exercise successful durable creation
  and copy, close/reopen, expiry, retained receipts and retained disk bytes;
  admitted/uncertain receipts continue to block cleanup.
- **SPEC P2, historical file/directory transitions:** delete absent tracked
  leaves first, then remove only empty covered directories before writing
  replacements. Never recursively delete excluded contents. Capture treats
  ENOTDIR for an absent tracked descendant as deletion. The authenticated
  real-Git branch fixture includes both directions, checks recorded base,
  clean child index, source bytes/index, separate chat/worktree, no automatic
  turn, and existing partial-preparation/restart evidence.
- **STANDARDS action booleans:** shared named `HistoricalAction` union drives
  host dispatch and the UI selection. Existing public RPC flags translate at
  entry; receipt identities and visible explanations retain existing semantics.
- **STANDARDS validation drift:** one pure validator checks paths, supported
  modes, canonical base64, count and decoded byte capacity. Historical branch,
  restoration and recovery coverage use it. Branch validation finishes before
  mutations; restoration and recovery retain their separate authority checks.
  Noncanonical content, unsupported mode and excessive decoded bytes have
  regression checks asserting unchanged original contents/index and no new file.

Red evidence: `evidence/117-review/red.log` records 22 failures / 7 passes
against the original branch/expiry helpers. Most branch failures first exposed
capture's ENOTDIR gap; after correcting capture, `red-branch.log` isolates the
original helper's uncertain result instead of successful branch creation.
`intermediate.log` records the incomplete capture fix run and is not acceptance.
The initial dependency-free attempts could not start; locked dependencies were
installed without dependency changes. No test framework or application feature
was added.

Final verification results are recorded below after execution. Raw logs live in
`evidence/117-review/`. Existing manual VoiceOver/native macOS gates remain
unperformed and user-owned; #141/#117 remain open. No paid provider, physical
power-loss/ENOSPC or deferred exhaustive capacity/multi-client checks are claimed.
No closure, PR or merge into integration is performed. A fresh independent Astra
review remains subsequent work.

Final executed results:

- Full host suite: **365 passed, 6 skipped, 3 failed** in 143.48s. Two
  15-second timeouts (durable-send reconnect and worktree creation), plus the
  activity test's busy-state poll timeout. This is not a clean full-suite pass.
- Serial affected/retry suite: **59/59 passed**, six files, 125.36s:
  boundaries, historical-files, checkpoint-expiry, recovery-copy, durable-send,
  worktrees. All three full-run failures passed in this serial run without
  changing tests, production logic, timeout budgets or assertions.
- Combined packaged checkpoint/history scenarios: **9/9 passed**, 1.6 minutes.
  Includes navigation, streaming, file inspection, before/after branches,
  summarized continuation, protected restoration, expiry and fresh capture.
- Typecheck, lint, build and package passed. Lint retains four existing warnings;
  no new lint error. `git diff --check` passed.
- Final integration-tip merge: already up to date at
  `ac2f4662fc7a700aab2d3993c39a5a56bf2d53da`; `0a9c981` remains an ancestor.

All four supplied findings have implementation responses and passing focused
checks; no known objection from these reports remains unaddressed. The failed
full-run timing evidence is retained as a qualification limit, not erased or
represented as passing. No new performance improvement is claimed.

## Round-two implementation response

Base: `37361ea4da8f7b867147935f01d535f41ffb814a`, preserving
`0a9c981` and all four R1 fixes from `24d176f`. Read the original
R1 and R2 Standards/SPEC reports, #117/#133, accepted specification and ADR.
No open wayfinder map exists; standalone #117 authorization applies.
No product terminology changed.

- **SPEC P2, in-place file/directory transitions:** preflight the complete plan,
  allow a covered regular-file parent scheduled for deletion, remove eligible
  leaves first, then only empty replacement directories, then atomically replace
  captured leaves. Preflight recursively refuses excluded contents and nested
  repositories; symlink parents remain forbidden and symlink leaves are never
  followed. Recheck authority/isolation and paths before effects. The existing
  authenticated real-Git/SQLite restoration fixture now covers both directions,
  ignored and ignored-symlink collisions, nested-repository collisions, abandoned
  confirmation, unavailable/stale targets, unchanged index/source, retained unsaved
  text and exact loaded baseline, partial effects and duplicate/restart no replay.
- **STANDARDS message-driven safety:** transfer uncertainty is an explicit
  optional boolean on the validated result; only that field and pending recovery
  decide identity retention. Stop persistence failure returns an uncertain
  receipt with `reason: emergency-stop-available`; preload carries that small
  result through the bridge and the UI offers cancellation from the discriminant.
  Human copy no longer controls either decision. Other RPC failures remain string
  errors; no broad error framework was added. Real failed-worker and authenticated
  failed-SQLite preparation tests assert the reason and actual cancellation
  count, retained reservation and zero submitted turns. Transfer outcome-write
  loss checks typed uncertainty and duplicate no-replay through authenticated RPC.

Red/green and final qualification logs are in `evidence/117-r2/`.
The original restoration helper fails the new covered-transition fixture
(unavailable rather than ready). The original Stop helper throws instead of
returning the explicit eligibility reason. Initial dependency startup failure
was corrected by frozen install. The initial red boundary run also retains three failures from transition
assertions initially placed in the branch fixture; they were moved into the
restoration fixture. It is not acceptance.
The prior empty-directory partial-failure injection now uses nested excluded
content, because an empty directory is a valid covered transition.

Integration-tip reconciliation was already up to date at `37361ea`.
No closure, PR or integration merge. #141/#117 manual native/VoiceOver gates
remain open; fresh independent Astra R3 review remains subsequent work.

Final R2 qualification (2026-10-31):

- Final complete host run, strictly serial:
  `bun run --cwd apps/desktop test -- --maxWorkers=1 --no-file-parallelism`:
  **368 passed, 6 skipped**, 43 passing files / 2 skipped, 325.44 seconds.
- Combined packaged `tests/checkpoints.spec.ts tests/history.spec.ts`:
  **9/9 passed**, 1.1 minutes, one worker. Includes fresh capture/unavailable
  coverage, navigation, streaming, file inspection, before/after branching,
  summarized continuation, protected dirty-editor restoration and expiry.
- Final typecheck, lint, build and unsigned macOS arm64 package passed.
  Lint retains four existing warnings. `git diff --check` passed.
- Earlier full run: 363 passed / 6 skipped / 5 failed. Three failures were
  misplaced assertions, one expected the old Stop exception, and the transfer
  loss fixture needed explicit recovery before admitting its next operation.
  The intermediate affected run passed 28/29, exposing one further old Stop
  exception expectation; the corrected control rerun passed, followed by the
  clean final complete host run above. All failed logs remain retained.
- No timeout budget or behavioral assertion was relaxed. Final host and packaged
  suites ran separately, each with one worker. No paid live provider, physical
  power-loss/ENOSPC, exhaustive capacity/multi-client or fresh manual native/
  VoiceOver qualification was performed. Existing opt-in skips remain explicit.
  No new performance or complete #117 acceptance claim is made.

Both supplied R2 findings have implemented responses and passing final checks;
no known supplied finding remains unresolved. Independent Astra R3 review is
still pending, and the user-owned #141/#117 gates remain open.
