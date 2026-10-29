# Desktop compatibility foundation

This is the implementation slice for [Prove packaged desktop launch and installed-tool compatibility](https://github.com/ejjsharpe/escode/issues/12), governed by [the v1 specification](https://github.com/ejjsharpe/escode/issues/11). The screen is a compatibility harness, not the completed editor.

## Run

Use Bun 1.4.4 and Node 26.13.0 (the tested tooling runtime).

- `bun install --frozen-lockfile`
- `bun run dev`
- `bun run typecheck`, `bun run lint`, `bun run test`
- `bun run build`, `bun run package`
- `bun run smoke` builds/packages first and runs the Electron tests.

Nx owns orchestration. Vite Plus provides build, development, formatting and Vitest. ESLint provides linting. Versions are exact in manifests and bun.lock; Vitest 5.0.5 is supplied by Vite Plus 1.4.0. Electron 45 no longer declares an install lifecycle script, so the root postinstall explicitly invokes its binary installer. Bun trusts Nx and esbuild lifecycle scripts. The blocked electron-winstaller script concerns Windows packaging, outside this macOS check.

The unsigned local app is at `apps/desktop/release/mac-arm64/escode.app`. Signing, notarization and distribution are not established by this check.

## Runtime and trust boundary

The sandboxed renderer has context isolation and no Node integration. Its frozen preload API contains only argument-free `toolStatus()`. The host rejects arguments, foreign senders, subframes and unexpected document URLs. Navigation, popups and permission requests are denied. Production CSP permits bundled scripts and worker assets, with inline styles for Monaco.

Tools are discovered through the inherited PATH followed by conventional user Bun/Cargo/local, Homebrew and system locations. No login shell or shell startup files are executed. Nonstandard install locations currently need an inherited PATH entry. The npm/Bun Codex JavaScript launcher runs using Electron's bundled Node mode; it does not depend on a shell-installed Node executable. Executables remain user-installed software, not bundled Git/Codex.

## Codex support policy

Only codex-cli **0.165.0** is admitted. Other versions return setup guidance without starting app-server. Expanding support requires rerunning these checks and reviewing that version's generated schema. The probe uses newline-delimited stdio JSON-RPC: initialize/initialized, account/read (refreshToken false), and config/read (includeLayers false). It sends no turns, changes no configuration and starts no provider thread.

Only authentication presence and model, reasoning effort, approval policy and sandbox mode are returned to the renderer. Tokens, account details, raw configuration and configuration layers are excluded. Errors have bounded guidance; the probe times out and terminates its child.

The current probe reads configuration in the home directory, proving access outside a development shell. Checkout-specific resolution, requirements and actual new/resumed thread effective settings remain acceptance gates for the subsequent chat implementation. Null values mean the config/read field is unset; they are not claimed as resolved thread defaults.

Official references: [StyleX Vite integration](https://stylexjs.com/docs/learn/installation/vite/), [Vite Plus configuration](https://viteplus.dev/config/), [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server).

## Evidence

Test host: macOS 26.3.1 (25D2128), arm64; Bun 1.4.4, Node 26.13.0.

- Clean isolated manifest/lockfile installation passed, including explicit Electron binary installation.
- Standard TypeScript checking and Oxlint passed for the initial foundation; the current lint command uses the local ESLint configuration.
- Production renderer and bundled CommonJS host/preload build passed; electron-builder produced an unsigned arm64 app using Bun's dependency collector.
- Packaged Playwright launch with PATH=/usr/bin:/bin passed: production StyleX background, Monaco rendering and JSON-worker error diagnostics, Git 2.50.1 discovery, Codex 0.165.0 discovery, authenticated account/read and config/read, absence of renderer require and the single-capability bridge.
- Development Electron smoke passed: changing a StyleX color updated the visible screen, then the test restored the source.
- The missing-tool host test passed after first failing before implementation.

The smoke tests require this machine's separately authenticated supported Codex installation. They are live compatibility checks, not portable hermetic unit tests. No paid model turn is sent. Intel macOS, other Codex versions, Finder/Gatekeeper distribution, VoiceOver and the later editor/chat workflows are not covered here.

## ESLint configuration

The root eslint.config.mjs is a local flat configuration inspired by [Expo Universe](https://github.com/expo/expo/tree/master/packages/eslint-config-universe), rather than a dependency on that preset. ESLint 10.13.0 checks correctness, imports, TypeScript conventions and React Hooks; style conventions are warnings. Node globals apply to the host/tooling, browser globals to the renderer. Type checking handles TypeScript module resolution and JSX names. Oxfmt remains responsible for formatting.

The import-x plugin supports ESLint 10. Universe's legacy React plugin is not included because its declared peer range excludes ESLint 10; Hooks checks use eslint-plugin-react-hooks directly. This is a tailored rule set, not full Universe parity.

typescript-eslint currently needs the TypeScript 6 JavaScript API. Following [Microsoft's side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/#running-side-by-side-with-typescript-6-0), the typescript dependency aliases @typescript/typescript6 and typescript-7 aliases TypeScript 7.0.2. The tsc executable still runs 7.0.2; tsc6 is available for the compatibility API.
