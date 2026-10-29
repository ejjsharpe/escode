# No project chats (#34)

Bounded implementation evidence for [No project scratch chats](https://github.com/ejjsharpe/escode/issues/34)
under [the Agents specification](https://github.com/ejjsharpe/escode/issues/26).
This does not certify the full parent specification or its fourteen acceptance scenarios.

## Implementation

A saved chat has a nullable project association. No project drafts have no working
directory until first Send. The host reserves a unique child of Electron user data's
scratch directory, persists the reservation before mkdir, then records its device/inode.
No renderer path, synthetic project, Git initialization or separate Codex profile is involved.
Paths and effective provider settings are shown in the existing conversation UI.

The existing per-chat first-Send guard covers authorization, preparation and binding.
A reserved scratch path cannot change context. Retries validate the recorded directory;
they never reconstruct it, replace an uncertain provider thread, or replay a prompt.
An incomplete folder/ownership persistence handoff retains the reservation and any
files with an explicit error. Restoring the original directory can recover a known
identity; an incomplete ownership reservation requires external investigation.
There is deliberately no cleanup, expiry, relocation or deletion feature.

Creation supports zero targets, a single contextual target, and the multiple-target
picker, including previously used No project contexts. Context changes before resource
preparation preserve text, identity and creation time and move local drafts into Agents.
Creation timestamps remain actual timestamps; persisted append positions break ties so
immediate creation appears first without reordering on Send or activity.
Unallocated drafts do not show a shared-files notice.

Sessions, request tokens, Stop and process shutdown use the existing shared service.
Request answers and Stop remain independent of pending Send acknowledgements.
Scratch identity validation applies before connections, sends and request responses;
Stop remains available without filesystem validation. Existing project approval,
closed-editor memory, quit and Files recovery contracts remain in place.

## Verification (2026-10-29, macOS arm64)

Baseline: a17ec27f32d7e61710bab7c32bb5ef4bfbae3cbb.
Installed Codex: 0.165.0. Electron: 45.1.0.

Commands run from the assigned checkout:

- `bun install --frozen-lockfile`
- `bun run --cwd apps/desktop typecheck`
- `bun run --cwd apps/desktop lint`
- `bun run --cwd apps/desktop test`: 102 passed, 3 opt-in/platform checks skipped.
- `ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop test -- host/scratch.test.ts`:
  9 passed, including the installed-Codex test.
- `bun run --cwd apps/desktop smoke`: 34 passed, 1 opt-in live chat skipped.
- `bun run --cwd apps/desktop build`
- `bun run --cwd apps/desktop package`: unsigned macOS arm64 directory build.
- `bun run --cwd apps/desktop smoke -- tests/project-drafts.spec.ts tests/agents-files-recovery.spec.ts tests/retained-project.spec.ts`:
  6 passed.
- `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/scratch.spec.ts tests/packaged.spec.ts`:
  3 passed, including packaged tool discovery with restricted PATH.
- Impeccable mechanical detector on the two changed UI components: no findings.
- `git diff --check`.

Host tests use real temporary directories and controlled protocol connections to check
zero allocation on draft open, distinct paths, occupied destinations, retained file
bytes, missing/replaced identity, failures before allocation/after mkdir/during provider
creation/after acceptance, restart without replay, and shutdown during provider startup.

Electron scratch tests exercise creation, project↔No project draft movement, text/order/
identity retention, simultaneous requests using the same wire ID, and acknowledgements
held until approval. They check the actual process cwd, approval and interruption
routing, stopped restart, retained bytes and unsent text. The zero-project test injects
failure of host Git execution; this is controlled missing-Git evidence, not removal of
the system Git installation. Provider protocol/settings in these Electron tests are
fixtures. Screenshots inspected at 728×600 and 1100×768 preserve the approved dark
Agents/sidebar/conversation/composer layout; short windows scroll to reach controls.

The installed-Codex test concurrently runs two scratch chats and a real project checkout,
writes and reads exact SCRATCH_0/SCRATCH_1 bytes in distinct initially non-Git scratch
directories, shuts down the service, opens both histories on fresh connections with one
user message each, and explicitly sends a follow-up in the original scratch directory.
Both provider-returned settings snapshots were model gpt-6.1-sol, reasoning xhigh,
approval on-request, sandbox readOnly with networkAccess false. These are observed
settings, not a promised sandbox or profile boundary. Runtime JSON evidence is written
to /tmp/escode-34-live-evidence.json by the opt-in test; temporary test folders are removed
by test cleanup, not by the application.

## Limits

Manual VoiceOver validation of the new controls has not been performed. Keyboard
semantics and existing accessibility regressions are automated evidence only. Real
approval prompts, authentication failures, provider uncertainty and absent Git are
covered with controlled events/failures rather than new live service outages.
Packaged scratch execution uses the controlled provider; real Codex execution above
uses the host seam. Deferred draft worktree preparation (#35), broader recovery (#36)
and integrated parent acceptance (#37) remain separate.
