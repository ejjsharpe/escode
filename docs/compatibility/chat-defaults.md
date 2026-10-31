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
