# Foundation manual checks

For [Accept the complete local foundation](https://github.com/ejjsharpe/escode/issues/86).
The user reported all checklist checks were fine on 2026-10-30.
The prepared package contains application commit `e970363`;
record that commit and the package path before starting. The earlier package does not certify later fixes.
Use a disposable Git repository and test files, with VoiceOver enabled (Cmd+F5).
Use Tab/Shift+Tab and VoiceOver navigation to reach controls; activate them with
the keyboard. Record any step needing the mouse.

For each check report: **pass/fail/blocked; focus destination; announcement;
unexpected behavior**. Include macOS version, build commit, date and operator.


## Reported results — 2026-10-30

Elliot reported: “I did everything in the checlist you mentioned before and it was all fine”.
This records user-confirmed manual keyboard/focus/VoiceOver success for the supplied
close/reopen, renderer reconnect, conflict choices, Needs input, Quit cancellation,
Save/Discard and failed-Save checks, and Files/Source Control navigation. No
per-control announcement transcript or separate fault-injection log was supplied;
none is inferred. In particular, prolonged socket-only outage announcements remain
unverified separately from renderer reload.

Two setup problems occurred before this confirmation. Force Quit left the expected
exclusive foundation lock: after the failed startup exited, the foundation was
backed up, validated using the production validator on a copy, and only the stale
lock was removed. Launching without the fixture PATH then sent its synthetic
`thread` session ID to real Codex; the full launcher restores the correct provider.
Neither recovery means Force Quit automatically restarts or fake history is usable
by real Codex. The reported success follows the corrected launch instructions.

## Prepared local session

Double-click
`/tmp/escode86-manual.V3xFqf/Launch manual checks.command`.
It launches `apps/desktop/release/mac-arm64/escode.app` with isolated fresh state
under `/tmp/escode86-manual.V3xFqf/user`. Open project
`/tmp/escode86-manual.V3xFqf/project` and edit `notes.txt`.
Keep this directory until testing is complete so reopen checks use the same state.

The launcher uses the deterministic fake provider from the passing keyboard test,
not your Codex account. Sending any message produces a live question,
“Which name should I use?”. Answering ends the turn; Stop also ends it. Leave
that question pending to exercise active work, close/reopen and Quit. This fixture
checks interface behavior; separate automated packaged checks use installed Codex.
The fixture passed Node syntax, version and resume/history self-checks. The
packaged app selected this fixture and passed automated Needs input, renderer
reload with retained selection/composer, and Stop checks before handoff. It returns
empty saved history after app restart; real provider-history qualification is
covered by the separate installed-Codex checks.

**Use Cmd+W for close/reopen and Cmd+Q for Quit. Force Quit is a separate
crash test:** this build deliberately leaves `foundation/owner.lock` and blocks
restart until explicit recovery. Do not delete the user-data directory or remove
a lock while an owner is alive. After confirming all owners have exited, preserve
a copy of the foundation directory and validate its retained state; only a stale
lock may then be removed. An interrupted `state.json.tmp` needs separate inspection.
See [storage recovery limits](foundation-state.md). The launcher also sets the
fake-provider PATH; running only its final `exec` line does not set that PATH.

For client reconnect, leave the question pending and type a second unsent message,
pause briefly for the debounced recovery save, then use View → Reload (Cmd+R). Verify the same question and unsent text return,
then answer it once. This exercises renderer replacement and reconnection;
prolonged socket-only failure announcements still require agent-assisted fault
injection and must be recorded separately if not performed.

1. **Window close/reopen.** Open a test project, edit a file without saving, and
   start a chat that remains active long enough to close the window. Type a second
   message without sending it. Close using Cmd+W, then reopen from the Dock. Expect the file text,
   composer and original chat to remain; running work must not restart. Verify
   focus is reachable and VoiceOver can identify the editor, chat status and Stop.
2. **Reconnect.** First perform the renderer reload check above. Separately, use
   an agent-assisted interruption of the client socket while a
   chat is active (disconnecting Wi-Fi does not interrupt loopback). Keep unsent
   text in the composer. Expect an understandable unavailable/reconnecting state,
   reachable recovery controls, retained text and history after restoration, and
   no duplicate user message or new provider turn. This needs a prepared harness;
   mark blocked until it is supplied, rather than killing the host as a substitute.
3. **Save conflict.** Type unsaved text in a file. Change that same file on disk
   using another editor, then press Cmd+S in escode. Expect the conflict and file
   name to be understandable with VoiceOver. Use Compare; verify both versions
   have identifiable labels. Cancel must preserve unsaved text and external disk
   contents. Repeat and choose Reload: external text replaces the buffer. Repeat
   with new edits and choose Overwrite: the explicit choice saves your text.
   Confirm focus remains reachable after every choice.
4. **Needs input.** Use the prepared session above and send any message so the request
   is reproducible. Navigate away from the requesting chat, then return through
   its Needs input status. Verify VoiceOver reads the question, input labels and
   action buttons. Answer using the keyboard. Expect only that chat's request to
   resolve, with a comprehensible status change and usable focus. A normal reply
   in the transcript is not a substitute for a live request.
5. **Quit cancellation.** With an unsaved file and an active chat, press Cmd+Q.
   Verify the confirmation identifies affected work and all choices are reachable
   and announced. Cancel; verify the edits and live chat remain usable.
6. **Quit Save/Discard.** Repeat with disposable edits. Exercise Save, then reopen
   and check disk contents. Repeat with Discard, reopen and check those edits are
   absent. Confirm final Quit exits the app. Process-descendant cleanup is checked
   automatically; do not infer it merely from the window disappearing.
7. **Failed Save during Quit.** With agent assistance, make a disposable edited
   file unavailable before choosing Save in Quit. Expect a readable error, no
   completed Quit, and the edited text still available. Restore the file before
   continuing. Cancel must remain reachable.

8. **Files and Source Control.** Using the keyboard and VoiceOver, open `notes.txt`
   from Files, edit it, navigate to Source Control and open its diff. Verify the
   old/new sides have understandable labels and F7 reaches the accessible diff
   after changes appear. Return to Files; edits must remain. Verify tree selection,
   Collapse All and Reveal Active File are reachable without trapping focus.

Existing Finder drop, native clipboard and native Trash manual follow-up remains
separate and unclaimed. Legacy import, broad compatibility, exhaustive multi-client
and revocation checks, and sustained-load qualification are outside this amendment.
