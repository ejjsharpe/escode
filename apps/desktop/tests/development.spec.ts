import { test, expect, _electron } from "@playwright/test";
import { createServer } from "vite-plus";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electron from "electron";
test("StyleX updates during development", async () => {
  const source = new URL("../src/main.tsx", import.meta.url);
  const original = await readFile(source, "utf8");
  const user = await mkdtemp(join(tmpdir(), "escode-development-"));
  const server = await createServer({
    server: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  await server.listen();
  const env: Record<string, string> = {
    ...process.env,
    ESCODE_DEV_URL: server.resolvedUrls!.local[0].replace(/\/$/, ""),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: electron as unknown as string,
    args: [".", `--user-data-dir=${user}`],
    env,
  });
  const childProcess = app.process();
  try {
    const page = await app.firstWindow();
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(19, 20, 22)");
    await writeFile(source, original.replace('backgroundColor: "#131416"', 'backgroundColor: "#203040"'));
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(32, 48, 64)");
  } finally {
    try {
      await writeFile(source, original);
    } finally {
      if (childProcess.exitCode === null && childProcess.signalCode === null) {
        const exited = new Promise(resolve => childProcess.once("exit", resolve));
        childProcess.kill("SIGKILL");
        await exited;
      }
      await server.close();
      await rm(user, { recursive: true, force: true });
    }
  }
});
