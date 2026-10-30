# Effect package and runtime compatibility

Research for [Which supported Effect package and runtime combination fits escode’s foundation?](https://github.com/ejjsharpe/escode/issues/51), under [Establish escode’s Effect host and client foundation](https://github.com/ejjsharpe/escode/issues/49).

Retrieved **2026-10-30 UTC**, beginning at 09:35 UTC. Engineering evidence and a recommendation, not architecture ratification. No packages were installed, application code changed, or upstream tests executed. Tests below were inspected as source evidence.

## Answer and recommended exact set

Target **Effect 4.1.0 stable** for the next isolated compatibility experiment: `effect@4.1.0` in contracts and clients, `@effect/platform-node@4.1.0` in the execution host, and its `@effect/platform-node-shared@4.1.0` dependency pinned in the future lockfile. Use the existing Electron **45.1.0**, whose embedded Node is **24.22.1**, and existing Bun **1.4.4** as tooling. Do not select a beta/RC or transplant a T3 lockfile. This set satisfies the inspected package engine and peer ranges; running it in escode remains an experiment, not an already verified integration. [Registry facts](#registry-snapshot-and-dependency-closure), [runtime evidence](#runtime-compatibility).

There is an important correction to the research prompt’s premise: the actual map-pinned T3 commit uses **stable 4.0.5**, not an Effect prerelease. Moving its code to 4.1.0 is still a real port because RPC, HTTP, socket and platform APIs remain unstable. The pinned source, not an older example or search snippet, determines this. [T3 evidence](#the-pinned-t3-reference).

For a peer-complete Node package set, explicitly account for **redis@6.3.1** as well: the platform manifest declares it as a required peer even if escode never opens a Redis connection. Prefer ordinary supported peer resolution over silently dropping the dependency. This does **not** propose a Redis service or persistence migration. If that closure is unacceptable, investigate upstream packaging or a narrower adapter in a separate decision; do not describe the standard Node package as dependency-free.

Optional later additions, only if used: `@effect/platform-browser@4.1.0` for browser-specific services, `@effect/platform-bun@4.1.0` if the host actually runs on Bun, `@effect/vitest@4.1.0` only after resolving its Vitest 5 peer with escode’s vite-plus test runner. A browser WebSocket RPC client can use `effect/socket` directly; a browser platform package is not required just to connect. Keep React presentation independent; no atom binding is needed for this ticket.

## Evidence pins, method and date discrepancies

All Effect source links use **9a91b1926a5fbfaffd302a7a41a94d4d53a1154e**, resolved through the GitHub commit API for tag `effect@4.1.0`. T3 uses **305a90dce44b8b7813d951662f13ce8510a3c669**. escode baseline is **70347aab4dec182c1f32e1ba2544c52cbba420a5**. Source archives were retrieved into a temporary directory, read with manifests/tests, and compared with live npm metadata. No install or package lifecycle scripts ran.

- [Effect tag resolution](https://api.github.com/repos/Effect-TS/effect/commits/effect@4.1.0), [4.1.0 release](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.0), [migration guide][migration].
- npm’s `time` fields place 4.1.0 platform publishes on **2026-10-29 03:45–03:46 UTC**, and core at **04:09:37.471 UTC**. Those dates precede this environment’s 2026-10-30 clock; no registry-versus-environment future-date discrepancy was observed. Versions and dist-tags are separate: `beta`, `rc` and `prev` still exist after stable v4.
- Official website chronology is less uniform: the [4.0 announcement](https://effect.website/blog/releases/effect/40) says last updated **September 30**, the [September recap](https://effect.website/blog/effect-v4-rc-september-recap) says **October 1**, and the blog index/search surfaces an October 2 stable-release item. The beta article displays February 18 while the blog index/search can surface March 20. These are publishing/index dates, not proof that v4 is still a beta. Use registry versions and pinned release/source identity for package selection.
- Downloaded `effect@4.1.0` and `@effect/platform-node@4.1.0` tarballs, computed SHA-512 and matched registry `dist.integrity`. Inspected their published manifests: wildcard exports map to `./dist/*.js`, not the monorepo’s TypeScript source exports. The core tarball contains `dist/rpc/RpcClient.js`. Integrity matching proves retrieved-byte identity, not independent provenance or runtime correctness.

## Support, stability and older package families

The [4.0 announcement](https://effect.website/blog/releases/effect/40) commits v4 bug fixes until September 2029 or one year after v5, whichever is later; security fixes until September 2029 or two years after v5, whichever is later. It also warns that some module APIs can break in minor/patch releases. The [pinned README][readme] requires TypeScript 5.9+, recommends TypeScript 7, strict mode, and says Node 18+ for core. That core requirement is **not** the full Node adapter requirement.

The [pinned migration guide][migration] specifies: stable/no-tag APIs follow semver; `@stability unstable` may break in minor releases; `@stability experimental` may break in patch releases. Modules outside `effect` are currently unstable. Exact pins and reviewed upgrades are therefore useful even within stable v4.

| Surface at 4.1.0 | Classification verified in source | Consequence |
| --- | --- | --- |
| `effect/Effect`, `Stream`, `Scope`, `Layer`, `Schema` | Module headers say stable | Suitable core foundation; individual export annotations remain authoritative |
| `effect/rpc/*`, `effect/socket/*`, `effect/http/*` | Unstable | Stable package release does not promise minor-version API compatibility |
| `effect/schema/*` supporting subsystem | Listed unstable in migration guide | Do not confuse this subtree with stable top-level `effect/Schema` |
| `@effect/platform-node`, node-shared, browser, bun | Unstable platform modules | Review adapter API changes and whole dependency closure on upgrade |
| `effect/unstable/rpc`, `effect/unstable/socket` | Removed old paths | No compatibility exports; current imports omit `/unstable/` |
| `@effect/schema`, `@effect/rpc`, `@effect/platform` | Older v3 package family, consolidated in v4 | Do not add these alongside v4 to obtain Schema/RPC/platform services |

Sources: [Effect][effect], [Stream][stream], [Schema][schema], [Scope][scope], [Layer][layer], [RPC client][client], [Socket][socket], [migration][migration]. This recommendation does not depend on an experimental API. Neither a `0.x` version nor an old npm `latest` alone proves deprecation or end of maintenance.

The [beta announcement](https://effect.website/blog/releases/effect/40-beta) states continued active v3 maintenance after v4 stability. Live metadata corroborates ongoing v3 releases on **2026-10-22**: `effect@3.22.4`, platform `0.97.3`, RPC `0.76.4`, node `0.108.4`, node-shared `0.61.2`, browser `0.77.2`, bun `0.91.4`. The registry `prev` tag selects those; `latest` for the standalone platform/RPC packages still points to older `0.97.2`/`0.76.2`. No equally precise v3 LTS end date was established. The standalone `@effect/schema@0.75.5` has a `^3.9.2` Effect peer; Schema is now available from `effect/Schema`. Do not infer a v4 peer from its tag.

The v3 Node adapter is not a minimal fallback: its manifest peers include Effect, platform, RPC, SQL `^0.52.2`, cluster `^0.60.5`; SQL adds experimental `^0.61.2`, cluster adds workflow `^0.19.1`. Its shared dependency includes `@parcel/watcher`. This research does not claim a fully frozen v3 transitive solution; v3 is a maintained alternative, not the recommended new foundation. See exact [node metadata](https://registry.npmjs.org/@effect%2fplatform-node/0.108.4), [SQL metadata](https://registry.npmjs.org/@effect%2fsql/0.52.2), [cluster metadata](https://registry.npmjs.org/@effect%2fcluster/0.60.5).

## Registry snapshot and dependency closure

Directly retrieved npm packuments, including versions, publication times, manifests, tags and integrity records. The exact-version URLs below are the reproducible primary evidence. A later installer may resolve newer range members; this is a **proposed exact closure**, not a generated Bun lockfile.

| Exact package | Required outgoing edges / engine |
| --- | --- |
| [`effect@4.1.0`](https://registry.npmjs.org/effect/4.1.0) | No runtime dependencies or peers; no manifest Node engine |
| [`@effect/platform-node@4.1.0`](https://registry.npmjs.org/@effect%2fplatform-node/4.1.0) | dependencies node-shared `^4.1.0`, undici `^8.12.2`; peers Effect `^4.1.0`, Redis `>=5 <7`; Node `>=22.19.0`; no optional-peer metadata |
| [`@effect/platform-node-shared@4.1.0`](https://registry.npmjs.org/@effect%2fplatform-node-shared/4.1.0) | dependencies ws `^8.22.0`, @types/ws `^8.18.2`; Effect peer `^4.1.0`; Node `>=22.19.0` |
| [`undici@8.12.3`](https://registry.npmjs.org/undici/8.12.3) | Satisfies `^8.12.2`; no dependencies; Node `>=22.19.0` |
| [`ws@8.22.0`](https://registry.npmjs.org/ws/8.22.0) | No required dependencies; optional peers bufferutil `^4.0.1`, utf-8-validate `>=5.0.2`; Node `>=10` |
| [`@types/ws@8.18.2`](https://registry.npmjs.org/@types%2fws/8.18.2) | @types/node `*` |
| [`@types/node@26.6.6`](https://registry.npmjs.org/@types%2fnode/26.6.6) | Already escode’s tooling pin; undici-types `~8.9.0` |
| [`undici-types@8.9.0`](https://registry.npmjs.org/undici-types/8.9.0) | No dependencies; type-only leaf |
| [`redis@6.3.1`](https://registry.npmjs.org/redis/6.3.1) | Exact dependencies @redis/client, bloom, json, search, time-series, all `6.3.1`; Node `>=20` |
| [`@redis/client@6.3.1`](https://registry.npmjs.org/@redis%2fclient/6.3.1) | No required dependencies; optional peers @node-rs/xxhash `^1.1.0`, @opentelemetry/api `>=1 <2`; Node `>=20` |
| [`@redis/bloom@6.3.1`](https://registry.npmjs.org/@redis%2fbloom/6.3.1), [`json`](https://registry.npmjs.org/@redis%2fjson/6.3.1), [`search`](https://registry.npmjs.org/@redis%2fsearch/6.3.1), [`time-series`](https://registry.npmjs.org/@redis%2ftime-series/6.3.1) | Each peers on @redis/client `^6.3.1`; Node `>=20`; no further required dependencies |

That closes the **required** runtime/type/peer graph for the recommended Node package set: all ranges intersect at the exact versions above. Optional native accelerators and telemetry peers are not required for closure; inspect the future lockfile for accidental inclusion, especially before Electron packaging. They would introduce additional packaging/ABI costs. Core’s zero dependencies do not eliminate platform or peer dependencies.

For optional browser `4.1.0`, only Effect `^4.1.0` is declared. Optional Bun `4.1.0` depends on node-shared `^4.1.0` and peers on Effect `^4.1.0`, so it inherits ws/types even without the Node adapter. [Browser metadata](https://registry.npmjs.org/@effect%2fplatform-browser/4.1.0), [Bun metadata](https://registry.npmjs.org/@effect%2fplatform-bun/4.1.0).

Testing and UI integrations are separate costs: [`@effect/vitest@4.1.0`](https://registry.npmjs.org/@effect%2fvitest/4.1.0) peers on Vitest `>=5 <6`; [`@effect/atom-react@4.1.0`](https://registry.npmjs.org/@effect%2fatom-react/4.1.0) peers on React `>=19 <20`, scheduler `>=0.25 <0.29`, Effect `^4.1.0`. escode’s React 19.3.1 meets that React range, but this does not establish scheduler/test-runner closure or justify adding either package.

Snapshot tags for core and node/node-shared/browser/bun were `latest=4.1.0`, `beta=4.0.0-beta.107`, `rc=4.0.0-rc.118`, `staging=4.1.0`. Beta adapter manifests allow Node 18 while depending on newer Undici: another reason not to use a top-level engine or a tag as the whole compatibility proof. Never combine `effect@3` with a v4 adapter, or install a standalone v3 RPC package to satisfy a v4 import.

## Actual APIs and inspected tests

### Contracts and independent upgrades

At the pin, `Schema.decodeUnknownEffect(schema)` produces an effectful decoder; `Schema.encodeEffect(schema)` encodes, and `Schema.Struct`, brands and refinements express boundary data. RPC declarations use `Rpc.make`, `RpcGroup.make`, group `toLayer`, and `RpcClient.make`; `stream: true` selects streaming success. The generated client is schema-driven; a TypeScript type assertion is not validation. The [Node RPC test][node-rpc-test] deliberately uses different server/client payload schemas, missing method tags and different serializations; it asserts that an invalid request fails without making the client unusable.

Use stable `effect/Schema` for shared wire contracts. APIs now live at `effect/rpc` and `effect/http`, not standalone v3 packages or beta `/unstable/` paths. [Schema source][schema], [RPC declarations][rpc], [group][group], [client][client].

Schema validation does **not** define application protocol compatibility, migrations, feature negotiation or durable request IDs. Inference: independently updated hosts/clients need an explicit handshake/version/capability policy, compatible schemas and contract fixtures for supported version pairs. Prefer JSON initially for inspectable interoperability; richer codecs and binary layout fingerprints require deliberate compatibility policy. Tests already demonstrate that mismatched schemas can fail, not that every minor release is wire-compatible. The T3 implementation independently checks its orchestration protocol before upgrade and returns HTTP 426 on incompatibility ([T3 ws source][t3-ws], around line 3280).

### Authenticated WebSockets

The actual server API is `RpcServer.layerProtocolWebsocket({ path: "/rpc" })` (lowercase “s” in Websocket). Client transport is `RpcClient.layerProtocolSocket()` plus `Socket.layerWebSocket(url)` and a `WebSocketConstructor`; provide matching `RpcSerialization.layerJson`. Node can use `NodeSocket.layerWebSocket`; the [upstream Node test][node-rpc-test] wires this exact path and runs WebSocket e2e suites for JSON, NDJSON, JSON-RPC and SchemaBinary. These are inspected upstream tests, not a live escode run.

RPC middleware wraps effects with access to client, request ID, RPC, payload and headers; `RpcMiddleware.Service` declares its provided services/error schema. `RpcClient.withHeaders` adds RPC message headers. **RPC headers are not HTTP upgrade authentication headers.** [Middleware][middleware], [client][client].

At 4.1.0, Socket’s constructor accepts protocols or options including handshake headers. `layerWebSocketConstructorGlobal` explicitly rejects options objects with headers; `makeWebSocket` documents Node/Bun constructors for headers. Browser WebSocket has URL and protocols, not arbitrary authorization-header input ([Socket source][socket], lines 811–913; [WebSocket standard](https://websockets.spec.whatwg.org/#the-websocket-interface)). Inference: a browser/phone web client cannot simply copy Node’s bearer-header handshake. Pairing/credentials, secure transport, cookie/ticket/subprotocol choice, Origin enforcement, revocation and per-method authorization remain escode policy. Framework transport and middleware are mechanisms, not an authenticated remote product.

The pinned T3 code performs `authenticateWebSocketUpgrade(request, "rpc")` **before** constructing its RPC handler, then supplies a scope-authorization layer. It also wraps the transport for terminal output windows. Reusing just RPC plumbing omits these application protections. [T3 ws][t3-ws], [authorization][t3-auth], [authorization tests][t3-auth-test]. No claim that copying the full T3 auth architecture is appropriate for escode is made here.

### Streams, bounds and cancellation

`Stream` is pull-based and supplies explicit buffer controls. RPC client streaming calls accept `streamBufferSize`, default **16**; implementation builds a bounded queue. The server uses acknowledgement latches between chunks when the protocol supports acknowledgements. This limits a particular path, not all provider/event/socket memory. Server request concurrency defaults to **unbounded**; choose explicit limits where appropriate. [Stream][stream], [client][client] around lines 346–491, [server][server] around lines 138 and 454–510.

The [RPC client tests][client-test] inspectably assert: interruption unblocks a receiver parked behind a full stream buffer and sends `Interrupt`; malformed chunks interrupt their server request; late replies after terminal failure are ignored; missed pong fails in-flight streams; failed sends release routing. The full-buffer test uses `streamBufferSize: 1`, sends three values, verifies the receiver is blocked, interrupts the reader, and verifies it exits and emits `Interrupt`. These are concrete cancellation/backpressure assertions, stronger than API-name inference.

There is no end-to-end byte-memory guarantee: a value can be very large, an upstream producer can enqueue elsewhere, and the WebSocket implementation/OS has its own buffers. Set limits for frames/decoded values, queue capacity, outstanding commands and concurrent streams, plus slow-consumer/drop/disconnect policy and snapshot recovery. Do not buffer a long-lived stream with `runCollect`. [Serialization tests][serialization-test] explicitly cover NDJSON incomplete-frame `maxBufferSize`, including an unbounded option; parser limits must be configured and tested for the chosen serialization rather than assumed.

Interruption is cooperative Effect cancellation, not proof that a remote provider accepted Stop or that a subprocess tree has exited. The [server][server] consumes transport disconnects and interrupts that client’s in-flight requests; its documentation states this explicitly around line 633. Therefore **do not make a provider turn’s lifetime equal to a WebSocket subscription handler** if it must survive disconnect. Host-owned session state/resources should be controlled by short commands and observed through replaceable subscriptions. That is an architectural implication for later design, not a lifecycle amendment in this research.

Reconnection is not replay safety. `makeProtocolSocket` exposes ping/retry policy, `retryTransientErrors`, `onTransientError`, `onPingTimeout`, and connection hooks. T3 explicitly disables transport reopen/retry in its session and manages connection state itself. Preserve escode’s uncertain-send identity and reconnect-without-resend: never infer exactly-once execution or automatic safe command retry from RPC acknowledgements. [Client source][client], [T3 session][t3-session].

### Resource scopes, Layers and Node

`Effect.acquireRelease` registers cleanup, `Effect.scoped` closes a scope, `Effect.forkScoped` ties a fiber to the scope; `Layer` builds service graphs and shares resources through its memoization rules. Scope is a runtime resource lifetime, not durable persistence. Layer reuse is not global singleton magic: build scope and layer identity matter. [Effect][effect], [Scope][scope], [Layer][layer].

Inspected [Scope tests][scope-test] cover interrupted close and throwing finalizers. [Layer tests][layer-test] cover shared-build interruption, finalizers, memoization by identity and `launch` remaining alive until interruption then finalizing. These support using scoped host resources for provider processes/watchers/sockets, while leaving escode responsible for correct ownership, shutdown ordering, process-group termination and interrupted-operation persistence. Process death cannot run finalizers; existing recovery journals remain necessary.

`NodeServices.layer` supplies child-process spawning, filesystem, path, stdio and terminal services. It does not provide every HTTP/socket/crypto service. `NodeRuntime.runMain` is a process runner with signal handling and teardown. Inference: do not casually install its process-exit behavior into Electron’s main process; integrate a managed scope with Electron’s existing quit path, or use the runner in a future independently owned host process. Existing Stop-and-Close behavior remains authoritative. [NodeServices][node-services], [NodeRuntime][node-runtime].

## Runtime compatibility

| Execution environment | Evidence and compatibility conclusion | Remaining boundary |
| --- | --- | --- |
| Electron main, 45.1.0 | Official release feed gives embedded **Node 24.22.1**, Chromium 156.0.8078.49; meets Node/Undici `>=22.19.0` and Redis `>=20` | Engine-compatible, not tested with Effect here; packaging and quit integration still need proof |
| Local build/test shell | Observed `node -v = v26.13.0`, `bun --version = 1.4.4`; repo pins Bun 1.4.4 and TS 7.0.2; strict enabled | Shell Node and @types/node 26 do not certify Electron’s Node 24 API availability |
| Electron renderer | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; browser contracts/core/socket path is suitable | Never bundle Node filesystem/process/platform services into the renderer; verify esbuild/Vite boundaries |
| Standalone Node host | Selected Node adapter requires `>=22.19.0`; proposed Electron Node 24 or existing Node 26 clears metadata | Choose a maintained actual release at implementation time; engine floor is not a lifecycle/support guarantee |
| Bun host | Separate 4.1.0 adapter exists; Bun is not the current Electron host runtime | No explicit minimum Bun version in inspected adapter manifest; 1.4.4 host compatibility remains unmeasured |
| Desktop/mobile browser | Core + browser WebSocket path; optional browser adapter has only Effect peer | TLS/Origin/auth, mobile background suspension, memory and bundling need tests; no server Node APIs |
| React Native/Expo phone | RN documents global WebSocket; T3 has an actual mobile package consuming Effect | Not a Node runtime or proof of full browser-platform compatibility; Hermes/polyfills/Metro/auth/background behavior require a device experiment |

Sources: [Electron official releases JSON](https://releases.electronjs.org/releases.json) (record `45.1.0`, released 2026-10-27), [escode root package][escode-package], [desktop package][escode-desktop], [tsconfig][escode-tsconfig], [host bundler][escode-build], [BrowserWindow configuration][escode-main], [RN WebSocket](https://reactnative.dev/docs/global-WebSocket), [T3 mobile package][t3-mobile]. RN page last updated 2026-10-27; it describes the global and marks its documentation work in progress, not Effect support certification.

escode’s host build bundles to CommonJS using esbuild with only Electron external. Published Effect packages use ESM exports. Inference: bundling may bridge that difference, but inspect actual bundled imports and packaging before claiming compatibility, especially optional peers/native packages. Do not replace the host build or existing file-operation helper as part of package research.

## The pinned T3 reference

Read the actual [workspace catalog][t3-catalog], [root manifest][t3-package] and [pnpm lock][t3-lock], not the vendored `.repos/effect-smol` reference or a beta-era README. At this pin:

- Catalog: Effect, platform-node, node-shared, atom-react, vitest, SQL pg/sqlite-do, GraphQL/OpenAPI generators all **4.0.5**. Server/contracts/client runtime manifests use `catalog:`; mobile also consumes Effect/atom-react. Root tooling is **pnpm 12.14.0**, Node **26.12.1**.
- Lock: Effect 4.0.5 has no dependencies; platform-node 4.0.5 resolves with Redis **6.2.1**, node-shared 4.0.5, Undici **8.11.2**, ws **8.22.0** and optional accelerators bufferutil **4.1.0** / utf-8-validate **6.0.6**. Catalog overrides narrow peer resolution; the registry platform peer is `^4.0.5` while lock peer metadata is rewritten to 4.0.5. This is a workspace-resolved set, not an unmodified npm recipe.
- Its adapter top-level engine says Node 18+, but the locked Undici says **>=22.19.0**. Its Node 26 tooling satisfies the stricter floor. This concretely demonstrates why peer/transitive inspection matters.
- Catalog patches `@effect/vitest@4.0.5`; an override removes its direct `vitest` edge, and the patch routes imports to vite-plus/test. It also overrides Undici. Copying T3 testing code without the patch context does not establish escode runner compatibility.
- Current imports are `effect/rpc` and `effect/socket`; session code builds `RpcClient.makeProtocolSocket`, `RpcClient.ConnectionHooks`, JSON serialization, an explicit socket constructor and a session scope. Server uses `makeProtocolWithHttpEffectWebsocket` and `RpcServer.make`; authorization and orchestration version checks live outside the transport. [Session][t3-session], [server][t3-ws], [contracts][t3-contracts].

Recommendation: use 4.1.0 source/API as the target, port any selected 4.0.5 modules together with their direct contracts/services/tests, and compare each unstable API. Do not infer copy-ready compatibility from a shared major number. Retaining the entire T3 4.0.5 set is a coherent alternative for a reuse experiment, but would start escode behind the current supported release and still require a reviewed upgrade. This ticket supplies facts; reuse module boundaries belong to the remaining architecture work.

A concrete porting break is already visible: the [4.1.0 release notes](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.0) replace `effect/Crypto` with family-specific `effect/crypto/*` services and remove automatic crypto provision from runtime service bundles. T3’s pinned [provider adapter](https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/packages/provider-opencode/src/server/v2/adapter.ts) imports `effect/Crypto` and requests `Crypto.Crypto`. Those modules require a port; unchanged 4.0.5 source cannot be assumed to compile against 4.1.0. This is observed release/source evidence, not merely a hypothetical unstable-API risk.

## Isolated experiments still required

These are bounded checks for subsequent work, not hidden dependencies on unanswered engineering research. No packages need installing to accept this report as evidence.

1. **Freeze and build:** in an isolated checkout, resolve the proposed exact graph with Bun 1.4.4, inspect peers/optional packages and one Effect version, compile strict TS 7, then bundle/package with the existing CommonJS host build. Run an Electron 45.1.0 probe recording `process.versions`; exercise Node HTTP, ws and shutdown. Verify no Node modules leak into the sandboxed renderer. This establishes installer/bundler/runtime compatibility absent from source inspection.
2. **Real local contract path:** command plus bounded stream over authenticated local WebSocket, with a non-chat directory listing/watch and a controlled provider session. Reject malformed/oversize payloads, unknown tags, invalid credentials/origins; ensure permission/Stop targeting and original directory identity remain intact. No LAN exposure is necessary.
3. **Lifetime/failure:** disconnect a subscriber during a turn, interrupt only that subscription, reconnect to the same session without resend, stop while its directory is unavailable, then quit with existing Stop-and-Close. Kill/restart host separately to verify journals and uncertain sends. Demonstrate no orphan processes/watchers or cross-chat cancellation; Effect finalizers alone cannot certify this.
4. **Bounds:** stall a client while provider output and file watches flood; measure bytes, queue depth, latency and memory under configured limits; cancel while full, test malformed frames and missed pong. Verify snapshot/resubscription correctness after dropped/coalesced events, rather than assuming RPC ack bounds cover every queue.
5. **Independent updates:** fixtures pairing supported contract versions across host/client, with unknown methods, added/removed fields and serialization differences; verify explicit incompatibility handling and no command replay after an uncertain result. Initially testing identical exact versions is insufficient for an independently updated product.
6. **Phone choice:** browser phone first uses the browser restrictions above; if native is chosen, an isolated RN/Expo/Hermes device check must prove Metro exports, TextEncoder/TextDecoder/URL/WebSocket behavior, crypto services if used, auth storage, suspension/reconnect and the absence of Node imports. T3’s mobile manifest is precedent, not an escode acceptance result.

No application regression suite was run because only this evidence file changed. No glossary/ADR, issue assignment, issue resolution, map index or PR was modified. The untracked user-owned `docs/improvement-review.md` was left untouched.

[migration]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/MIGRATION.md
[readme]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/README.md
[effect]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/Effect.ts
[schema]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/Schema.ts
[stream]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/Stream.ts
[scope]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/Scope.ts
[layer]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/Layer.ts
[client]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/rpc/RpcClient.ts
[server]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/rpc/RpcServer.ts
[rpc]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/rpc/Rpc.ts
[group]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/rpc/RpcGroup.ts
[middleware]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/rpc/RpcMiddleware.ts
[socket]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/src/socket/Socket.ts
[client-test]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/test/rpc/RpcClient.test.ts
[serialization-test]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/test/rpc/RpcSerialization.test.ts
[node-rpc-test]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/platform/node/test/RpcServer.test.ts
[scope-test]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/test/Scope.test.ts
[layer-test]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/effect/test/Layer.test.ts
[node-services]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/platform/node/src/NodeServices.ts
[node-runtime]: https://github.com/Effect-TS/effect/blob/9a91b1926a5fbfaffd302a7a41a94d4d53a1154e/packages/platform/node/src/NodeRuntime.ts
[t3-catalog]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/pnpm-workspace.yaml
[t3-lock]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/pnpm-lock.yaml
[t3-package]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/package.json
[t3-mobile]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/apps/mobile/package.json
[t3-session]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/packages/client-runtime/src/rpc/session.ts
[t3-ws]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/apps/server/src/ws.ts
[t3-auth]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/apps/server/src/auth/RpcAuthorization.ts
[t3-auth-test]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/apps/server/src/auth/RpcAuthorization.test.ts
[t3-contracts]: https://github.com/pingdotgg/t3code/blob/305a90dce44b8b7813d951662f13ce8510a3c669/packages/contracts/src/rpc.ts
[escode-package]: https://github.com/ejjsharpe/escode/blob/70347aab4dec182c1f32e1ba2544c52cbba420a5/package.json
[escode-desktop]: https://github.com/ejjsharpe/escode/blob/70347aab4dec182c1f32e1ba2544c52cbba420a5/apps/desktop/package.json
[escode-tsconfig]: https://github.com/ejjsharpe/escode/blob/70347aab4dec182c1f32e1ba2544c52cbba420a5/apps/desktop/tsconfig.json
[escode-build]: https://github.com/ejjsharpe/escode/blob/70347aab4dec182c1f32e1ba2544c52cbba420a5/apps/desktop/scripts/host.mjs
[escode-main]: https://github.com/ejjsharpe/escode/blob/70347aab4dec182c1f32e1ba2544c52cbba420a5/apps/desktop/host/main.ts
