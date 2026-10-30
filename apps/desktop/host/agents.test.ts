import { test, expect } from "vite-plus/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Chats } from "./chat";
import { compareChats } from "../src/chat-order";

test("legacy append order survives persistence without invented creation dates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "escode-order-"));
  try {
    const file = join(dir, "chats.json");
    const legacy = ["old", "recent"].map((id) => ({
      id,
      project: dir,
      checkout: dir,
      threadId: `thread-${id}`,
      draft: id,
    }));
    await writeFile(file, JSON.stringify({ version: 1, chats: legacy }));
    const store = new Chats(file);
    await store.draft(dir, "old", "retained text");
    const fresh = await store.create(dir);
    const restored = await new Chats(file).all();
    expect([...restored].sort(compareChats).map((c) => c.id)).toEqual([fresh.id, "recent", "old"]);
    expect(restored[0]).toEqual({ ...legacy[0], draft: "retained text", legacyOrder: 0 });
    expect(restored[1].createdAt).toBeUndefined();
    expect(
      [
        { ...fresh, id: "b" },
        { ...fresh, id: "a" },
      ]
        .sort(compareChats)
        .map((c) => c.id),
    ).toEqual(["a", "b"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
