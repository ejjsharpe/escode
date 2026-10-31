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
