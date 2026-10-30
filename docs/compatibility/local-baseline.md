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
6. Retry/reload history to Ready with exactly one user and assistant message; sample memory. Quit and relaunch to the saved conversation and Ready; sample memory again. Finally verify Git lists only the expected changed and untracked fixture paths.

The raw JSON is written under `apps/desktop/test-results/baseline-*/baseline.json`, including incomplete runs. Preserve it outside test-results before another Playwright invocation clears that directory. `observations` uses monotonic wall-clock milliseconds around the stated action and Playwright's visible-state assertion. `memory` retains Electron `app.getAppMetrics()` records per PID/type: workingSetSize and peakWorkingSetSize are KiB. These are point-in-time process working sets, not forced-GC JS heap or a summed unique physical footprint. GPU/utility/renderer processes are included; external Codex processes and the Vite/test runner are excluded.

## Recorded installation and results

Pending the diagnostic run; raw evidence and observations are added below before commit.

## Sampling limits

One fresh-state and one restored launch per mode, one small repository and one short conversation per mode. No percentiles, variance estimates, improvement percentages, production capacity budgets, long-history or sustained-load claims follow from these samples. UI assertion polling, automation round trips, provider/network latency, OS caches and other machine activity affect elapsed time. Assistant text timing is a visible-text observation, not first-token instrumentation; the short reply can arrive in a single update. Status timing combines switching into Source Control with initial scanning; the selected-diff refresh includes the existing two-second polling fallback. Memory snapshots cannot establish a leak or cleanup trend.

The deferred full capacity/compatibility matrices, stalled clients, disk failure, multi-client/revocation qualification, manual VoiceOver and native integration checks are not performed by this baseline. Future replacements should rerun the same diagnostic on the same hardware and fixture and inspect raw samples for obvious changes before choosing deeper investigations.
