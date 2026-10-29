import { test, expect, _electron } from "@playwright/test";
import { createServer } from "vite-plus";
import { readFile, writeFile } from "node:fs/promises";
import electron from "electron";
test("StyleX updates during development", async () => {
  const source = new URL("../src/main.tsx", import.meta.url);
  const original = await readFile(source, "utf8");
  const server = await createServer({
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  });
  await server.listen();
  const env = { ...process.env, ESCODE_DEV_URL: "http://127.0.0.1:5173" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: electron as unknown as string,
    args: ["."],
    env,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(24, 32, 43)");
    await writeFile(source, original.replace("#18202b", "#203040"));
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(32, 48, 64)");
  } finally {
    await writeFile(source, original);
    await app.close();
    await server.close();
  }
});
