# New chat defaults — #153

App defaults and project overrides are available under **New chat defaults** beside
next-message model/effort/permission controls. Each scope can clear model/effort and
permission inheritance independently. They use the authenticated host contract and
bounded SQLite current-state storage; they do not change existing work or draft text.

New model choices resolve project > app > current chat selection > remembered Codex
model/effort > provider catalog default. Existing explicit draft selections win over
later default changes. Effort memory is shared per Codex model. New project and
No project drafts capture configured permissions, with factory Full access. Per-chat
permission edits never update defaults. Send retains its existing settings capture,
validation and fail-closed effective-policy mismatch behavior.

## Verification

- TDD application tracer: missing defaults surface failed before UI implementation.
- `bun run --cwd apps/desktop smoke -- tests/models.spec.ts tests/permissions.spec.ts`:
  2 passed. Isolated Electron/user-data/Git/provider fixtures cover app/project
  precedence, configured-default persistence, cross-chat effort memory, existing
  drafts and text across forced restart, factory permission reset, rejected unavailable
  models and managed-policy defaults, and next-message edits during work without replay.
- `bun run --cwd apps/desktop test -- host/chat-commands.test.ts host/models.test.ts host/permissions.test.ts host/chat.test.ts host/durable-state.test.ts`:
  37 passed; 1 opt-in installed-provider test skipped.
- Build, typecheck, lint and `git diff --check` passed. Build retains its existing large-chunk warning.
- Inspected the rendered expanded defaults surface in `test-results/models.png`.

## Qualification limits

This is fixture qualification, not installed-provider permission certification.
A saved/provider policy mismatch still fails closed and remains a release qualification
limit under #144. Packaged application, installed Codex, manual VoiceOver/native,
narrow/short-window and 200% zoom qualification remain with the parent integration.
No PR was created and no issue state was changed by this slice.

## Saved-chat activation follow-up (#144/#153 P2)

Foreground model controls explicitly activate their actual chat identity through the
existing authenticated model contract. Host activation generations prevent an older
activation from overwriting the latest foreground selection. Catalog reads and Send
validation do not activate chats; background explicit edits retain effort memory but
cannot replace the foreground current-model default. Existing draft choices and
project/app precedence remain unchanged.

The host activation regression failed before the fix (A inherited instead of B).
The Electron regression also failed with renderer activation disabled (A/high instead
of B/medium). With activation restored, `host/models.test.ts` and
`host/permissions.test.ts` pass (4 tests), and `tests/models.spec.ts` passes (1 test),
including saved B activation after editing A, background Send, fresh defaults,
configured precedence, per-model memory and restart/draft preservation. Build,
typecheck, lint and diff whitespace checks passed; lint retains existing warnings.
This follow-up uses the controllable provider fixture; installed-provider and manual
native/accessibility qualification were not rerun.

### Combined activation merge verification

Merged activation commit `43b09704422d79ecac9bd2b21d4979e11a003c3d`
onto integration baseline `747ee26`, retaining saved-policy conflict resolution
and stale Stop recovery. No further production defect was found. Strengthened the
host delayed-activation regression to distinguish effort as well as model and
assert that activation/catalog access sends only `model/list`.

Checks on the combined branch: host models, permissions, reconnect and SQLite
controls: 10 passed; strengthened models rerun: 2 passed. Electron models and
permissions: 2 passed. Fresh build, typecheck, lint and package passed. Packaged
models plus four emergency Stop variants: 5 passed, including worker loss and
superseded targets. Initial checks failed because this isolated checkout lacked
dependencies and a packaged executable; frozen dependency installation and a fresh
package resolved these setup failures. No application workaround was required.

The final integration merge check found `integration/agents-sidebar-144` still at
`747ee26` (already included). Concurrent qualification work not yet committed to
that ref is outside this snapshot. Installed-provider qualification, native/VoiceOver
and broader visual gates were not rerun here; parent qualification retains those
limits. No integration ref, tracker or PR was changed.
