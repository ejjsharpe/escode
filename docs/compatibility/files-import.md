# Native Files import evidence

Implements [Import Finder files by drop and paste](https://github.com/ejjsharpe/escode/issues/45)
against [the Files specification](https://github.com/ejjsharpe/escode/issues/38), from clean
`1b70bca6a0d693e6c90b029c5759c8e8a00aa5bd` on `t3/implement-issue-38`.
No newer main or separate integration checkout was imported. This is an unstaged implementation
handoff, not a commit, review approval, integration or tracker closure.

## Boundary and behavior

The isolated sandboxed preload resolves dropped `File` objects with Electron 45's supported
[`webUtils.getPathForFile`](https://www.electronjs.org/docs/latest/api/web-utils). JS-created
Files return no disk path; strings, URLs, file names and objects with a `path` property do not
grant access. Only that resolver exposes the private capture IPC channel; the generic project
bridge cannot capture arbitrary external paths. Main validates the owning window, main frame,
and document URL on both channels. This trust boundary assumes Electron context isolation and
sandboxing, not a compromised preload/main process.

Files-scoped Paste reads the native copied-files format in main using
[`ClipboardItem`'s `text/uri-list` mapping](https://www.electronjs.org/docs/latest/api/clipboard-item)
(NSFilenamesPboardType on macOS). It never parses renderer text as file authority. An existing
escode clipboard token takes the ordinary checkout-scoped path, including stale-token rejection;
native paste is considered only when that internal format is absent. Monaco/text-field shortcuts
remain untouched. Context-menu Paste and tree Cmd+V share the same destination resolution.

Native references hold only source descriptors, source type/inode and ancestor identity strings.
There is no parent-directory descriptor, Project registration, filesystem read endpoint or saved
approval. Captures expire after 60 seconds (descriptor cleanup every 10 seconds), are single use,
and clear on reload/navigation, renderer loss and window closure. Active batches own their taken
references until completion/failure, then close them. Invalid destination setup also closes them.
The journal contains the ordinary destination intent and source basename, never a reusable native
capability. Restart cannot resume reading an external source. Uncertain copies retain their stage
and block mutations through the existing journal policy.

The actual target folder, originating Project/session, checkout and destination-parent identity
are captured before operation awaits. Main preflights recursive sources asynchronously, including
before collision consent. The shared validation callback runs after consent and journal persistence
immediately before replacement Trash and again before the transfer. The native helper receives only
the approved checkout descriptor and imported source descriptor; it revalidates source paths and all
ancestor identities, source type/inode, checkout root, destination parent and held staging identity
before publication. It rejects no-follow violations, .git, hard links and nonregular recursive
contents. Protected app-state sources/ancestors and destination paths use the host's existing guard.
A nested selection is pruned. Same-folder import chooses a free sibling name and cannot Trash its
own original; importing a folder into itself/descendants is rejected.

Imports are copies of original disk bytes. They do not decode text or inherit source drafts,
including a native reference to an already-open dirty checkout file. Binary and large regular files
use native asynchronous copying. Keep Both/Skip/Cancel, clean-file Replace consent, dirty-destination
protection, progress, actual partial outcomes, completed batch facts, persistence acknowledgement and
focus restoration reuse the shared path. Folder/type collisions do not merge or replace trees.
Source drafts and independently dirty destination work remain available. No external move-out is added.

## Checks and inventory

Environment: macOS arm64 Darwin 25.3.0, Bun 1.4.4, Electron 45.1.0, Playwright 1.64.1,
Monaco 0.57.0. Tests use generated temporary repositories and packaged/unpackaged Electron,
without a dev server or protected port. Native dialog answers use the controlled Electron dialog seam.

Changed code:

- `host/native-import.ts`: bounded source descriptors and no-follow ancestor identity capture.
- `host/preload.ts`, `host/main.ts`: genuine File resolver, native clipboard adapter, expiry/lifecycle,
  originating scope, preflight and shared transfer routing.
- `host/project.ts`, `host/filesystem.c`: async native-source preflight/copy, source/ancestor/root/parent
  and staging revalidation; safe recursive scan rewinds its directory descriptor.
- `host/file-operations.ts`: imports participate in copy intents with no source draft payload.
- `src/files.tsx`, `src/main.tsx`: native drop targeting and shared renderer operation reconciliation.
- `host/native-import.test.ts`, `host/native-races.test.ts`: real disk binary/unsupported-source and
  synchronized native source, ancestor, destination parent, root and staging replacement cases.
- `tests/files-import.spec.ts`: native clipboard, native-backed File/preload forgery, origin navigation,
  unchanged originals, partial rejection, dirty conflicts, disk-only drafts and long-copy/fixture Stop.
- `tests/packaged.spec.ts`: explicit preload surface inventory includes `nativeFiles`.
- `README.md`, `GLOSSARY.md`, this record, and bounded manual-status amendment in `files-drag.md`.

Reproducible commands:

```
bun run typecheck
bun run lint
bun run test
bun run build
bun run package
bun run --cwd apps/desktop smoke -- tests/files-import.spec.ts tests/files-drag.spec.ts tests/files-transfer.spec.ts tests/files-trash-handoffs.spec.ts tests/packaged.spec.ts
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-import.spec.ts tests/files-drag.spec.ts tests/files-transfer.spec.ts tests/files-trash-handoffs.spec.ts tests/packaged.spec.ts tests/accessibility.spec.ts tests/concurrency.spec.ts
```

The import long-copy fixture generates 8,000 binary files / 500 MiB, checks destination bytes,
navigates to Agents and interrupts a deterministic protocol chat while the native copy is still
running. This is fixture responsiveness evidence, not authenticated/live-provider evidence.
An initial focused passing run measured 2,623 ms native import and 2 ms fixture Stop. The shared
internal-copy regression also passed with early-open clean-model unsaved-text delivery, undo/restart,
dirty collision preservation and stale snapshot/acknowledgement facts. Five synchronized native-import
publication races passed along with the eight existing native race cases (13 tests total).

Initial failures were corrected before final checks: the traversal test initially used `path.join`,
which normalized its own attack string; a deep 32 MiB Buffer assertion exhausted the Vitest worker heap
and was replaced with byte equality; the pending-project test needed to await completed project
navigation before answering consent; the packaged bridge inventory needed the new explicit method.
An intermediate broad run passed 29 Electron cases and failed only that outdated bridge inventory.
These failed attempts are not counted as clean verification.

Final results are recorded below after the stable artifact checks.

## Manual limits

No new Finder-origin OS drag or manual Finder file-copy/Paste was performed. The automated clipboard
journey writes/reads the real OS native files format through Electron. The drop test obtains a
native-backed File through Chromium's file chooser seam (`setInputFiles`), then dispatches a synthetic
drop. It proves native File resolution and application routing, **not a Finder gesture**. It also
rejects JS-created Files, forged paths and forged path-bearing objects. Manual Finder drop of a file
and folder, Finder Cmd+C followed by Files Paste, target feedback and VoiceOver focus/progress remain
for the parent/user to check in the concrete reviewed app.

The parent supplied user-confirmed #44 drag move/copy, unsaved-text, Cancel, hover and VoiceOver
confirmation/focus PASS; #43's earlier bounded transfer VoiceOver pass remains accepted. No manual
process restart or new import VoiceOver check is claimed. The independent #44 main integration stays
separate. No signing, live-provider run, atomic transaction or batch rollback is claimed. Unrelated
filesystem writers still have the existing narrow check-to-syscall race; in-place source edits and
concurrent directory membership changes are not a transactional snapshot. Unsupported contents fail
visibly; post-staging failures retain uncertain stage/intent for inspection instead of recursive cleanup.

All task changes remain unstaged and uncommitted. No delegation, tracker write, issue closure,
commit, merge, push or PR. Protected `/tmp/escode-files-{39,40,41,42,43,44}-manual-*` snapshots,
ports 5173–5178, Desktop/escode-files-test and `/private/tmp/escode-files-44-integration-47c070e`
were untouched.

## Stable artifact results

- `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`, and `bun run package`
  passed. The full host run passed **114 tests, 2 opt-in skips**, 38.54 s runner / 39.9 s wall.
  The test-only TypeScript indexing of additional native-race pipe descriptors was corrected
  to `.at()`; subsequent typecheck/lint pass.
- The stable unsigned packaged seven-suite command above passed **33 tests in 1.7 minutes**,
  including five native import journeys, nine internal drags, six shared transfers, ten
  persistence/handoff journeys, accessibility, concurrency and package loading. Import measured
  **3,380 ms** for 500 MiB / 8,000 files, fixture Stop **2 ms**, with Agents navigation during
  copying. Shared internal copy measured **3,373 ms**, Stop **2 ms**. Source originals and
  destination bytes/drafts were checked by the relevant tests.
- A final small renderer correction routes synchronous native-file resolver errors into the
  existing drop error/focus handling. A synthetic JS File drop regression was added; the app
  was rebuilt/repackaged after the 33-case run and the affected import/package suites rerun.
  Their results and final artifact hash follow below.
- Impeccable's mechanical detector returned `[]`; the Electron import/progress capture was
  inspected in the incumbent layout. No visual redesign or dependency was introduced.

The rebuilt final artifact passed **all 6 affected packaged import/package tests in 21.4 s**,
including visible rejection of a synthetic JS-created File drop (no unhandled resolver error),
native-backed File routing/reload expiry, disk-only drafts, protected app state, native clipboard,
partial recursive rejection and pending-origin/source consent. Final native import measured
**3,335 ms** for 500 MiB / 8,000 files; fixture Stop **2 ms**, navigation during copying.
Final `Contents/Resources/app.asar` SHA-256:
`f0e79c1952e5a1b597369bd2c059dfcbe0740103ea5f40b2597e93ed967eaf8e`.
Final typecheck/lint and `git diff --check` pass; the index is empty and HEAD is still the supplied
baseline. The final renderer-only error handling correction does not change the tested host/helper.

Ready for a **fresh independent full Ponytail review** of the exact 16-file unstaged/uncommitted
working tree listed in the inventory above. Manual Finder/import VoiceOver acceptance remains
unobserved and belongs to the parent/user handoff after review. No review approval is claimed.

## R2 correction after fresh full Ponytail R1 review

R1 independently reproduced two deterministic preflight defects in the packaged native-clipboard
branch. Raw source/destination path strings missed case-insensitive aliases: same-file Replace could
Trash the original, and a directory destination reached through an alias could stage recursively
inside the original. Separately, an unsupported native basename (`bad\\name.txt`, valid on macOS but
outside the app's one-name policy) reached collision consent/Trash before name validation. These were
bugs, not the accepted narrow check-to-syscall race. The earlier readiness and package hash are
superseded by the R2 checks below.

R2 changes these files within the same original 16-file unstaged implementation:

- `host/native-import.ts`: compare source directory identity against actual no-follow-opened destination
  ancestor `(dev, ino)` values; close each temporary descriptor immediately. Revalidate regular-file
  hard-link count as well as source identity/type. There is no lowercase pathname identity test,
  `realpath` approval, new Project registration or retained parent descriptor.
- `host/main.ts`: use actual source/destination identity for same-object sibling naming and the same
  ancestor check for self/descendant rejection in the shared validation callback. Recheck before
  collision consent, immediately before replacement Trash after its journal, and before transfer.
  Validate the proposed basename before preflight/collision handling, validate the selected existing
  spelling before offering choices, and validate every final/generated name again at execution.
  Keep Both continues through the shared validated free-name allocator. Captured aliases deduplicate
  by source identity; descendant pruning and protected app-state ancestor checks also use identities.
- `host/project.ts`: reject native directory self/descendant destinations before invoking copy.
- `host/filesystem.c`: independently inspect approved destination ancestor identities before creating
  any import stage and again before publication. Traversal stays under checkout descriptor 3; it does
  not open or approve an external parent tree. Held-source/root/parent/stage identity checks and the
  no-recursive-cleanup uncertainty policy remain intact.
- `host/native-import.test.ts`: alias/Unicode identity and distinct-object checks, no-follow symlink
  rejection, and hard-link rejection both at capture and after capture.
- `host/native-races.test.ts`: direct helper descendant rejection before any stage/result exists,
  alongside the existing synchronized source, ancestor, root, parent and staging replacement cases.
- `tests/files-import.spec.ts`: real native clipboard regressions for case-alias same-file and folder
  descendant targets, Unicode parent aliases, and an unsupported occupied basename. They inspect
  original/destination disk bytes and identities, unchanged folder membership/mtime, no unwanted
  native Trash/move/import command, and no false collision prompt. Same-file imports produce a valid
  free sibling. Alias tests skip with a reason only when the fixture filesystem does not resolve that
  spelling to the same object. The tests do not simulate file-reference provenance through renderer
  strings or synthetic Files.
- This evidence document records failed-before/pass-after results and remaining limits. No product
  concept changed; `GLOSSARY.md` needs no further amendment for R2.

### Failed before / passed after

Before editing production code, the three regression cases ran against R1's existing package
(`f0e79c1952e5a1b597369bd2c059dfcbe0740103ea5f40b2597e93ed967eaf8e`):

```
ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/files-import.spec.ts -g 'R1 native clipboard'
```

All three failed in the reported branch: same-file original `ENOENT`; unsupported-name destination
`ENOENT`; descendant import entered recursive `.escode-copy-*` staging inside the original. The test
killed only its own helper after 500 ms; Node's fixture cleanup then hit `ENAMETOOLONG`, masking the
expected rejection assertion in that case. The exact generated fixture was removed with descriptor-
based Python cleanup. No protected/manual fixture was touched. The regression watchdog now kills
that forbidden folder import as soon as staging is reported, with the timer retained as fallback;
correct code never invokes that helper for this target. Native Trash output was recorded so only
these tests' own trashed fixtures were cleaned up.

After the fix, rebuilding/repackaging and repeating the same three-case command passed **3/3 in
6.2 s**. Both case-alias scenarios executed on this filesystem, with no skips. Same-file original
bytes/inode remained at the original path and a sibling copy was created without a prompt or Trash;
descendant import performed no mutation or prompt and added no staging entry; unsupported names
preserved both source and occupied destination bytes/inodes without offering Replace or Keep Both.
The Unicode-parent alias audit is included in the final broad run below.

Audit scope: source/destination comparisons rely on actual OS object identities, so distinct objects
are not equated by case or Unicode folding. Existing conservative case/Unicode collision-name
matching remains a naming policy; it grants no source identity or path authority. Symlink ancestors
still fail no-follow opens; regular hard links still fail capture/preflight and now revalidation.
No mounted-volume or case-sensitive-volume fixture was created, and no claim of observed behavior
on an additional mounted topology is made. No parent approval or mount/filesystem framework was added.
The existing narrow cross-process races, native manual Finder gestures, import VoiceOver, signing and
live-provider limits still apply. Prior user-confirmed #44 manual PASS remains bounded and unchanged;
no manual import or process-restart acceptance is inferred from it. Main/integration source `a3f9d81`
was neither read/imported nor merged; HEAD remains `1b70bca6a0d693e6c90b029c5759c8e8a00aa5bd`.

### R2 verification and handoff

The rebuilt packaged seven-suite command above passed **37/37 tests in 1.8 minutes**, including all
four R1 native-clipboard regressions (case aliases and Unicode alias all executed, no skips), dirty
source/destination preservation, clean consent, native provenance boundary, source-change consent,
nine internal drag cases, shared early-open clean-copy text/undo/restart and ten journal/batch-fact
handoff cases. The 500 MiB / 8,000-file native import measured **3,442 ms**, concurrent fixture Stop
**2 ms** and navigation completed while copying; shared internal copy measured **3,530 ms**, Stop
**2 ms**. These are fixture protocol measurements, not live-provider evidence.

Typecheck, lint, full host tests, build and unsigned package passed. The focused native import/race
host command passed **17 tests in 3.44 s**. The final post-capture hard-link assertion also passed
in the focused three-test native import host suite. A final small pruning improvement uses the
already-captured no-follow ancestor identity list for native nested selection, avoiding repeated
filesystem opens for each source pair. The partial native-clipboard regression now includes a
selected folder and its child and requires no redundant child import. The final host and rebuilt
package affected-suite results and artifact hash follow below.

R2 does not add authority, dependencies, product concepts, renderer import APIs or a filesystem
framework. The original index remains empty; all sixteen task files remain unstaged/uncommitted.
There was no delegation, stage/commit, tracker write, merge, push, PR or access to another checkout.
Protected manual snapshots, ports 5173–5178 and Desktop/escode-files-test remain untouched.

Final R2 results: typecheck, lint, `git diff --check`, full host test, build and package pass.
Full host test: **116 passed, 2 opt-in skips**, 36.09 s runner / 37.5 s wall, including the final
hard-link revalidation assertion. After rebuilding the pruning change, the affected packaged import
and package-loading suites passed **10/10 in 26.7 s**, including all four native-clipboard regressions
without alias skips and folder/child pruning. Final 500 MiB import: **3,517 ms**, fixture Stop **2 ms**,
Agents navigation during copying. No package/build was changed while that final suite ran.

Final R2 `Contents/Resources/app.asar` SHA-256:
`9ee16088adf57b39f6ea305ccb45ab05a7afa088dfa5582393e8531007ebff64`.
The index is empty and HEAD remains the supplied `1b70bca6a0d693e6c90b029c5759c8e8a00aa5bd`.

Ready for a **NEW fresh independent FULL Ponytail R2 review** of the full 16-file unstaged,
uncommitted #45 diff, including the eight R2 files named above. This is implementation readiness,
not review approval or parent acceptance. Real human Finder gestures and import VoiceOver remain
pending with the parent/user; no additional manual, signing, mounted-volume, live-provider or
transactional guarantees are claimed.
