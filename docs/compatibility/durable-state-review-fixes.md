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
