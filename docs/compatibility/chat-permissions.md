# Next-message permissions (#152)

Qualified on 2026-10-31 with installed `codex-cli 0.166.0`, macOS 26.3.1 arm64.
Primary documentation: [App Server](https://learn.chatgpt.com/docs/app-server),
[Agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security).
The repository's generated app-server protocol independently advertises thread
start/resume reviewer overrides and turn approval/sandbox overrides.

## Exact mapping

All explicit modes set `approvalsReviewer: "user"`. This matters: the installed
configuration returns `approvals_reviewer: "auto_review"`; approval policy alone
would not qualify the Supervised label. Automatic reviewer mode is excluded.

- Supervised: `approvalPolicy: "on-request"`, `sandboxPolicy: {type: "readOnly", networkAccess: false}`.
- Auto-accept edits: `approvalPolicy: "on-request"`, `sandboxPolicy: {type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false}`. Codex permits workspace and its standard temporary-directory writes, not arbitrary filesystem writes.
- Full access: `approvalPolicy: "never"`, `sandboxPolicy: {type: "dangerFullAccess"}`. This disables sandbox filesystem/network restrictions and command approval.

Installed thread/start returned these exact effective sandbox objects and user
reviewer for all three modes. No custom roots are added. `configRequirements/read`
returned `requirements: null`. App-server resume probes on empty threads returned
`-32600: no rollout found for thread id`, both ephemeral and persistent: therefore
fresh threads receive policy on start, never an extra pre-turn resume. Real saved
conversation resume is not qualified by these empty-thread probes.

Installed bounded turn/start probes with all three exact policy objects returned
`status: "inProgress"` without errors; each was immediately interrupted. The
prompt requested no tools. This qualifies protocol acceptance, not tool enforcement.

## Authority and preservation

Choices live on the existing SQLite SavedChat record, through authenticated validated
host RPC. Send captures the choice before preparation and supplies it on turn/start.
Changing controls during preparation/execution only updates future choices. Resume
first inspects inherited effective policy, then reapplies and checks explicit policy;
unexpected results stop before Send. No selection, retry or restart submits a turn.

Custom profiles, configured workspace sandbox options (including network/custom
roots), network configuration, unknown approval modes and all non-null managed
requirements conservatively block preset replacement. Existing custom session roots,
network access and external sandboxes also block it. Resolve configuration externally;
there is no broadening confirmation that discards these restrictions. Unselected
chats display Inherited Codex policy rather than claiming a preset. App/project
permission defaults belong to the sibling defaults slice.

## Verification and limits

Typecheck, lint and production build passed. Five focused host suites passed
(22 tests, one opt-in live test skipped). Electron fixture checks cover all three
exact turn policies, preparation-time choice capture, future Send, restart retention,
absence of replay, and retained Stop. Model/effort Electron regression also passed.
Host policy admission tests reject custom roots/network, managed requirements and
invalid selections and check persistence through a fresh service.

One intermediate Electron run failed at the third Send while the build was changing;
the final rebuilt run passed. The permission-controls desktop screenshot was inspected.
No native VoiceOver, narrow/short-window, 200% zoom, packaged-app, real command
filesystem/network enforcement or saved-provider resume qualification is claimed.
Older Codex versions are not qualified for these new controls; unsupported effective
responses are rejected. Configuration can change externally between inspection and
provider execution; provider managed enforcement remains authoritative.

## Integration handoff

Merged integration `8ab8812` into this isolated implementation branch. Reconciled
model-control diagnostic suppression with permissions rather than dropping either
behavior. Post-merge typecheck/build, both Electron settings scenarios and the five
focused host suites passed. The initial post-merge typecheck caught the missing
`existingError` prop in the manually reconciled controls; it was restored before
these passing checks. No integration ref or root-checkout files were changed.

## Fresh merger qualification (2026-10-31)

Integrated approval commit `2bcfdec54cbe22c7d0fc04e27d0f17d6512cc41b`
and archive integration `c03fe1c04053722fab95f8c9e0aa858d0341c7d2` in
`t3/merge-approval-access-controls`. Conflicts retained both archive and permission
bridge operations and one copy of each glossary definition. No root checkout files,
integration refs, PRs or issues were changed.

Installed `codex-cli 0.166.0` enforcement probe used `command/exec` with the exact
three `sandboxPolicy` objects above. A disposable home-directory workspace and a
sibling outside directory avoided temporary-directory exemptions. Python attempted
a write to each directory and TCP connection to a listening localhost endpoint:

| Policy | Workspace write | Sibling write | Local TCP |
| --- | --- | --- | --- |
| readOnly | EPERM | EPERM | EPERM |
| workspaceWrite, empty writableRoots | EPERM | EPERM | EPERM |
| dangerFullAccess | allowed | allowed | allowed |

All commands exited zero and reported each operation's actual outcome. This verifies
bounded command-executor denial/unrestricted behavior, **not** the desired workspace
write behavior for Auto-accept edits. The command executor may resolve roots
differently from model turns. One additional model-driven workspace-write turn was
bounded to 55 seconds and timed out without a completion observation; it does not
qualify writes. No mapping change is justified by assuming those seams are identical.
External network destinations, escalation/approval delivery and custom-root runtime
enforcement remain unqualified. Custom/managed admission remains fixture-tested.

A real persistent read-only thread completed one no-tools user turn with assistant
reply `OK`. After terminating/restarting app-server, explicit thread/resume probes
requested each preset in sequence. Every response reported the **original**
`on-request`, user reviewer, readOnly/networkAccess=false settings, including the
workspace-write and danger-full-access override requests. History afterward contained
exactly the original completed turn, with no replay. Thus saved-thread policy changes
are **not qualified**; host response checking rejects mismatches before another Send.
Successful same-policy resume and protocol acknowledgment do not qualify broader
resume behavior. The three permission controls are not release-accepted by this report.

Local probe scripts/results are retained at `/tmp/escode-152-enforcement.py`,
`/tmp/escode-152-enforcement.txt`, `/tmp/escode-152-saved-resume.py`,
`/tmp/escode-152-saved-resume.txt` and `/tmp/escode-152-turn-write.py` (temporary
machine-local evidence, not durable repository dependencies).

The combined Electron run reproduced a third-Send failure twice: its provider fixture
reused the same turn ID, conflicting with completed-turn protection. The fixture now
issues a UUID for each turn and completes the exact interrupted turn. The focused
permission scenario then passed (10.6 seconds). This corrects invalid fixture behavior;
it does not weaken host duplicate-turn protection. Post-archive-merge typecheck, lint
and build passed; four focused host suites passed (19 tests, one opt-in live skip).

Final combined Electron selection passed **10/10**: both settings scenarios, six
title scenarios, Agents shared-context/archive/restore/preserved-draft scenario and
Agents/local Chats user-message recency scenario. Command:
`bun run --cwd apps/desktop smoke -- tests/permissions.spec.ts tests/models.spec.ts tests/chat-titles.spec.ts tests/agents.spec.ts --grep 'next message|chat titles|title generation|Agents restores closed|promote user messages'`.
Final typecheck/lint and `git diff --check` passed. Latest integration tip remained
`c03fe1c04053722fab95f8c9e0aa858d0341c7d2` and is an ancestor of this branch.
No packaged/native accessibility qualification or full regression suite was run.
