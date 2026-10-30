import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import electron from "electron";
const execute = promisify(execFile);

test("Effect/T3 disposable probe runs in Electron CJS with restricted packaged PATH", async () => {
  test.setTimeout(180000);
  const packaged = process.env.ESCODE_PACKAGED === "1";
  const binary = packaged ? resolve("release/mac-arm64/escode.app/Contents/MacOS/escode") : electron as unknown as string;
  const script = packaged
    ? resolve("release/mac-arm64/escode.app/Contents/Resources/app.asar/dist/host/foundation-probe.cjs")
    : resolve("dist/host/foundation-probe.cjs");
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", PATH: packaged ? "/usr/bin:/bin" : process.env.PATH };
  const { stdout } = await execute(binary, [script], { env, timeout: 150000 });
  const result = JSON.parse(stdout.trim());
  expect(result.authRejected && result.stalledBounded && result.cancelled && result.descendantCleaned && result.schemaRejected && result.unknownHandled).toBe(true);
  expect(result.acks).toBeGreaterThan(0);
  console.log("Effect probe", packaged ? "packaged" : "development", stdout.trim());
  if (process.env.ESCODE_LIVE_CHAT === "1") {
    const { stdout } = await execute(binary, [script, "--live"], { env, timeout: 150000 });
    const live = JSON.parse(stdout.trim());
    expect(live.text).toContain("ESCODE_EFFECT_OK");
    expect(live.acks).toBeGreaterThan(0);
    console.log("Live Effect probe", packaged ? "packaged" : "development", stdout.trim());
  }
});
