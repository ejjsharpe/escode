# Desktop compatibility foundation

This is the implementation slice for [Prove packaged desktop launch and installed-tool compatibility](https://github.com/ejjsharpe/escode/issues/12), governed by [the v1 specification](https://github.com/ejjsharpe/escode/issues/11). The foundation now hosts the one-checkout file/Git editor slice from issue 13; it is not the completed v1.

## Run

Use Bun 1.4.4 and Node 26.13.0 (the tested tooling runtime).

- `bun install --frozen-lockfile`
- `bun run dev`
- `bun run typecheck`, `bun run lint`, `bun run test`
- `bun run build`, `bun run package`
- `bun run smoke` builds/packages first and runs the Electron tests.

Nx owns orchestration. Vite Plus provides build, development, lint and Vitest. Versions are exact in manifests and bun.lock; Vitest 5.0.5 is supplied by Vite Plus 1.4.0. Electron 45 no longer declares an install lifecycle script, so the root postinstall explicitly invokes its binary installer. Bun trusts Nx and esbuild lifecycle scripts. The blocked electron-winstaller script concerns Windows packaging, outside this macOS check.

The unsigned local app is at `apps/desktop/release/mac-arm64/escode.app`. Signing, notarization and distribution are not established by this check.

## Runtime and trust boundary

The sandboxed renderer has context isolation and no Node integration. Its frozen preload API contains argument-free `toolStatus()` and a typed project capability for open/status/files/read/save/diff. Project opening uses a host-owned native directory chooser; subsequent calls operate only on that canonical checkout. Paths and arguments are validated in the host, and symbolic links are rejected. The host rejects invalid arguments, foreign senders, subframes and unexpected document URLs. Navigation, popups and permission requests are denied. Production CSP permits bundled scripts and worker assets, with inline styles for Monaco.

Tools are discovered through the inherited PATH followed by conventional user Bun/Cargo/local, Homebrew and system locations. No login shell or shell startup files are executed. Nonstandard install locations currently need an inherited PATH entry. The npm/Bun Codex JavaScript launcher runs using Electron's bundled Node mode; it does not depend on a shell-installed Node executable. Executables remain user-installed software, not bundled Git/Codex.

## Codex support policy

Only codex-cli **0.165.0** is admitted. Other versions return setup guidance without starting app-server. Expanding support requires rerunning these checks and reviewing that version's generated schema. The probe uses newline-delimited stdio JSON-RPC: initialize/initialized, account/read (refreshToken false), and config/read (includeLayers false). It sends no turns, changes no configuration and starts no provider thread.

Only authentication presence and model, reasoning effort, approval policy and sandbox mode are returned to the renderer. Tokens, account details, raw configuration and configuration layers are excluded. Errors have bounded guidance; the probe times out and terminates its child.

The current probe reads configuration in the home directory, proving access outside a development shell. Checkout-specific resolution, requirements and actual new/resumed thread effective settings remain acceptance gates for the subsequent chat implementation. Null values mean the config/read field is unset; they are not claimed as resolved thread defaults.

Official references: [StyleX Vite integration](https://stylexjs.com/docs/learn/installation/vite/), [Vite Plus configuration](https://viteplus.dev/config/), [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server).

## Evidence

Test host: macOS 26.3.1 (25D2128), arm64; Bun 1.4.4, Node 26.13.0.

- Clean isolated manifest/lockfile installation passed, including explicit Electron binary installation.
- Standard TypeScript checking and Oxlint passed.
- Production renderer and bundled CommonJS host/preload build passed; electron-builder produced an unsigned arm64 app using Bun's dependency collector.
- Packaged Playwright launch with PATH=/usr/bin:/bin passed: production StyleX background, Monaco rendering and JSON-worker error diagnostics, Git 2.50.1 discovery, Codex 0.165.0 discovery, authenticated account/read and config/read, absence of renderer require and the single-capability bridge.
- Development Electron smoke passed: changing a StyleX color updated the visible screen, then the test restored the source.
- The missing-tool host test passed after first failing before implementation.

The smoke tests require this machine's separately authenticated supported Codex installation. They are live compatibility checks, not portable hermetic unit tests. No paid model turn is sent. Intel macOS, other Codex versions, Finder/Gatekeeper distribution, VoiceOver and the later editor/chat workflows are not covered here.


## File/Git slice evidence and limits

Real temporary-repository tests cover HEAD/index/disk baselines, unborn HEAD,
literal wildcard filenames, binary/oversized errors, external conflicts,
concurrent app saves, an external write during save staging, temporary-file cleanup,
invalid binary editor content rejected before disk mutation, and save failures. The Electron workflow covers retained
buffers, Cmd+S, comparison/cancellation/overwrite, external diff refresh,
selection restoration and a failed save retaining edits. Conflict resolution keeps
view navigation disabled; a second external change requires another explicit
overwrite decision, and Reload reads the latest disk version. The desktop screenshot
is captured by `tests/project.spec.ts`.

Files are UTF-8, limited to 2 MiB. Git command output is bounded to 16 MiB.
Symbolic links are unavailable. Status refresh polls at two seconds. File service
operations currently run synchronously in the host; very large repository status
may pause the UI. Dirty buffers are retained only for the process lifetime;
crash recovery and close/quit prompts belong to later v1 slices.

Saving stages a sibling file, rechecks disk contents, then renames atomically.
Concurrent app saves cannot interleave the final synchronous check/rename.
Portable Node filesystem APIs do not provide compare-and-swap replacement:
an unrelated external process can still write between that final check and rename.
This residual race is not claimed as solved; issue 13 must remain open until its
required filesystem race guarantee is settled. Rename also replaces inode metadata
other than mode; hard-link relationships and extended attributes are not preserved.
No VoiceOver/manual accessibility certification is claimed.
