# Authenticated Files creation

Delivery for [Create files and folders through the host](https://github.com/ejjsharpe/escode/issues/79).

Existing New File/New Folder controls now dispatch validated Effect RPC requests over the authenticated local connection. The superseded main-process `create-entry` IPC handler rejects requests; the desktop bridge directly selects RPC, without fallback. Existing native `Project.create`, basename validation, collision feedback, retained inline input, keyboard/focus behavior, successful-file opening and common directory listings/watches are reused. No upstream source was copied and no dependency was added.

The host retains approval, protected-app-state and recovery-draft checks, then revalidates the captured project session and native checkout identity immediately before the filesystem effect. The native helper also validates the exact parent identity at execution. Existing tests cover invalid names, collisions, checkout replacement and parent directory/symlink swaps.

Creation uses durable receipts in the existing host/client-owned fresh foundation store. The desktop persists its command identity before dispatch. Repeating the same command returns its outcome; changed payloads conflict. Admission is serialized by the host's synchronous effect/receipt handoff. A completed receipt recovers a lost socket result without another creation. A recorded dispatch interrupted by restart returns uncertainty, and expired admission epochs cannot become fresh effects. A native error without a positively identical pre-existing destination is uncertain, retaining the command and input. No automatic redispatch occurs. Receipts do not make the native effect atomic with persistence; uncertain outcomes require inspection of the exact path. Broader operator resolution UI remains outside this slice.

Initial limits are 1,000 retained creation receipts and the existing 1 MiB foundation-store ceiling. Exhaustion rejects admission before effects; receipts are not pruned to admit work. This is a bounded prerelease limit, not a capacity claim. Existing store write/identity/version failure behavior is retained. Old stores, worktrees, provider history and project contents are not imported or deleted.

Verification on the local installation uses Bun 1.4.4 and Electron 45.1.0 with the existing native helper:

- Typecheck, lint, build and package passed. Final full unit suite passed (206 passed, 4 opt-in tests skipped), without rebuilding the native helper concurrently.
- Packaged restricted-PATH focused inline creation suite: 7/7 passed, including the lost native result check.
- Development focused inline creation suite: 7/7 passed. Covers file/folder creation, basename/collision feedback, retained rejected input, keyboard/focus, successful editor opening, collapsed/nested targets, missing parent and failed listing, plus injected lost native result with retained input and unchanged bytes on Retry.
- Authenticated transport tests exercise create payload decoding and reject invalid kinds without invoking the adapter.
- Foundation tests exercise lost completed results, restart replay, conflicting IDs, interrupted dispatch uncertainty, expired epochs and receipt exhaustion before effects.
- Existing native create tests retain actual-disk invalid-name/collision and effect-time checkout/parent replacement coverage.

The exploratory full inline suite had two failures outside creation (uncertain rename recovery and restored hidden selection); focused creation checks pass. An initial full unit run had a descendant-cleanup timing failure; a subsequent run overlapping helper compilation hit `ENOEXEC`. These do not establish passing broader acceptance.

No new manual VoiceOver claim is made. Controls and focus behavior are unchanged; manual accessibility qualification, broader installations, exhaustive multi-client/revocation and full capacity benchmarking remain deferred.
