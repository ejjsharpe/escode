import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchDesktop } from "./desktop";

test("desktop publishes its window only after durable identities and retains them on relaunch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "escode-foundation-desktop-"));
  try {
    const user = join(directory, "user");
    let original = "";
    for (let startup = 0; startup < 2; startup++) {
      const app = await launchDesktop(user);
      try {
        const window = await app.firstWindow();
        await expect(window.getByRole("button", { name: "Open project…" })).toBeVisible();
        const bytes = await readFile(join(user, "foundation/state.json"), "utf8");
        const state = JSON.parse(bytes);
        expect(state.version).toBe(1);
        expect(state.hostId).toMatch(/^[0-9a-f-]{36}$/);
        expect(state.clientId).toMatch(/^[0-9a-f-]{36}$/);
        if (startup) expect(bytes).toBe(original);
        original = bytes;
      } finally {
        await app.close();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
