# Readable conversations (#154)

Implemented on `implement/conversation-154` for the accepted #144 conversation slice. Based on `abc1798`; merged concurrent defaults integration `ea4a9ab` before final verification.

The existing shared ChatView retains the host/store Send, reconnect, reply, history and exact-target Stop operations. Empty drafts center composition; bound conversations use a bounded independently scrolling transcript, with execution context above the composer and next-message controls inside it. Current-turn settings JSON and historical operations are secondary Chat actions. Recovery appears for errors/disconnection/uncertainty; Resolve previous Send requires uncertainty. Active Stop and explicit emergency cancellation remain beside composition, including waiting requests. Existing shared-file, reservation, partial-output, checkpoint and acceptance notices remain intact.

`react-markdown` 10.1.0 supplies Markdown parsing (no existing parser dependency was installed). Raw HTML is skipped and the renderer's default safe URL transform is retained. Code copy uses a bounded native clipboard action because Electron denies browser clipboard writes; the main process validates the exact sender/frame/document and text bound. Failure remains visible. Tool details use native disclosure controls; errors and requests remain outside collapsed activity.

## Checks

- Red/green renderer check: absent renderer failed, then Markdown heading/emphasis, code-copy affordance, HTML and unsafe-link checks passed.
- Typecheck, build and lint passed after integration merge; lint retains existing warnings.
- Focused host checks: conversation, durable Send, SQLite controls, control crash and permissions: **15 passed** after integration merge. Earlier chat checks: **9 passed, 1 live-provider skip**.
- Built Electron controllable-provider conversation test passed after integration merge: real native code clipboard contains only `const answer = 42;`, raw script/unsafe link excluded, approval visible without expansion, keyboard Stop during waiting work. Screenshots at 1000×700, 800×500 and 600×450 CSS viewport (layout equivalent of 1200×900 at 200%). The viewport-equivalent check does not claim native zoom/VoiceOver qualification.
- The unavailable-context recovery test passed before the defaults merge. After merge, recovery reaches its final no-replay assertion with two starts rather than the expected three: saved provider resume policy mismatches fail closed. This remains the known permission qualification limit; its expectation was not weakened.
- The older concurrency UI test fails at its initial exact ordinal `Chat 1` locator, before this slice's behavior, because rows now carry full contextual accessible names. Its healthy reload action was updated to Chat actions; full fixture modernization is outstanding.

## Limits

No packaged/live-provider/VoiceOver run, native 200% zoom acceptance, broad suite or exhaustive history/checkpoint scenarios claimed. The focused UI test covers approval and keyboard Stop; existing host control tests cover durable and emergency paths. Full combined #144 acceptance remains with the parent. No PR, issue changes, integration-ref updates or root-checkout edits were performed.

## Independent merger qualification

The merger started at integration `ea4a9abb32040a4d1b7510fcfd342bdf55b903bb` and fast-forwarded conversation commit `d48cbbca7a95b27101c69f62235b5a4d980348bc`. The integration ref was rechecked and merged before reporting (already contained); it was not updated.

A new empty-composer geometry assertion failed with its center 212.75 pixels below the conversation center. Balancing the flexible space below composition fixes this; the assertion passes. Additional production-UI assertions cover independent long-transcript scrolling without composer movement, expandable tool output, failures outside expansion, secondary Reload/effective-settings access and absence of a post-composer footer. Packaged screenshots were inspected at the recorded desktop/constrained viewport sizes.

The obsolete concurrency fixture was repaired after observed failures: stable manually named seeded chats replace ordinal exact-name assumptions; full contextual accessible names are retained; a committed Git baseline enables checkpoints; capability/config replies and returned requested permissions match the integrated settings contract. The session-preservation assertion now counts start/resume for the exact originating thread rather than unrelated capability-probe processes. Exact-origin replies, duplicate rejection, pending Send across navigation/editor closure, Stop, background focus, connection loss and surviving work assertions remain. Emergency fixtures likewise return the requested policy rather than falsely reporting read-only after Full access was selected.

Final focused packaged Electron run: **7 passed** (conversation layout/Markdown/native clipboard/tool/error checks, concurrency, unavailable-context restart/no-replay recovery, and four emergency Stop scenarios including storage-worker loss and stale-target rejection). This supersedes the earlier recovery/concurrency qualification gaps above. Separate built Electron model/permission persistence checks and all six title scenarios passed. Focused host suite: **25 passed, 1 live-provider skip** across conversation, durable Send, SQLite controls/crash, chat, models and permissions. Build, typecheck, lint, packaging and diff whitespace checks passed.

No installed-provider, native zoom or manual VoiceOver qualification, exhaustive history/checkpoint actions, complete #144 acceptance, or broad regression suite is claimed. Archive/default/sidebar/recency implementation was preserved; focused model/permission/title and navigation checks do not constitute complete independent qualification of those parallel slices. Parent retains PR/tracker ownership. No root-checkout edits, PR creation, tracker writes or agents were used.
