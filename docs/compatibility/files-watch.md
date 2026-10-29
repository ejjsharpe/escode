# Loaded-directory external changes (#47)

Scope: [Reconcile external filesystem changes](https://github.com/ejjsharpe/escode/issues/47)
against [the Files specification](https://github.com/ejjsharpe/escode/issues/38).
This is implementation evidence on baseline `c97a38bff051b8c5626d730cb1f5f0a4bdb1cb54`,
not parent #48 acceptance or main integration. macOS 26.3.1 (25D2128), arm64;
Node 26.13.0, Electron 45.1.0. Changes remain uncommitted for independent review.

Project owns shared, non-recursive `fs.watch` subscriptions for loaded directories.
Clients share a watcher for the same directory identity. Each client coalesces events
in a fixed 100 ms window (continuous activity does not postpone delivery indefinitely).
Registration checks approved Project identity and opens directory ancestors with
`O_NOFOLLOW_ANY`; checks again after registration and closes on mismatch. Renderer
selection grants no approval. Metadata and protected app state remain excluded.
Notifications carry no file bytes and initiate ordinary validated directory listings.
A changed/replaced parent is rebound through a fresh validated subscription; replaced
checkout roots fail visibly without adopting replacement content.

The renderer preserves existing rows during background rescans, filters each listing
through the existing batched Git ignore query, and keeps ordinary Git-failure degradation.
Only already loaded directories are rescanned; expansion revalidates cached contents,
including when notifications were missed while collapsed. Window focus, return to the
checkout's Files view and explicit Refresh retry subscriptions. A failed subscription
reports its directory and error with focus/Refresh recovery instructions. Listing errors
replace stale successful listings with contextual unavailable states. Failure does not
hide every file. No workspace polling, recursive watcher or eager recursive scan was added.

Notifications do not read, discard, retarget, save, or acknowledge buffers or recovery
drafts. Missing files use the existing save error/conflict path; saving never implicitly
recreates the old path. Rescans preserve valid selection, expansion, scroll and the active
document and do not focus controls. During inline editing, automatic rescans wait until
commit/cancel, keeping the input mounted. Explicit Refresh retains the existing inline
error/fallback behavior. Operation delivery, durable completed facts, native import
references, collision checks, copied unsaved text and manual active-parent collapse
retain their existing ownership paths.

## Automated evidence

Commands run from the isolated ticket worktree; Electron uses temporary repositories and
separate user-data profiles, without macOS global input or driving the parent's sessions.

- `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`, `bun run package`: pass.
  Final direct host run (`bun run --cwd apps/desktop test`): 122 passed, two skipped (124 total).
- `bun run --cwd apps/desktop test -- host/files-watch.test.ts`: three real-filesystem tests
  pass. Shared clients, burst coalescing, release/close, sync EMFILE and async ENOSPC
  failures, symlink parents (including a live parent swap), `.git`, and replaced roots; ordinary listing remains usable
  after watcher failure.
- `bun run --cwd apps/desktop smoke -- tests/files-watch.spec.ts`: real app Trash of a
  fixture, restore from the returned native Trash path using filesystem rename, visible
  restoration without focus loss; loaded/collapsed create/rename/delete; dirty deleted
  file save refusal and restart recovery; deliberately suppressed host events with focus
  and manual recovery; EMFILE fallback/retry; project switching; replaced-root refusal;
  retained inline input and focus during external deletion, and delayed originating notifications
  delivered after a project switch.

The native Trash + filesystem restore test covers the reported stale Put Back listing
without automating Finder UI. It does not certify Finder's Put Back UI itself.

Generated-tree fixture command is the same `files-watch.spec.ts` invocation: 200 immediate
folders, each containing 100 text files (20,000 files). Instrumented live watcher paths
assert one watcher at root, then exactly root + the expanded folder; 200 then 300 tree rows.
Latest regression run: generation 1,616 ms; root visible 739 ms; expansion 66 ms; two arrow keys
11 ms; external file visible 313 ms. An earlier run alongside other checks measured
2,133 / 389 / 9 / 315 ms respectively. These observations do not justify row virtualization
for this fixture, and are not a performance guarantee for arbitrarily wide directories.

The existing generated native import/transfer tests also exercised 500 MiB in 8,000 binary
files with notifications enabled: import 5,453 ms, concurrent protocol Stop 2 ms; internal
copy 4,763 ms, Stop 2 ms, with Agents navigation while the helper was still running.
These use a protocol fixture, not a live Codex turn.

The broad regression invocation was:

```sh
bun run --cwd apps/desktop smoke -- tests/files-watch.spec.ts tests/navigation.spec.ts tests/lifecycle.spec.ts tests/lifecycle-races.spec.ts tests/accessibility.spec.ts tests/files-tree.spec.ts tests/files-reveal.spec.ts tests/files-inline.spec.ts tests/files-transfer.spec.ts tests/files-drag.spec.ts tests/files-import.spec.ts tests/files-trash-handoffs.spec.ts tests/concurrency.spec.ts tests/file-operations.spec.ts tests/agents-files-recovery.spec.ts tests/availability.spec.ts --output=test-results-47-regression
```

It completed with 73 passed / five failed. All five passed in the isolated follow-up:

```sh
bun run --cwd apps/desktop smoke -- tests/availability.spec.ts tests/file-operations.spec.ts tests/files-drag.spec.ts tests/files-import.spec.ts tests/lifecycle.spec.ts --grep 'saved secondary|batch Trash Cancel|confirmation revalidates destination|Unicode alias|crash recovery preserves baseline' --output=test-results/47-retry
```

The earlier focused inline/reveal/watch regression also passed all 18 tests. Broad-run failure
artifacts were moved under the ignored `apps/desktop/test-results/47-regression` directory.

Packaged verification passed all four tests:

```sh
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/packaged.spec.ts tests/files-watch.spec.ts --output=test-results/47-packaged
```

Packaged generated fixture: generation 2,377 ms; root visible 791 ms; expand 67 ms; two arrow
keys 12 ms; external notification to visible 227 ms. The baseline packaged check verifies CSS,
Monaco, tools under restricted PATH and the explicit preload capability allowlist, now including
`watchFiles`. The replaced-root error screenshot was inspected: its error remains readable in
the sidebar and available unsaved text remains in Monaco.

Changed-file inventory: host `project.ts`, `main.ts`, `preload.ts`; renderer `files.tsx` and
`main.tsx`; new `host/files-watch.test.ts` and `tests/files-watch.spec.ts`; adjusted tree cache,
lifecycle status selector and packaged capability assertions; README, GLOSSARY and this evidence.
No dependencies, native-helper changes, polling, or virtualization were added.

## Failures and limits

The broad Electron command initially completed with 73 passed / five failed. The failures
were: availability timeout during the requested 100-second test-dispatch hold; an Open project
startup timeout during a concurrent rebuild; missing drag-confirmation callback; native Unicode
paste receiving stale clipboard references; and an ambiguous lifecycle status locator. The last
locator now targets the document operation status, preserving its ENOENT assertion. No product
changes were made in response to shared clipboard interference. Isolated reruns are recorded
below separately rather than treating the initial command as green.

An initial large-fixture cleanup raced Electron exit (`ENOTEMPTY` under temporary user data);
cleanup now retries. The added live-parent host test initially exposed a double-restored test spy;
its spy lifecycle was consolidated and all three focused host tests pass. Initial background-cache experiments broke explicit Refresh and hidden
entry failure cases; explicit Refresh invalidation was restored. The old cache test expected
stale descendants after removing a folder; it now deliberately suppresses notification delivery
and checks revalidation/error recovery rather than requiring stale success.

Notifications are best effort. A failed watch remains explicitly unavailable until focus or
Refresh retries; missed events require those recovery routes or later expansion. All cached
loaded directories may be rescanned per coalesced burst. Very broad expanded trees can therefore
cost more than this fixture. Existing practical save-race and best-effort draft limits remain.
No transactional filesystem, signing/notarization, live-agent, full-spec or manual-native
acceptance claim is made. Actual VoiceOver is **USER-DEFERRED**, neither passed nor blocking.
Earlier manual VoiceOver evidence is historical; parent native Finder checks and #48 acceptance
remain separate.

## Review correction: host notification test readiness

The parent reports fresh FULL Ponytail review disposition **Ship**, with a SHOULD FIX for
the first host watch test's immediate post-subscription burst; no product defects were reported.
The reviewer's initial full host run was 121 passed / one failed / two skipped: no first callback
within the default `vi.waitFor` timeout. Its isolated rerun passed 3/3 and the full repeat passed
122 / two skipped. The timing cause was not established.

This correction changes only `host/files-watch.test.ts` and this evidence. Before clearing the
callbacks and measuring the separate 20-file burst, the test now observes successful real native
delivery to both clients. The warmup retries writes to one fixture file at 100 ms intervals within
a five-second bound; it never synthesizes callbacks. Burst delivery and post-release delivery
also have five-second bounds. The test's total bound is 20 seconds to accommodate those waits.
The shared-watcher count, burst callback count (<5), independent-client release, and close/no-late-
callback assertions remain. Successful callbacks must carry no error. Runtime code is unchanged;
this is a test-readiness correction, not a claimed product fix.

A first correction attempt used a single warmup write; its focused run failed 1/3 because no
first callback arrived within five seconds. The final bounded retry warmup then passed sequential
verification in the parent's explicitly released exclusive runtime window:

- `bun run --cwd apps/desktop test -- host/files-watch.test.ts`: **3 passed**, 2.66 s.
- `bun run --cwd apps/desktop test`: **122 passed, two skipped**, 32.66 s.

No build, Electron, clipboard, or package reruns were performed for this test-only correction.
The earlier evidence and failures above remain historical results. The runtime window was released
after verification. The user then explicitly verified the correction and requested skipping the extra
independent correction review; that review was interrupted without a Ship verdict. The acceptance
basis is the prior fresh FULL independent Ship review, the post-correction host checks above and
the user's verification. Actual VoiceOver remains **USER-DEFERRED**, neither passed nor blocking.


## Main integration after reveal/filter and retained-editor changes

The source implementation is committed as `5986802a973fe723b9c1dcb9c0b5a5681806935c`.
The combined integration starts from Files46 main `366d3782fbe655d8443eb2314d9e4a5ca3bb532e`.
The merge was textually clean. Its new watch IPC handler still referenced the removed
`closingProjects` flag, so the parent reconciled it with the existing retained-session
policy: subscriptions require a live saved session and reject quit; event delivery additionally
requires the same cached Project and exact captured session. Editor closure does not revoke
a session. Project.watchFiles retains checkout/root identity and no-follow validation.

The existing context-authority lifecycle regression now also subscribes through the real
preload watch API after editor closure/navigation. Real filesystem writes produce notifications
for retained sessions; replaced checkout roots and quit reject subscription. Existing Finder
target, ignored preference, draft baseline and disk assertions remain unchanged.

The parent handled this integration directly at the user's request after the persistent merge
agent failed. The earlier independent full source Ship review remains recorded above; no new
independent integration verdict is claimed. The user's explicit correction verification and
request to skip the extra correction review are recorded separately above.

Sequential combined verification:

- `bun run --cwd apps/desktop typecheck` and `lint`: passed.
- `bun run --cwd apps/desktop test`: **152 passed, four opt-in skips**, 31.66 s.
- `bun run --cwd apps/desktop build`: passed; existing chunk-size warning remains.
- `bun run --cwd apps/desktop smoke -- tests/files-watch.spec.ts tests/files-reveal.spec.ts tests/files-drag.spec.ts tests/files-trash-handoffs.spec.ts tests/agents-files-recovery.spec.ts`: **33 passed**, 1.5 minutes.
- The generated 20,000-file fixture measured root 715 ms, expansion 67 ms, two arrow keys
  10 ms and external update 204 ms, retaining exactly the loaded directory watches.

Logs: `/tmp/escode-parent-47-integration-{host,build,electron,package}.log`.
VoiceOver remains user-deferred. Physical Finder drop and native Finder reveal observations
remain final acceptance checks; they are not established by these automated workflows.
Final parent acceptance, authenticated-provider work and signing are not claimed.

- `bun run --cwd apps/desktop package`: passed, unsigned macOS arm64 application.
- `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-watch.spec.ts tests/files-reveal.spec.ts`: **8 passed**, including all four retained-session/root/quit watch-authority cases. No test/build processes remain active.
