# Host-backed shared-buffer comparisons

Issue: [Open host-backed diffs using the shared Files buffer](https://github.com/ejjsharpe/escode/issues/85).

Staged, unstaged and untracked comparison queries now use the authenticated local
Effect RPC connection. The host validates approved checkout/session identity and
protected app-state scope, and rechecks context after reading. The former project
IPC diff route is rejected. Comparison responses are transient observations; no
comparison cache is persisted. Files buffers and recovery drafts remain the edit
authority for this client.

Staged comparisons retain HEAD as the original and use the shared working-file
model when available. Unavailable working files retain a read-only comparison
against the index. Unstaged originals use the index; untracked originals are empty.
Saving uses the existing authenticated Files save path without staging. Binary,
encoding and 2 MiB editor limits and loaded-baseline conflicts remain unchanged.
Selection generations are checked after both query and working-file read before
applying results, including before creating/updating a buffer.

## Verification (2026-10-30)

Local target: macOS 26.3.1 arm64, Electron 45.1.0, shell Node 26.13.0,
Git 2.50.1 (Apple Git-155), installed Codex 0.163.0; no provider turn needed.
Bun 1.4.4 installed dependencies with the frozen lockfile; the default shell Bun
1.3.14 cannot parse this repository's lockfile.

- Typecheck, lint, full unit suite, build and macOS directory package passed.
- Focused project/directory tests passed (33 tests before the added RPC assertions).
  The full suite includes the added full-size two-sided comparison response and
  invalid-area rejection checks.
- `bun run --cwd apps/desktop smoke -- tests/editable-diff.spec.ts` checks staged
  plus unstaged content, dirty shared buffers, explicit save, unchanged index/HEAD,
  save conflicts, untracked comparisons, missing working-file read-only state,
  rapid selections and dirty text retained after external deletion.
- The same test with `ESCODE_PACKAGED=1` exercises packaged authenticated transport
  with restricted PATH.

Keyboard editing, Cmd+S, Files/Source Control navigation and read-only textbox
assertions are automated. No layout, labels or focus behavior was intentionally
changed. VoiceOver was not repeated; earlier manual evidence is not certification
of this transport change. Rapid UI selections do not exhaustively inject every
possible delayed-response ordering. Broad capacity and multi-client qualification
remain deferred under the approved prerelease amendment.
