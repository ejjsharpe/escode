# Fresh-state project drafts

Issue [Create project chats on existing checkouts](https://github.com/ejjsharpe/escode/issues/75), checked 2026-10-30.

Draft creation/context/execution selection use authenticated Effect RPC. Native project selection and Git discovery retain the existing approval and repository identity checks. Context edits check the expected chat/context state inside ChatService's first-Send serialization boundary. Bound chats cannot change context. Send retains the durable receipt path; no IPC fallback exists for migrated actions. Draft responses validate metadata and exclude composer text.

Composer text belongs to the desktop client in origin-scoped local storage, keyed by stable chat ID across project changes. Accepted Send clears matching stored text; newer text survives. Pending Send identities retain the existing host/client receipt protection. Local storage crash recovery is best effort: the crash fixture explicitly flushes Chromium storage before killing Electron. No legacy text is imported. Every explicit New chat creates a separate draft because the host cannot infer whether a client has text.

Before first Send, Codex config/read supplies model, reasoning, approval and sandbox settings for the chosen directory without thread/start. Unavailable provider/config access reports an error and retains the draft; Retry refreshes settings. Provider-returned effective thread settings replace the preview on binding.

## Scenario mapping and checks

- Agents project drafts, context changes, linked checkout selection, settings preview, restart, first-Send binding and closed-project activity: `tests/project-drafts.spec.ts`, adapted to client-owned composers and fresh host associations.
- Native selection, repository identity/deduplication and navigation: `tests/navigation.spec.ts`.
- Missing directories, independent file recovery, provider/authentication failures and retry without resend: `tests/availability.spec.ts`.
- Stale context revisions and competing first Send: `host/project-drafts.test.ts`; supersedes old IPC interception race fixtures.
- Existing exact-directory binding, preserved prompt/identity on failure and no automatic replay: existing project-draft, availability and Send unit tests.

Validation: typecheck and lint passed; full unit suite 190 passed, 4 skipped (opt-in live-provider checks). Focused Electron project-draft/availability/navigation checks passed; build/package passed; `ESCODE_PACKAGED=1` project-draft check passed using the packaged app and restricted PATH. Provider behavior in UI checks uses a protocol fixture. Reuse the actual installation inventory in foundation baseline evidence; no new provider-version compatibility claim.

Keyboard/focus controls and view structure are unchanged. No new manual VoiceOver validation, exhaustive multi-client arbitration, live-provider turn, or broad capacity qualification is claimed. Old stores, provider history, project files and existing worktrees are untouched.
