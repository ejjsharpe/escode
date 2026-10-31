# Sidebar and recent-chat merge (#144 / #147)

Base: `769633ce431ee6a4582e4c8aa8ff7af595c0ffa0` (navigation and persisted sidebar width).
Merged: `397087a50200865b0893e83a14a07057483ee6f8` (shared recent-chat rows).

The only textual conflict was the end of `src/style.css`; both the sidebar sizing/navigation rules and the recent-row rules are retained. Shared Agents rows retain the sidebar resize control and client workspace recovery. Navigation test selectors now match full accessible chat names. Agents error assertions select the first of the action/context alerts, retaining error-content and viewport checks.

## Combined checks

- Typecheck and lint pass (four existing lint warnings); renderer/host build passes with the existing chunk-size warning.
- Focused host tests (`agents`, `chat`, `chat-commands`): 21 passed, one opt-in installed-provider test skipped.
- Electron `chat-summaries.spec.ts`: three passed, including timestamp fallbacks/ties, bounded summaries/detail release, five projects/thirty chats/three running turns and stable ordering through assistant output/Stop.
- Electron `navigation.spec.ts`: three passed, including exact-checkout chat scope, preserved file buffers/composer text, sidebar keyboard/drag sizing, Quit/restart recovery and independent clients.
- Initial combined Electron run: eight passed, two failed on ambiguous alert locators. Focused rerun results are recorded below.

## Acceptance boundaries

This merges the navigation/sidebar and recent-list slices, not complete #144 acceptance. Titles/archive, next-message settings and remaining composer work stay with their respective slices. Recency uses host observation time for provider user-message events; historical chats lacking metadata use timestamp fallbacks without transcript backfill. No installed-provider, packaged-app, manual VoiceOver or exhaustive visual qualification was repeated in this merge. See `agents-recents.md` for source-slice evidence and limits. No open `wayfinder:map` issue existed at merge time. The root checkout, integration branch ref, issues and PR were not modified.

Focused reruns: picker/restart passed; activity scenario then exposed one remaining created-order expectation on return to local Chats. Updated that expectation and its selected-row position for the promoted chat. Final activity rerun passed, including long requests, short-window errors and unchanged local selection. All ten selected Electron scenarios therefore passed across the initial run and focused correction reruns; no single fresh all-ten run is claimed. Lint passed again after test corrections.
