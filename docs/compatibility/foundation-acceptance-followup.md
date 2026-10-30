# Foundation qualification repairs

Follow-up to [Accept the complete local foundation](https://github.com/ejjsharpe/escode/issues/86)
and the [initial integrated record](foundation-acceptance.md), on 2026-10-30.
The starting commit is `5373c2f`; application fixes are in `e970363`, with final acceptance fixtures at `ae0114f`. **Applicable local qualification is complete, including user-confirmed manual checks on 2026-10-30, within the recorded limits.**

## Repairs

- Request Electron client-storage flushing after composer edits and accepted Send
  clearing. The existing edited-composer crash/restart scenario passes. Electron
  exposes no completion acknowledgement for this flush: recovery remains best
  effort, without a transactional or immediate-crash durability guarantee.
- Disable Compare while a save/Overwrite disk check is pending, preventing it from
  opening the previous conflict version before the latest result arrives.
- Reuse the React root during development module replacement; isolate development
  test cleanup from renderer readiness so a failed reload cannot strand the runner.
- Reconcile fixtures with client-owned composers, versioned cleared journals,
  explicit recovery after confirmed crashed-owner exit, project-scoped chat counts,
  distinct live request/turn identities and asynchronous context changes.
- Scope the delayed Finder authorization fixture to its intended request so
  background summary polling cannot consume its fault. Retain listing faults for
  the unavailable-state assertions, then explicitly restore normal listing.
- Await visible Monaco diff results before testing F7. Three consecutive keyboard
  journeys passed, retaining navigation, accessible comparison, live input and Stop.

Provider Retry behavior is unchanged: it preserves the existing session. The tool
failure fixture explicitly disconnects its provider before testing reconnection.
Recovery snapshots seeded after fixture teardown verify loading, without claiming
that orderly Quit preserves unsubmitted synthetic state; lifecycle tests separately
exercise actual edits and Save/Discard/Cancel.

## Verification

The complete integrated Electron suite passed **116 tests**, with three opt-in
provider checks skipped and no runner errors (7.6 minutes). See the
[raw integrated log](foundation-acceptance-followup/integrated-smoke.log).
Typecheck, lint, the complete unit command, build and unsigned macOS packaging
passed; command logs are retained beside the integrated result. The final
focused development, reveal/filter and packaged/unpackaged conflict command passed
all eight tests. The initial follow-up integrated run exposed the Finder fixture
race and both conflict races; a subsequent run was stopped after reproducing the
Monaco readiness race. The concurrent-chat fixture also needed to settle its opening operation before
installing a delayed-create hook and release all gates during teardown. The last
pre-final run had 115 passes and one premature project-draft acceptance assertion;
that assertion now polls the same expected accepted receipt and cleared composer.
Three consecutive project-draft runs passed. The
[pre-final raw log](foundation-acceptance-followup/pre-final-smoke.log) preserves
that failure. Failed or interrupted runs are not acceptance evidence.

All three opt-in packaged installed-provider tests then passed in 39.7 seconds,
serially after the integrated suite, using Codex 0.166.0. They cover saved streaming
and reopen, scratch/deferred-worktree first Send and history, and observed live
output. The live-output check observed 134 batches, a largest decoded snapshot of
1,671 bytes and 5,040 spool bytes across 21 files. These are bounded observations,
not production budgets. See [live-provider output](foundation-acceptance-followup/live-provider.log).

The actual packaged ASAR contains `codex-extraction.json` (4,415 bytes),
`foundation-NOTICES.txt` (17,864 bytes) and `foundation-dependencies.json` (341 bytes)
under `dist/host`. No dependency, license, domain authority or transport fallback
was added. The new native lifecycle operation validates the originating window,
frame and document and only requests flushing of that client's Chromium storage.

Environment remains macOS 26.3.1, Bun 1.4.4, Electron 45.1.0; the installed packaged
provider target is `/Users/elliotsharpe/.bun/bin/codex` 0.166.0.
A fresh empty package with restricted PATH reached Open project in 747 ms.
Main private memory was 62,036 KiB; Browser and Tab working sets were 195,808 and
174,736 KiB. The prior qualification's single empty-package observations were
778 ms, 62,260 KiB, 196,896 KiB and 174,864 KiB respectively. See the
[raw startup sample](foundation-acceptance-followup/idle-package.json).
There was no forced GC or soak; these samples cannot establish memory growth or savings.

The generated 20,000-file tree measured root visible/expansion/two arrow keys/
external update at 758/125/9/261 ms, versus the original historical
698/59/10/199 ms. The 500 MiB/8,000-file UI copy measured 3,769 ms with visible
Stop at 34 ms, versus historical 3,499/81 ms. These are individual workload
observations with variation, not a regression threshold or improvement claim.
The passing unit suite retains basic stalled-delivery/admission, bounded history,
spool quota and injected disk-failure checks; full-volume disk fill and sustained
capacity qualification remain unperformed.

The original record's bounded baseline comparison and capacity limits remain in
force. No broad compatibility or sustained-load improvement is inferred.

## Manual qualification

The [manual checklist and prepared local session](foundation-manual-checks.md)
provides steps, expected results and a reporting format. It uses isolated temporary
state and a deterministic input-request fixture. A separate packaged rehearsal
passed fixture selection, live input, renderer reload with retained selected chat
and composer, and Stop after waiting for the debounced selection save. See the
[rehearsal result](foundation-acceptance-followup/manual-rehearsal.log).
On 2026-10-30 the user confirmed that everything in the supplied checklist was
fine, after the stale-lock recovery and corrected fixture launch instructions.
This supplies current-build user-reported keyboard/focus/VoiceOver evidence for
close/reopen, renderer reconnect, conflicts, Needs input, Quit and Files/Source
Control. See the checklist's reported-results section for provenance and setup
incidents. No detailed announcement transcript was supplied. Prolonged socket-only
failure announcements are not independently evidenced by the renderer reload
check. Native Finder/clipboard/Trash follow-up remains outstanding under the
accepted exclusion.

Legacy import, upgrade/downgrade support, exhaustive multi-client/revocation and
full sustained-load qualification remain excluded and unclaimed.

Standards and specification reviews found no remaining actionable issues after
cleanup fixes. Static reviews do not substitute for runtime or manual results.
