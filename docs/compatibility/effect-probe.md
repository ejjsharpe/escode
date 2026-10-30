# Disposable Effect/T3 packaged probe

This implements [Prove the packaged Effect/T3 path](https://github.com/ejjsharpe/escode/issues/63), under the [approved fresh-state amendment](https://github.com/ejjsharpe/escode/issues/61#approved-scope-amendment). It qualifies only this installation. It does not extract production infrastructure or change application routes, stores or product behavior.

## Reproduce

From the repository root:

```sh
bun run --cwd apps/desktop test -- host/foundation-probe.test.ts
bun run build
bun run package
ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop smoke -- tests/effect-probe.spec.ts
ESCODE_PACKAGED=1 ESCODE_LIVE_CHAT=1 bun run --cwd apps/desktop smoke -- tests/effect-probe.spec.ts
```

The live flag explicitly consumes one installed Codex turn per mode. Without it, the same smoke runs deterministic protocol/cleanup checks. The existing vite-plus and Playwright runners are retained. Each invocation creates and removes a temporary working directory, ephemeral provider thread, random process-only bearer credential and literal-loopback ephemeral port. No escode state is read or imported. Provider authentication is supplied by the installed Codex; its existing history and credentials are not deleted.

The separate `dist/host/foundation-probe.cjs` runs with `ELECTRON_RUN_AS_NODE=1`, including from the packaged app's ASAR. Packaged PATH is exactly `/usr/bin:/bin`; the existing installed-tool resolver and Electron Node-launcher handling are reused. This proves bundled CJS/platform/provider execution in embedded Node, not renderer UI/bootstrap integration. The packaged application starts its ordinary main entry unless the probe is explicitly invoked.

## Checks and boundaries

- Before WebSocket upgrade, reject independently absent/incorrect credentials, wrong path, Host, Origin and wire revision. The disposable credential expires with the process; this is not a production ticket/pairing/session implementation.
- Use Effect JSON WebSocket RPC with retries disabled, following the pinned T3 server/session composition. Observe real client ACK frames. A raw client withholding ACK receives one batch and no second batch over a 150 ms observation; a healthy client still progresses on the same server.
- Consume two one-element batches then cancel the client stream. Require server stream finalization while the client connection scope is still open, before socket shutdown can mask cancellation. This tests subscription cancellation, not stopping host-owned provider execution.
- Reject invalid typed provider initialization input and malformed known incoming notifications; fail the probe on failed/interrupted completion even after marker text. Deterministic in-memory transport fixtures exercise each failure using the same logger/handlers as the live connection. Route an unknown provider notification as opaque data without interpreting its embedded markup. Unknown provider requests receive method-not-found rather than approval. This is transport handling, not a renderer escaping test or a full supported-Codex matrix.
- Spawn a private process group with a descendant ignoring SIGTERM. Scope release explicitly escalates after 300 ms; assert the descendant PID no longer exists. Default Effect finalization without `forceKillAfter` waited indefinitely in the experiment, so production adoption must retain bounded escalation.
- A live ephemeral, read-only Codex thread streams `ESCODE_EFFECT_OK` through the tracked typed T3 transport and authenticated Effect WebSocket to the client. The stream is bounded to 32 queued deltas, 64 KiB total text, and a 120-second overall deadline; overflow fails explicitly. WebSocket inbound frames are capped at 64 KiB. These are probe limits, not production capacity claims. Upstream provider JSONL still has its original 128 MiB frame/32 raw-message limits and unbounded internal paths; those require production work.

Every assertion, schema/provider failure, deadline or nonzero smoke exit blocks production extraction. There is no downgrade, alternate IPC dispatch or fallback implementation.

## Source, closure and attribution

[Extraction manifest](../../apps/desktop/probe/extraction.json) lists every copied file and SHA-256, pinned to T3 `305a90dce44b8b7813d951662f13ce8510a3c669`. The Codex client/protocol/errors, generated schemas/metadata/namespaces, internal transport helpers, replay/RPC exports and generator are retained unchanged as a disposable source unit. Tests use the existing runner rather than upstream `@effect/vitest`; the generator is provenance only and is not run or given new generator dependencies. Its OpenAI protocol source pin is `687a119f0fcaace47e1f1abcc77cec6c813fd6da`.

T3's selected source unit compiles/runs on Effect 4.1.0 without patches. The probe uses its protocol logger hook (without printing payloads) to validate every known incoming notification against the pinned schema: upstream typed notification dispatch otherwise ignores decoding failures. Its unrelated `effect/Crypto` consumer and Vitest patch are not adopted. This does not establish compatibility for other T3 modules. TypeScript enables `.ts` imports for the unchanged upstream sources; no runtime dependency enters the renderer.

The exact required addition is `effect`, `@effect/platform-node`, `@effect/platform-node-shared` **4.1.0**; `undici` **8.12.3**; `ws` **8.22.0**; `@types/ws` **8.18.2**; `redis`, `@redis/client`, `@redis/bloom`, `@redis/json`, `@redis/search`, `@redis/time-series` **6.3.1**. Existing `@types/node` **26.6.6** closes through `undici-types` **8.9.0**. Redis is a required installation peer, not a service. Optional native/telemetry peers are absent. See `bun.lock` for integrity and dependency edges.

The build derives `dist/host/foundation-probe-dependencies.json` and `foundation-probe-NOTICES.txt` from actual emitted bundle inputs. The emitted third-party closure is Effect/core, both Node adapters (4.1.0) and ws (8.22.0), all MIT; tree-shaken Redis/Undici are installed but not emitted. Build fails if an emitted package lacks a license. T3 MIT and OpenAI Apache-2.0 LICENSE/NOTICE are retained under `probe/vendor` and included in packaged notices. The ASAR packages both generated records through its existing `dist/**/*` rule.

## Recorded installation and results — 2026-10-30

Observed macOS 26.3.1 (25D2128), arm64; Electron 45.1.0, embedded Node 24.22.1, Chromium 156.0.8078.49; Git 2.50.1 (Apple Git-155), installed Codex 0.165.0; shell Node 26.13.0. These identify this check, not a supported version range.

Development and packaged ASAR/restricted-PATH checks both passed. Each deterministic run recorded two ACKs, auth rejection, stalled delivery bounded to one batch, cancellation, schema/unknown handling and descendant cleanup. Live development and packaged each recorded two ACKs; both returned `ESCODE_EFFECT_OK`. The final packaged smoke took 14.3 seconds including both runs. Typecheck, lint, build and packaging passed; the full existing host suite passed 153 tests with four opt-in tests skipped (16 files passed, one skipped). No installed-Codex version beyond 0.165.0 is certified.

Installer check: the PATH launcher initially invoked Bun 1.3.14 despite the root version query reporting 1.4.4. Its regenerated lock was discarded. Downloaded official Bun 1.4.4 (`38afee6c8`) to a temporary directory, restored the original v2 lock, resolved only the new closure, then passed `bun install --frozen-lockfile` (482 installs, 617 packages, no changes). Existing lock entries remain, apart from hoisting Undici 8.12.3 with the previous version retained for Nx. The repository toolchain pin remains 1.4.4. The frozen verification also ran the repository Electron postinstall successfully.

Deferred: production authentication/bootstrap, independent host lifetime, host-owned turn cancellation semantics, persistence/recovery, directory slice, disk failure, exhaustive schema/provider versions, renderer/browser/mobile, second-client/revocation qualification, and full capacity/heap measurements. Later tickets retain their own gates.

## Review

Independent Standards and Spec reviews against `592eeb9766cf4658e8cd4bc39305bc1bca353b0b`, using ponytail review, found four weaknesses in the first probe: cancellation could be masked by connection teardown, missing credentials were not independently tested, terminal failure could follow marker output, and known incoming notification schema errors were ignored. All four were fixed and covered by the revised deterministic/live checks. Both second-round reviews report zero unresolved findings. The final packaged live run and full host suite passed after those fixes.
