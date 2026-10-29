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
  try {
    const page = await app.firstWindow();
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(24, 32, 43)");
    await writeFile(source, original.replace("#18202b", "#203040"));
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(32, 48, 64)");
  } finally {
    await writeFile(source, original);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window: unknown, options?: any) => ({
        response: options.buttons[0] === "Save" ? 1 : 0,
        checkboxChecked: false,
      });
    });
    await app.close();
    await server.close();
    await rm(user, { recursive: true, force: true });
  }
});
