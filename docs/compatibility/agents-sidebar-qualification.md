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

## Independent review repairs (fresh sole implementer)

Branch `t3/fix-agents-sidebar-findings` starts at `edae592`. Latest local
`integration/agents-sidebar-144` was merged before handoff (already contained).
No root files, integration ref, PR or tracker changes; no additional agents.
Evidence is retained in [evidence/144-findings](evidence/144-findings).

- P1: Codex 0.166.0 was probed again with the existing bounded disposable-provider
  script. All three resume modes returned original readOnly/on-request; history
  retained one turn. The [primary app-server documentation](https://learn.chatgpt.com/docs/app-server)
  describes resume and turn overrides, but the installed behavior does not establish
  effective resume application. We therefore use explicit UI resolution: reconnect
  loads history under the original identity, displays the retained effective settings
  and a policy-conflict alert, and blocks Send. Selecting the matching retained preset
  explicitly clears the conflict; custom/managed policy and reviewer mismatches remain
  protected. No automatic selection, policy broadening, replacement thread or replay.
  Host regression verifies retained transcript, identity and draft, zero submissions
  on conflict, and exactly one submission following explicit resolution.
- P2: only explicit model/effort selection updates current selection. Catalog mounting
  and Send validation cannot update it. A delayed background catalog regression fails
  before repair (next draft incorrectly uses B) and passes afterward (uses selected A).
  Existing defaults precedence, remembered effort and explicit draft choices remain.
- P3: start/resume now derive their thread representation from the same permission
  mapping used by turn/start and mismatch validation. Reviewer, sandbox fields and
  resumed identity checks remain enforced.

Public ChatService regressions were written first; both new regressions failed on
original code (`144-red.log`). Final host run: 13 passed, one opt-in live test skipped.
Build, package, typecheck and lint pass (existing warnings). The installed probe also
repeats bounded command sandbox writes and independent title inference; these do not
qualify full model-turn enforcement. Original provider/runtime-blocker statements
above describe the previous build; unsupported resume changes now have a safe explicit
resolution, rather than making history inaccessible.

Manual VoiceOver/native keyboard/dialog/clipboard/window gates, full effective-effort
and model-turn enforcement, combined thirty-chat states and complete visual comparisons
remain open exactly as above. No full #144/#155 acceptance is claimed.

Packaged test development retained initial failures: one preparation disconnect while
a rebuild overlapped (cause unestablished), then an incorrect attempt to click the intentionally disabled
Send, then a later stale Stop target. Delaying fixture completion did not fix that
separate error; explicit reload also failed to clear its disabled Send state. The
fixture retains original behavior and checks the workspace turn before restart,
then checks conflict resolution after restart without another subsequent Send. The conflict flow
had already passed before that final Stop failure; these initial runs are not clean
qualification and are retained. No production Stop behavior was changed.

Final focused packaged run (`144-packaged-final-scope.log`): **2 passed in 19.0s**.
It preserves workspace-policy coverage before restart and checks persisted model/effort,
conflict alert, disabled Send, retained draft, no replay and explicit supervised resolution
after restart. The separate stale Stop/recovery issue observed when attempting another
post-resolution turn remains unqualified; rearrangement is not evidence it is fixed.

## Review-fix merger and stale-control recovery

Fresh isolated branch `t3/agents-sidebar-review-fixes` fast-forwarded from `edae592` to
`b7cc25f76a824e8b2b51e006f8380072978ec79a`. No integration ref, original checkout,
PR or tracker changes; no further agents. Read live #144/#155 and the supplied
specification/reviews; no open wayfinder map exists.

P1 retains the saved provider identity/history and client draft while rejecting
incompatible Send until explicit matching-policy resolution. P2 catalog reads and
Send validation omit the deliberate-selection argument and cannot write current
selection; the delayed-catalog public-host regression passes. P3 thread start and
resume share `threadPermission`, derived from `permissionPolicy`; exact identity,
reviewer and sandbox checks remain.

Investigated the separately reported stale Stop/recovery failure. A snapshot target
can become obsolete across preparation/turn transitions; rejection protects the exact
origin and must remain. The recovery defects were that preload retained a definitively
rejected control as pending, and a subsequent successful Stop did not clear the old
renderer error (scratch Send disables on that error). Terminal accepted/rejected
controls now release their client recovery key through the existing persistence gate;
uncertain controls and host receipts remain. A new Stop clears its previous client
error and reports any new failure. No target replacement, automatic retry or Send replay
was added. These paths predate the review-fix candidate and affect its requested
preservation flow.

The focused Electron test first failed because a rejected obsolete Stop left its
recovery key. It now verifies rejection and key release, then fresh Stop, subsequent
workspace-policy Send, restart conflict/draft preservation, explicit resolution,
one further Send and Stop. An initial unchanged single run passed; a repeated
baseline run also encountered a timeout, so these results do not establish elimination
of every timing race. The original timing-specific stale-target delivery was not
reproduced deterministically; its safe rejection remains intentional.

Fresh evidence: [144-review-merger](evidence/144-review-merger). Host combined
checks: 21 passed, one opt-in live test skipped, across permissions, models, chat,
SQLite controls, emergency preparation and durable Send. Development Electron combined
permissions/models/conversation-layout: 3 passed. Build, package, typecheck and lint
passed (existing warnings). The test's initial mutable-array type error was corrected
before the passing typecheck. Packaged combined results are recorded below.

All existing installed-provider effort/model-turn, workload/visual and user-owned
native/VoiceOver limits remain. No full #144/#155 acceptance is claimed.

Packaged combined permissions/models/conversation-layout run: **3 passed in 27.7s**.
The permission check includes the post-resolution explicit third Send and Stop;
it is no longer limited to resolution without subsequent execution.

## Fresh qualification follow-up from `747ee26`

Isolated branch `t3/agents-sidebar-qualification`, 2026-10-31. Evidence and reproducible probes:
[evidence/155-followup](evidence/155-followup). No root checkout, integration ref,
PR or tracker writes; no spawned agents. Installed Codex remains 0.166.0.

The existing thirty-chat Electron fixture now combines five identically named
projects, three active chats, No project, an unavailable checkout with a long title,
and an archived chat. It verifies stable recency after background output/Stop,
full context titles, archive list membership and keyboard footer focus across
1000×700 desktop, 600×700 narrow, 1000×450 short and native Electron 200% at
1200×900. This extends the existing seam, rather than adding another app authority.

The new Files/Diff/Chats test uses an isolated real checkout and file, captures the
same four sizes, activates each control with Enter, verifies selected state and
focus, keyboard-resizes the sidebar, and measures control text contrast against
its computed opaque background (at least 4.5:1). Initial failure is retained in
`sidebar-initial.log`: switching to Chats left focus on the hidden Files/Diff copy
of navigation. The minimal repair focuses the selected visible control on the next
animation frame. The same regression now passes; no workspace or provider behavior
was changed. Changed scope: project-view navigation and its Electron qualification;
no contracts, persistence, exports or domain terms change.

Development combined run: 2 passed in 10.8s. Packaged combined run: 2 passed in
11.5s; final run including the opened file: 2 passed in 10.1s. Build, package,
typecheck and lint passed (existing warnings). These are focused checks, not a
repeat of every earlier preservation suite. The final archive-conversation capture
rerun is recorded separately.

### Accepted reference comparison

`reference-*.png` captures the accepted local HTML through a separate Electron
session (the application's CSP correctly blocks its inline script in the app
session). The saved capture spec can be temporarily copied into desktop/tests to
repeat; it deliberately names the supplied local reference path. Reference zoom
is applied after each navigation; `reference-final.log` supersedes initial captures.
The prototype has an outer study toolbar and a fixed-height example window, so its
200% crop differs from the production window. No pixel-equivalence claim is made.

Production captures cover Archived/unavailable and Files/Diff/checkout-local Chats
at all four sizes. Compared with the reference, the top icon-labelled project
navigation, sidebar/main separation and focus treatment agree in structure. Files
and Diff retain their existing tree/status surfaces. The checkout-local Chats
capture initially has an empty list, rather than the reference's sample running
conversation; combined workload/provider scenarios cover running chats separately.
Unavailable errors preserve the exact path and recovery action, but duplicate error
text occupies substantially more space than the accepted compact error card.
Archived list switching retains the independent selected conversation, matching
its explanatory notice. Native 200% retains reachable navigation and footer controls;
reference and production both crop content and need scrolling. These observations
are qualification findings, not final visual acceptance. Control contrast is measured;
complete per-element contrast, full keyboard traversal of every request/settings
state, and populated Files/Diff/Chats visual parity remain agent-executable gates.

### Actual provider behavior and restart

`../155/followup-provider.py` runs two explicit turns separated by app-server restart,
using gpt-6-luna, low effort, on-request approval and workspaceWrite with network false.
The final probe explicitly sets reviewer `user`; the initial run omitted it and
observed auto_review, so it is not evidence for the application's reviewer mapping.
`provider-user-observed.json` extracts only relevant local provider turn settings
and tool output, rather than copying full session instructions or credentials.

- Actual model-tool workspace write succeeded; sibling outside-root write failed
  with EPERM and the outside file remained absent.
- Actual `curl -I --max-time 5 https://example.com` returned HTTP 200 despite
  restricted-network settings. This is a demonstrated installed-provider enforcement
  limit, not successful network isolation. No access was broadened by the probe.
- Resume returned xhigh despite requested low. Both admitted turn contexts and
  `thread_settings_applied` events record low effort, including the explicit turn
  after restart. Thus effective turn override is evidenced separately from misleading
  resume metadata. History contained exactly one turn before the second explicit
  request: restart did not replay work. Original permission-conflict resolution
  and host mismatch validation remain unchanged.
- `approval.py` starts read-only with reviewer user, observes a real command approval
  request, declines it, and asserts the file remains absent. `approval.log` retains
  request delivery and outcome. This does not qualify native UI or a granted escalation.

Remaining agent gates: resolve/contain the observed installed-provider network
restriction failure before claiming the presets' complete enforcement; finish
per-element contrast/request keyboard and populated visual parity assessment, including
the duplicate unavailable error presentation. Remaining human gates: actual VoiceOver,
native keyboard/dialog/clipboard/window lifecycle checks listed above. No complete
#144/#155 acceptance is claimed, and the parent owns independent review and PR #156.

Additional selected-Archived capture reached all four sizes and its assertions passed,
but shutdown then stalled; a kill-based teardown also left the runner open, and an
attempt to close after kill stalled. These interrupted experiments are retained in
`archive-*.log`. The committed regression keeps the previously clean combined list
qualification and its original teardown; selected-Archived captures are visual evidence
only, not a clean automated lifecycle pass. This additional fixture/provider shutdown
interaction remains an agent gate. No production lifecycle workaround was introduced.

## Fresh merge onto ad56bf0: network containment and completed executable checks

This section supersedes earlier follow-up handoff gaps for the checks listed here.
Branch `t3/agents-sidebar-qualification-1` merges candidate `dcd23ea` onto
`ad56bf0` without conflicts (merge `d813c69`). Activation, explicit reconnect
policy-conflict resolution and stale Stop fixes remain present. No integration ref,
root checkout file, PR or tracker mutation; no subagents. No open wayfinder map was
returned. Evidence: [155-merger](evidence/155-merger/README.md).

Installed **Codex 0.166.0 cannot currently be qualified for restricted execution**.
Fresh shell-only model turns returned exit 0 / HTTP200 for `/usr/bin/curl --noproxy
"*" -I --max-time 5 https://example.com`, with approval **never**, workspaceWrite
and networkAccess **false**. This removes escalation, proxy inheritance, browser,
MCP and JavaScript fetch as explanations for this fresh result. Disabling
unified_exec also returned HTTP200. Direct app-server command/exec instead denied
DNS under readOnly and workspaceWrite. Effective config/read returned no custom
permission/network overrides; thread/start returned restricted metadata. The
installed generated schema describes turn/start sandboxPolicy as an override for
this and subsequent turns. The prior rollout likewise records a restricted
permission profile. Policy metadata therefore cannot establish actual isolation.

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server)
and [approvals/security documentation](https://learn.chatgpt.com/docs/agent-approvals-security)
distinguish command sandbox policy from approvals and capability-specific traffic.
Our probe exercised commandExecution itself. This is a reproducible installed
model-command enforcement mismatch; these checks do not identify the responsible
upstream/local runtime component. No safe configuration workaround was established.

Containment now refuses restricted task Send on exact stable 0.166.0 before Send
intent/submission, retaining history, identity, draft and policy. Inherited
restricted execution is also refused. Its read-only title inference is refused,
retaining the existing fallback. The permissions surface explains unsupported
isolation and offers explicit resolution; Full access is never selected implicitly
as a workaround. Saved-policy conflicts retain their existing separate explicit
resolution. Permission tooltip and glossary describe requested networking policy
rather than an unconditional enforcement claim. Other provider versions have not
been newly qualified. A qualified provider/runtime is still needed to deliver
restricted execution on this installation.

Executable checks completed:

- Six public host checks pass (permissions and models); restricted Send refusal
  failed before the fix, and title refusal failed before the fix. Existing saved
  history/conflict and deliberate model-default checks remain passing.
- Packaged combined workload, recency/context, view-switch focus/resize and
  conversation checks pass **5/5**, after final production changes. Thirty chats
  include five same-named projects, three live peers, No project, unavailable and
  Archived contexts. All peers stop; Archived fixture app close and directory
  cleanup complete successfully. The old shutdown failure is superseded by this
  successful full scenario, not bypassed.
- Packaged model and four emergency Stop scenarios passed within the preceding
  **10/10** run. The final focused run follows the contrast/toolbar repairs; a
  new all-ten run is not claimed.
- Permission actions are traversed with actual Tab movement at 1000×700, 600×700,
  1000×450 and Electron native 200% at 1200×900. Each receives focus in view;
  independent history/composer scrolling and keyboard Stop pass. Additional
  input-request text entry and Send answers traversal pass **1/1** at all four
  sizes, with retained typed text and both requests visible in history.
- Rendered leaf-text contrast audit found inactive Monaco line numbers at about
  **4.08:1**. A failing assertion preceded raising that token; final sidebar
  assertions meet **4.5:1**. Captured conversation, requests, empty, unavailable
  and Archived states report no below-threshold text in this computed-style
  audit. Native widgets, alpha compositing and screen-reader output are outside
  this DOM measurement. Focus controls are checked independently of color.
- Visual inspection included request controls at all four sizes and the retained
  Files/Diff/Chats, Archived/unavailable captures. Narrow Files/Diff filename
  wrapping reached **198px** before repair. A failing regression preceded toolbar
  wrapping with a single-line ellipsized filename; the final four-size check
  passes. Existing reference captures remain the comparison baseline. The UI
  retains native selects/text actions and raw request detail, so pixel equivalence
  to the mockup is not claimed. Short/zoomed requests require scrolling; actual
  Tab navigation exposes their response controls.
- Final build, package, typecheck, lint and whitespace checks pass, with existing
  warnings. Request/input fixture additions have their own focused packaged pass.

Remaining blockers are explicit. **Platform:** restricted network enforcement is
unsupported on this observed installation and safely refused; provider/runtime
repair or qualification is needed before claiming that capability. **Human:**
actual VoiceOver announcements/navigation and native macOS keyboard, dialogs,
clipboard and window lifecycle acceptance remain user-owned, as enumerated above.
No known executable follow-up gate listed in this merger remains deferred. This
bounded qualification does not constitute exhaustive accessibility or parent
acceptance. Parent owns final review and draft PR156.
