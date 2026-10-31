# Fresh merge evidence, 2026-10-31

Base ad56bf0; merged dcd23ea without conflicts. Parent owns integration, PR156 and tracker.

Commands use Bun 1.4.4 from `/tmp/escode-bun-1.4.4/bun-darwin-aarch64`.
Build/package/typecheck/lint logs name their commands. Existing build/lint warnings retained.
`host-final.log`: permissions and models, six passing checks.
`network-red.log`/`network-green.log`: restricted Send refusal regression.
`title-red.log`: read-only title execution regression (bounded timeout before refusal).
`contrast-red.log`: inactive Monaco line number 4.08:1, below 4.5:1.
`toolbar-red.log`: narrow filename wrapped to 198px height.
`packaged-final.log`: 10 passed, before final contrast/toolbar repairs.
`contrast-keyboard-final.log`: 4 passed / 1 failed; focusing the already focused
approval button after resize did not scroll it. `request-tab.log` tests real Tab
movement and passed at all four sizes. This was a test setup correction, not a
production focus repair. `qualified-final.log` is the final focused packaged run.

Network scripts run from repository root with Python 3 and installed Codex 0.166.0.
They use disposable home-directory workspaces and never grant escalation.
`network-command.log`: direct app-server command/exec denies DNS under both policies.
`network-turn.log`: model commandExecution, `/usr/bin/curl --noproxy "*" -I
--max-time 5 https://example.com`, approval never, workspaceWrite networkAccess false,
completed exit 0 / HTTP200. No proxy, browser, fetch or MCP substitution.
`network-legacy.log`: disabling unified_exec still returned HTTP200.
`effective-config.json`: selected policy-related effective config/read fields only;
no custom network/permission overrides returned. Thread/start returned requested
workspaceWrite networkAccess false. Installed generated TurnStartParams schema
calls sandboxPolicy an override for this and subsequent turns; networkAccess is
boolean on workspaceWrite. Requested policy metadata is not proof of enforcement.
Earlier rollout effective profile also explicitly recorded restricted networking.

Inference: reproducible installed model-command enforcement mismatch, not merely
an invalid connectivity probe or an escode omitted turn override. These bounded
results do not establish whether the defect is upstream Codex, its local runtime,
or another installed platform component. No safe config workaround was qualified.

Primary documentation consulted:
- https://learn.chatgpt.com/docs/app-server — turn-level sandbox overrides.
- https://learn.chatgpt.com/docs/agent-approvals-security — command sandbox and
  approvals are separate; capability-specific traffic has separate controls.

Containment: exact stable 0.166.0 refuses restricted task Send, including inherited
restricted settings, before submission/Send intent. Title inference also refuses
its read-only provider execution and keeps fallback titles. Full access requires
explicit selection; saved-policy conflicts still require their existing explicit
resolution. Version guard is deliberately conservative and scoped to the observed
installation version. Other versions are not newly qualified by this check.
