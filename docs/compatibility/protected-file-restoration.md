# Protected file restoration (#133)

Implemented only the restoration slice of standalone #117, on
`implement/133-protected-restoration`, in
`/Users/elliotsharpe/.t3/worktrees/escode/t3-cb26c89d`.
Base: integration `9adf03f8ef15e75c319caef2a0cbfb832d0cbf4d`, retaining
`0a9c981`. Historical branching (#134) is separate. No issue closure, PR or
merge back into integration.

The existing authenticated rewind route accepts an explicit restoration choice.
Preparation captures the selected snapshot, current eligible paths, exact directory
identity and provider boundary/history. Confirmation rechecks that choice and
requires an exact isolated linked worktree, matching Git root, branch/HEAD and
source repository. App-managed reservations additionally retain their exact branch. Original checkouts, No project, shared worktrees, unavailable
snapshots/bases, linked parents, nested repositories and path/type collisions are
refused rather than redirected or reconstructed. This conservative collision
refusal includes file/directory transitions requiring directory removal.

Confirmation explicitly retains available unsaved text and loaded conflict
baselines. It replaces saved edits and can remove newer eligible untracked files.
It explains exclusions, current rather than historical staging, later-boundary
abandonment, partial effects and external-writer races. Cancel returns focus to
the originating choice; ready, unavailable and result regions receive focus.
Conversation-only rewind remains independently available. Historical branching is
named as an alternative when available; this slice does not implement its route.

Restoration writes captured bytes/modes (including symlinks), removes eligible
newer files, and leaves Git's index untouched. It does not invoke checkout/reset,
create synthetic commits, start turns or clear client recovery/acknowledgements.
Every file effect rechecks directory/isolation and parent paths. Replacement uses
unique sibling files and rename, avoiding writes through existing file symlinks
or hardlinks. These checks cannot make filesystem effects atomic against external
writers; failed/partial restoration requires inspection, never automatic replay.

SQLite records uncertain intent before native historical provider creation,
records returned provider identity before chat binding, and records final result
after file effects. The retained captured plan includes snapshot contents and
paths. Provider, chat binding and file effects remain separate consistency
boundaries. A lost response, failure or process crash can retain a provider thread
and partially changed files under an uncertain receipt. Duplicates return that
receipt without repeating effects. Existing conversation-only receipt identities
remain compatible. SQLite WAL NORMAL power-loss limits remain unchanged.

## Verification — 2026-10-31

Frozen dependency install; typecheck and lint pass. Authenticated host/client
fixtures use real SQLite/Git/files and a fake native provider. They check captured
tracked and untracked text, newer-untracked removal, original saved file and exact
index-byte preservation, independent recovery text/baselines, No project and
explicit isolated-worktree reuse and original refusal, shared refusal, changed choice paths, missing base/expired coverage, duplicate
commands, zero unexpected provider methods/turns, provider-success/file-collision
uncertainty and SQLite reopen without replay. The existing conversation rewind
fixture retains unsupported/lost provider history and intent/outcome failure checks.
A bundled child host is SIGKILLed during authenticated provider fork; reopening
SQLite retains uncertainty, with exactly one recorded fork and unchanged files.
This checks process failure, not physical power loss or every file-write crash point.

Build and unsigned arm64 package pass. Packaged history checks pass 4/4, including
restoration warnings, Cancel focus, explicit preservation confirmation, exact
restored disk bytes, result focus and retained unsent composer. No project shows
unavailable restoration with a conversation-only alternative and no confirm action.
The restoration screenshot was visually inspected in the incumbent desktop UI.

No paid live provider, manual VoiceOver, broad full suite, exhaustive multi-client,
capacity or crash-at-every-file-effect qualification was performed. Packaged dirty
editor restoration is not separately exercised; authenticated recovery text and
loaded baselines are checked. Native provider context fidelity remains fixture
qualified rather than certified against a live paid conversation. These are
verification limits, not a claim of complete parent-spec acceptance.

One expanded host-fixture run exceeded its original 15-second test timeout while
packaged/build work ran concurrently. The combined real-Git/SQLite/provider/SIGKILL
fixture now has a 60-second bound; no assertions were removed or relaxed.
