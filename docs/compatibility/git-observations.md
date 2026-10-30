# Git observations through the host

Issue: [Observe Git status and worktrees through the host](https://github.com/ejjsharpe/escode/issues/84).

Status and worktree options now use validated contracts on the shared authenticated
WebSocket. Electron composition retains `Project.status`, its porcelain parser,
repository/linked-checkout identities and checked checkout selection. The replaced
`status` and `worktree-options` project IPC handlers reject calls; there is no fallback.
Git mutation features are unchanged.

The host coalesces overlapping requests per exact checkout and observation kind into
one in-flight scan and one pending refresh. Each completed scan resolves its callers
even if another refresh is pending, preventing continuous invalidation starvation.
Only in-flight results are cached; subsequent requests rebuild from Git. Status and
displayed worktree options refresh every two seconds. Renderer request generations
reject results superseded by newer requests or checkout-view disposal. Polling skips overlapping renderer requests so slow scans can still update visible state. Polling observes
common repository metadata as well as working files without recursive Git watchers.
Worktree selection and first Send still revalidate the selected context and base.

## Verification (2026-10-30)

- TypeScript and lint pass.
- `host/git-observation.test.ts`: delayed scans, coalescing, repeated invalidation
  progress, independent checkout keys, failure release and cache rebuild (2 tests).
- Full unit suite: 23 files passed, 1 skipped; 212 tests passed, 4 skipped.
  Existing worktree tests use temporary linked repositories; existing recovery tests
  retain no-Git chat behavior without moving provider control onto Git queries.
- `tests/directory-host.spec.ts`: development and packaged Electron checks pass.
  Authenticated status returns parsed untracked changes; worktree queries converge
  after adding a linked worktree through common metadata, and subsequent status
  requests observe external checkout writes. Existing Files authorization checks pass.
- Build and macOS directory packaging pass on the actual installation. Packaged
  test uses restricted PATH through the existing launch fixture.

The combined native-import/diff main changes were retained during rebase; typechecking, lint, unit and packaged checks were repeated on the combined tree.

Keyboard controls, focus targets and markup are unchanged. No new manual VoiceOver
check was performed. Live provider turns, exhaustive multi-client/revocation and full
capacity qualification remain deferred under the approved delivery amendment.
