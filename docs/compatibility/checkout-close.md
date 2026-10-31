# Checkout workspace close and reopen

Implements [Close and reopen a checkout workspace deliberately](https://github.com/ejjsharpe/escode/issues/104) within the [checkout/search specification](https://github.com/ejjsharpe/escode/issues/93).

Checkout closure captures the checkout's file set and uses the existing dirty gate. Discards remain proposals until every choice succeeds. Open-tab membership, selected neighbour and discarded recovery drafts publish in one workspace write before models are released. Cancel, failed Save or failed publication retains available edits; completed Saves remain disk facts. Inactive closure preserves focus; active closure selects the following checkout, then the preceding checkout at the end, or Agents if none survives.

Remembered view/file metadata, saved Project identity, checkout authority and chat/provider sessions survive closure. Explicit Open checkout validates and restores the original checkout through the existing host path, without creating resources. Quit, macOS window close and managed removal keep their separate gates. There is no new workspace or buffer registry.

## Verification

- Extended `tests/retained-project.spec.ts`: original checkout, linked managed checkout and another project have distinct edits to `a.txt`. Cancel, failed Save and an injected atomic workspace replacement failure retain the target. Successful background Discard preserves both other buffers and their disk bytes. Prompts name only the captured target. Existing request/reply, Stop and managed-removal checks remain in the same journey. Explicit Open checkout restores a closed managed editor and its remembered file.
- Extended `tests/lifecycle.spec.ts`: keyboard Delete closes the active checkout and selects a surviving neighbour; explicit reopen restores Source Control and its selected comparison. Existing crash recovery, last-window hide/reopen, closed-editor live work and Quit cases remain regression coverage.
- `tests/navigation.spec.ts` and `tests/lifecycle-races.spec.ts` retain fixed identities, independent buffers, close input locks and delayed provider-open coverage.
- Typecheck, lint, unit tests, build, macOS package and development Electron journeys passed. Packaged lifecycle and background-close checks use the restricted PATH harness. The rendered reopened checkout was inspected; the Impeccable detector reported no findings.

The initial new neighbour assertion failed against the base (Agents was selected). During extension, stale alert/path selectors and the added dirty checkout's earlier removal guard required fixture corrections. These were test failures, not accepted exceptions.

## Limits

Recovery remains best effort under the existing storage/operation-journal guarantees. Successful external disk writes cannot be rolled back; no stronger filesystem/crash transaction is claimed. Detailed file-tab restoration and restart membership belong to their separate tickets. Manual VoiceOver sign-off and real-provider turns were not run for this change; automated controls and fixture provider lifecycle checks remain covered.
