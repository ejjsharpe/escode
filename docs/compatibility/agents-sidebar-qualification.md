# Combined Agents/sidebar qualification (#155)

Qualification branch starts at integration `4b875ca09ddc27493dc799a2a97d3391f331c874`.
This is fresh combined verification, not acceptance of parent #144. No open
`wayfinder:map` issue was returned. Parent owns PR #156, tracker updates and final review.

## Repair and scope

Codex user-message notification items have no created/updated timestamps in the
vendored schema. The host had assigned observation time on both started/completed
notifications, allowing a delayed echo to reorder a sent chat. The existing public
ChatService/store regression failed with a changed timestamp before repair.
Notifications now retain the explicit accepted Send timestamp. Assistant output,
completion and repeated user-item echoes cannot advance it. Exact provider-side
message-edit timestamps remain unavailable; transcript backfill is not invented.
No new product concept, persistence format, contract, caller or export is needed.

Existing conversation checks now exercise real Electron `setZoomFactor(2)` in
addition to constrained CSS viewports. The broad legacy Agents scenario stalled at an obsolete effective-settings locator;
its test was left unchanged rather than removing preservation assertions.

## Environment and reproducibility

2026-10-31: Darwin 25.3.0 arm64, Node 26.13.0, Bun 1.4.4,
Electron 45.1.0, Playwright 1.64.1, installed codex-cli 0.166.0.
Dependencies installed with `bun install --frozen-lockfile` in this isolated checkout.
Commands and actual outputs are retained under [evidence/155](evidence/155).
Build: `bun run --cwd apps/desktop build`; packaging: `bun run --cwd apps/desktop package`.
Typecheck/lint use the corresponding desktop scripts. Lint retains existing warnings.

Host regression command and initial failure are in `host-green.log`: 31 passed,
one skipped, one 15-second durable socket timeout. Bounded repeat of the six durable
checks with `--testTimeout=30000` passed all six (`durable-rerun.log`).
The recency red result is retained in `recency-red.log`.

## Installed provider: actual effects

`python3 docs/compatibility/evidence/155/provider.py` performs bounded catalog,
command write, saved-resume and independent title probes in disposable directories.
`provider.log` records the full catalog and results. Model catalog includes
`gpt-6-luna`; title inference completed with “Fix Sidebar Keyboard Resizing and Focus”
(6 words, 39 characters). This is one deterministic request, not a general quality benchmark.

Actual `command/exec` writes outside temporary-directory exemptions:

| Policy | Workspace write | Sibling write |
| --- | --- | --- |
| readOnly | denied EPERM | denied EPERM |
| workspaceWrite, empty roots | denied EPERM | denied EPERM |
| workspaceWrite, explicit workspace root | allowed | denied EPERM |
| dangerFullAccess | allowed | allowed |

A separate real model turn with the app's empty-root workspaceWrite policy completed
and created `probe.txt` (`workspace-turn.log`). Thus command/exec is not interchangeable
with a model turn for root resolution. This qualifies a bounded workspace write,
not outside-root denial or approval escalation within model turns. The preliminary
older probe timed out once in Apple's Python launcher; its result is retained in
`enforcement.log`, superseded for write outcomes by the robust probe above. Its local
TCP probe denied network under workspaceWrite and allowed it under Full access;
external network and approval delivery are not qualified.

After an original persistent read-only turn completed `OK`, app-server restarted.
All three explicit thread/resume policy requests returned original readOnly,
on-request settings. History had exactly one turn: no replay. Host mismatch checking
continues to fail closed before another Send. **Saved permission changes remain a
release blocker.** No workaround broadens policy or creates a replacement conversation.
The first older resume probe timed out (`resume.log`); the fresh robust probe completed.

## Remaining manual gates

The user must run these against the resulting packaged build; DOM checks and screenshots
cannot satisfy them:

- VoiceOver: traverse consolidated tabs, resize separator, recent rows with complete
  project/checkout labels, running and needs-input statuses, archive footer and Settings.
- Rename/Regenerate and Archive/Restore: confirm announcements, disabled explanation,
  retained selection and keyboard focus after list changes.
- Composer: read exact bound context, next-message model/effort/permission labels,
  approval/input/error content, expanded tool activity and Copy code feedback.
- Native keyboard at 200%: reach context/settings/Send/Stop, scroll transcript separately,
  resize sidebar and window, and return from Files/Diff/Chats with focus and dirty text intact.
- Native dialogs/clipboard/window lifecycle: confirm macOS focus return, code clipboard,
  close/reopen and Quit cancellation preserve drafts, buffers and running work.

Broad exhaustive capacity/multi-client qualification, legacy migration and full manual
accessibility acceptance were not performed. Do not close #155 or claim complete #144
acceptance while provider and manual gates remain.

## Visual comparison limits discovered during qualification

Accepted local prototype `docs/prototypes/agents-ux/index.html` was rendered through
installed Chrome at 1000×700; the actual packaged conversation was inspected at
1000×700, 800×500, constrained 600×450 and real Electron 200% zoom. Reference composition
uses compact context/model controls and icon actions; implementation retains visible
native selects and text action labels. This is not pixel-equivalence acceptance.
The native 200% capture exposed a nearly collapsed history area despite the old
viewport checks passing. The regression measured zero pixels of history before repair. Short-window composition
now caps its height at 30vh, retaining its independent scroll area and sticky actions.
Complete state-by-state visual/contrast and keyboard acceptance remains open; passing
viewport visibility alone is insufficient evidence for requests or permission controls.

## Fresh integrated application results

`ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/chat-summaries.spec.ts tests/chat-titles.spec.ts tests/navigation.spec.ts tests/models.spec.ts tests/permissions.spec.ts tests/project-drafts.spec.ts tests/worktree-drafts.spec.ts tests/conversation-layout.spec.ts tests/concurrency.spec.ts tests/emergency-stop.spec.ts tests/editable-diff.spec.ts tests/file-tabs.spec.ts --timeout=90000`
finished **27 passed, 2 failed** in 4.7 minutes (`packaged.log`). Passing coverage includes
five identically named projects/thirty chats/three active, stable recency, title races,
next-message settings/defaults/restart, navigation/independent sidebar widths and clients,
editable diffs, six file-tab scenarios, concurrency and four emergency Stop failures.
The first project-drafts failure expected effective settings outside Chat actions;
the locator now opens/closes that menu explicitly. Worktree-drafts did not reach Stop
within 15 seconds after Send. The final isolated packaged worktree rerun passed in 17.2 seconds
(`worktree-rerun.log`), including deferred preparation, preserved edits and active-removal
protection. The initial timing failure remains unexplained; no single clean all-29 run
is claimed.

The zoom regression failed at zero history pixels (`zoom-red.log`); an initial 35vh
adjustment left only 59 pixels (`zoom-first-adjustment.log`). At 30vh the minimum
60-pixel history assertion and keyboard Stop pass (`zoom-green.log`). Rebuilt packaged
conversation and corrected project-draft scenarios both pass (`packaged-final.log`,
2/2 in 21.1 seconds), including draft context binding/restart without repeated Send. The inspected final native-200
capture is retained here. Composer settings require scrolling in this constrained state;
full request visibility/focus/contrast across every accepted state remains unqualified.

The initial broader built-Electron run timed out in legacy Agents at the effective-settings
locator and was stopped (`electron-initial.log`). Archive/local shared-metadata assertions
precede that failure, but this is not a passing scenario. Remaining visual comparison
states (Archived/unavailable/Files/Diff/Chats at all requested sizes), combined No project/
unavailable/Archived within the thirty-chat fixture, full effective-effort restart enforcement,
and the manual gates above remain open. This report deliberately does not turn these
incomplete gates into acceptance.

## Handoff

Latest local integration tip `4b875ca09ddc27493dc799a2a97d3391f331c874` was merged
before handoff (already contained). Final build, package, typecheck, lint and whitespace
checks passed; lint has existing warnings. Final packaged zoom/project-draft checks
passed 2/2 and isolated worktree qualification passed 1/1. These focused reruns cover
the changed CSS and fixture; the larger packaged run predates the CSS repair.
No root checkout files, integration ref, issue state or PR were changed; no agents spawned.
Saved-resume policy changes and the outstanding visual/native/manual gates prevent
complete acceptance. Final independent code review remains with the parent.

## Fresh isolated merger verification

Merged `a096f7c99e12a01e594d3874e42bf34f41ad661e` without conflicts onto
`4b875ca09ddc27493dc799a2a97d3391f331c874` in branch
`t3/merge-agent-sidebar-144` at `/tmp/escode-144-merger`. Integration and original
checkout remain untouched; no PR/tracker changes or further agents.

Fresh evidence is retained in [evidence/144-merger](evidence/144-merger).
PATH initially selected Bun 1.3.14, which could not parse the lockfile; initial
build/test attempts lacked dependencies. Installation with the existing
`/tmp/escode-bun-1.4.4/bun-darwin-aarch64/bun` and frozen lockfile succeeded.
All successful commands below used that binary first on PATH.

- Public host regression: `bun run --cwd apps/desktop test -- host/chat.test.ts -t 'turns, approvals and Stop stay scoped'`: 1 passed, 9 filtered/skipped. It checks delayed started/completed user echoes retain accepted Send recency.
- `bun run --cwd apps/desktop test -- host/permissions.test.ts host/models.test.ts`: 2 passed.
- Desktop build, package, typecheck and lint passed (existing lint warnings).
- `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/conversation-layout.spec.ts tests/chat-summaries.spec.ts tests/project-drafts.spec.ts --timeout=90000`: 5 passed in 34.8 seconds. This covers real 200% history height/keyboard Stop, thirty-chat recency and exact context, summary isolation, draft movement and restart without repeated Send.

Visual coverage now additionally captures empty No project composition at 1000×700,
800×500 and real Electron 200% at 1200×900. The 200% needs-input check explicitly
scrolls the permission heading into view. Inspected captures retain independent
history and reachable Stop; empty composition scrolls and hides some settings below
its initial visible region. The permission capture shows only part of the request,
not simultaneous visibility of its full content/response controls. These checks do
not establish full keyboard traversal, contrast or mockup equivalence. Production
code was not changed by the merger; existing repair red/green logs remain above.

Unresolved implementation/runtime blocker: installed-provider saved-policy resume
returns the old policy; host rejects mismatches before submission. No unsafe fallback
was added. Full effective-effort restart enforcement and model-turn outside-root/
approval behavior remain unqualified. Agent-executable qualification still lacks
complete Archived/unavailable/Files/Diff/Chats size/zoom comparisons and the combined
No project/unavailable/Archived thirty-chat fixture. These are qualification gaps,
not evidence that those implementations fail. User-owned VoiceOver, native keyboard,
dialog/clipboard/window lifecycle checks remain exactly as listed above. Independent
review follows; neither #155 nor parent #144 is accepted by this merge.
