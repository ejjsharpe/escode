import { expect, test } from "vite-plus/test";
import { findExecutable } from "./tools";
test("missing tools give actionable guidance rather than invoking a shell", async () => {
  await expect(findExecutable("codex", [], [])).rejects.toThrow("Install Codex");
});
