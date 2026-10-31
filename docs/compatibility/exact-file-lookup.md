# Exact file lookup

Implements the local exact-path slice of issue 109 under the accepted checkout/search and file-tab contracts. Cmd+P and Find file invoke a blank modal in Files, Source Control and checkout Chats. Scope is announced as the exact checkout path. Enter or Open file validates and activates; arrow keys and typing do not navigate. Escape/Cancel restores originating focus. Composer text stays client owned and Enter cannot Send from the popup.

The authenticated host endpoint canonicalizes relative/absolute paths only within the requested approved checkout, rejects traversal and revalidates retained native checkout identity. It uses existing no-follow file reading and app-state protections, including binary, UTF-8 and 2 MiB limits. Deliberately entered excluded paths are allowed. The shared opener keeps/reuses the file tab and buffer without replacing its disk baseline; successful activation selects Files and focuses the editor. Failed validation leaves the query and prior editor intact. Invocation generations guard both validation and shared-opener completion before tab activation.

Root/query strings are limited to 4096 characters in the RPC schema and workflow before path processing. The popup allows one in-flight activation; normal authenticated transport frame and 16-request admission limits remain. No enumeration, index, history, watcher or retained result set is allocated. Closing or editing invalidates pending presentation work; an already dispatched bounded host read may finish. Recursive discovery/scoring belongs to issue 110 and Agents scope to issue 111.

The pinned accepted file-tab dependency is b7a005b5891f59b277c861020dadbb53e68d97e1. Merge resolution combines fixed checkout identity, independent recovery and project defaults with shared preview/Keep Open opening and safe close. It preserves both workspace validation test sets and the parent specification's testing amendments.

Verification uses the owning navigation/composer journey, a distinct delayed socket-response case in that same fixture, focused workflow authority checks, and authenticated wire-payload validation. Existing file-tab, close, recovery and project tests provide their own behavior matrices. Manual VoiceOver/sign-off and live provider turns are excluded by the accepted scope.

## Qualification on 2026-10-31

Merged current checkout integration e5650ced87ff43c8d7eb69719462139f1246fd61 (including the availability teardown repair) without conflicts after implementing lookup. Both this integration tip and the pinned file-tab dependency are ancestors of the delivered branch.

- Typecheck and lint passed. Full host/unit run: 273 passed, 4 existing skips.
- Development: navigation's two lookup/composer/race cases passed on the final build; existing file-tab (6), safe close (6), and Agents/file recovery (2) cases passed during integration.
- Packaged: navigation's two cases passed on the final build. Existing file-tab (6) and availability (5) cases passed with the merged host, including availability.spec.ts:75.
- Build and macOS directory packaging passed. The existing large renderer-chunk warning remains.
- Inspected the rendered popup screenshot for layout, visible scope, input focus, retained editor and action controls.

Initial iteration checks exposed missing awaited binary validation and autofocus-origin capture; both were repaired. The first expanded packaged run also rejected an ambiguous Rename fixture locator (textbox and toolbar button shared the label); the role-specific locator and final development/packaged reruns pass. No full desktop sweep, live provider turn, manual VoiceOver session, recursive-discovery performance qualification or multi-checkout Agents lookup is claimed. Already-dispatched bounded reads may complete after dismissal; their responses cannot commit navigation.
