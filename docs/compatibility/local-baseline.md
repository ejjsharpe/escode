# Practical local baseline

This is the bounded before-replacement comparison requested by [Capture a practical local baseline](https://github.com/ejjsharpe/escode/issues/62), under the [approved prerelease scope amendment](https://github.com/ejjsharpe/escode/issues/61#approved-scope-amendment). It measures the current desktop application, not the proposed Effect foundation. No new product concepts or runtime behavior are introduced.

## Reproduce

From the repository root:

```sh
bun install --frozen-lockfile
bun run build
bun run package
ESCODE_BASELINE=1 bun run --cwd apps/desktop smoke -- tests/baseline.spec.ts
```

Requires the local macOS toolchain and installed authenticated Codex. The opt-in deliberately consumes one minimal provider turn per mode (two total), asking for `BASELINE_OK` without tools or file changes. Ordinary smoke runs skip this diagnostic. Do not set the opt-in for a full smoke run unless these turns are intended.

The fixture creates a disposable Git repository with 100 UTF-8 files in ten folders and a single commit using command-local test identity. Each mode has separate temporary Electron user data and repository. Nothing opens or edits user projects, existing worktrees or old escode stores. The existing provider credentials are used; Codex owns the resulting saved history, which is retained rather than deleted. Temporary repositories and app stores are removed after each run, including failure.

Development launches Electron against an ephemeral Vite server; packaged launches the built app with `/usr/bin:/bin` PATH through the existing desktop fixture. The Vite server is already listening when startup measurement begins; neither build, packaging nor server startup is timed. Each mode starts with fresh app data, then restarts using that same data to measure a restored saved chat. This is not an OS-cache-cold measurement.

Steps in `apps/desktop/tests/baseline.spec.ts`:

1. Launch to visible Open project, then sample process memory.
2. Open the repository to visible root listing; expand folder-0 and await its existing file.
3. Create an external file in that loaded folder; await its visible row without Refresh.
4. Modify a tracked file, select Source Control, await its status entry, then select and await its rendered diff. Modify it again and await the visible selected-diff refresh.
5. Create a current-checkout chat to Draft. Send the fixed prompt; await assistant text separately from Ready. The text check targets the Codex article so the echoed prompt cannot satisfy it.
6. Retry/reload history to Ready with exactly one user and assistant message; sample memory. Exit the diagnostic process and relaunch to the saved conversation and Ready; sample memory again. Finally verify Git lists only the expected changed and untracked fixture paths.

The raw JSON is written under `apps/desktop/test-results/baseline-*/baseline.json`, including incomplete runs. Preserve it outside test-results before another Playwright invocation clears that directory. `observations` uses monotonic wall-clock milliseconds around the stated action and Playwright's visible-state assertion. `memory` retains Electron `app.getAppMetrics()` records per PID/type: workingSetSize and peakWorkingSetSize are KiB. These are point-in-time process working sets, not forced-GC JS heap or a summed unique physical footprint. GPU/utility/renderer processes are included; external Codex processes and the Vite/test runner are excluded.

## Recorded installation and results

Recorded on 2026-10-30: MacBookPro18,3, Apple M1 Pro (10 cores: 8 performance, 2 efficiency), 16 GiB RAM; macOS 26.3.1 (25D2128). Both modes report Electron 45.1.0, embedded Node 24.22.1 and Chromium 156.0.8078.49. Bun 1.4.4, Apple Git 2.50.1 and installed authenticated Codex 0.165.0. Tool discovery reports model `gpt-6.1-sol`, effort `xhigh`; the installed provider configuration is used without modification.

Application sources/build: `6f06813638920eb4bbd110d9e4aac87e4d0dd2b1`, desktop 0.1.0, built and packaged locally with the frozen lockfile (unsigned macOS arm64 directory package). The raw `source` field is the then-current diagnostic checkpoint `e83a757`; subsequent changes only correct the diagnostic and add evidence. Application host/renderer sources are unchanged from the application build. Development uses Vite serving source; packaged uses the production bundle.

Both corrected runs passed. Raw per-process memory and unrounded elapsed observations: [development](baseline/development.json), [packaged](baseline/packaged.json). Timings below are single observations in milliseconds, development / packaged respectively:

- fresh launch to Open project visible (server already listening): 1741 / 618 ms.
- open project to root listing visible: 345 / 243 ms.
- external create to loaded directory row visible: 188 / 188 ms.
- external edit and Source Control selection to status visible: 2335 / 2322 ms.
- select changed file to diff visible: 186 / 155 ms.
- external edit to selected diff refreshed: 1940 / 1821 ms.
- new chat to Draft visible: 170 / 166 ms.
- Send to assistant text visible: 5440 / 4958 ms.
- Send to Ready: 5442 / 4960 ms.
- Retry to Ready with one conversation turn: 1313 / 807 ms.
- restored launch to saved chat Ready: 1939 / 1894 ms.

Each memory snapshot contains four Electron processes. Development Browser working set was 170.3 MiB at fresh idle; inspect the raw per-type samples for the remaining checkpoints. These snapshots include shared memory and must not be read as unique physical usage. No post-GC or provider-process measurement was made.

Execution history: the initial combined invocation timed out at 240 seconds in development and hit a 45-second worker teardown timeout; its packaged case was interrupted after 22.6 seconds to stop the run, also hitting teardown timeout. That harness wrote raw JSON only after cleanup and therefore lost its partial samples; no usable timing or memory evidence is claimed for those attempts. The diagnostic now writes observations before teardown, logs each completed step, explicitly exits Electron before restored launch, and waits for the asynchronous Retry action to finish before recording reconnect. The separately rerun corrected development and packaged cases passed in 17.8 and 15.0 seconds. Four live Send attempts were made across the initial invocation and the two reruns; each successful rerun completed one short reply. Saved provider history was retained. No live provider checks beyond these baseline prompts were intentionally run; unit tests used their default non-live settings.

Validation: frozen dependency installation, typecheck, lint, full unit suite, build and package passed. The two focused opt-in smoke cases passed after the harness corrections; the full desktop smoke suite was not run. This issue adds no application logic, so no application TDD seam was introduced. Separate standards and specification reviews both identified the same reconnect measurement flaw, corrected by awaiting the enabled Retry action before Ready/history assertions; neither found scope creep or documented-standard violations.


## Sampling limits

One fresh-state and one restored launch per mode, one small repository and one short conversation per mode. No percentiles, variance estimates, improvement percentages, production capacity budgets, long-history or sustained-load claims follow from these samples. UI assertion polling, automation round trips, provider/network latency, OS caches and other machine activity affect elapsed time. Assistant text timing is a visible-text observation, not first-token instrumentation; the short reply can arrive in a single update. Status timing combines switching into Source Control with initial scanning; the selected-diff refresh includes the existing two-second polling fallback. Memory snapshots cannot establish a leak or cleanup trend.

The deferred full capacity/compatibility matrices, stalled clients, disk failure, multi-client/revocation qualification, manual VoiceOver and native integration checks are not performed by this baseline. Future replacements should rerun the same diagnostic on the same hardware and fixture and inspect raw samples for obvious changes before choosing deeper investigations.
