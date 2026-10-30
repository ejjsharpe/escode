import { test, expect } from "vite-plus/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileOperationJournal, type Intent } from "./file-operation-journal";

const intent: Intent = {
  root: "/checkout", checkoutIdentity: "checkout", source: "a.txt",
  destination: "b.txt", kind: "move", identity: "source",
};
const owner = { hostId: "host", clientId: "client" };
async function fixture(run: (file: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "escode-journal-"));
  try { await run(join(dir, "intent.json")); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("journal preserves unowned and owned formats, including cleared records, across restart", async () => {
  await fixture(async file => {
    expect(await new FileOperationJournal(file, owner).readIntent()).toBe(null);
    for (const ownership of [undefined, owner]) {
      const journal = new FileOperationJournal(file, ownership);
      await journal.writeIntent(intent);
      const expected = ownership ? { ...intent, storageVersion: 1, ...owner } : intent;
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(expected);
      expect(await new FileOperationJournal(file, ownership).readIntent()).toEqual(expected);
      await journal.writeIntent(null);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(ownership ? { intent: null, storageVersion: 1, ...owner } : null);
      expect(await new FileOperationJournal(file, ownership).readIntent()).toBe(null);
    }
  });
});

test.each([
  { ...intent, storageVersion: 2, ...owner },
  { ...intent, storageVersion: 1, ...owner, hostId: "other" },
  { intent: null, storageVersion: 1, ...owner, clientId: "other" },
  null,
  intent,
])("owned journals reject unsupported or mismatched ownership without changing disk: %j", async value => {
  await fixture(async file => {
    const bytes = JSON.stringify(value);
    await writeFile(file, bytes);
    await expect(new FileOperationJournal(file, owner).readIntent()).rejects.toThrow("Unsupported or wrongly owned");
    expect(await readFile(file, "utf8")).toBe(bytes);
  });
});

test.each([
  { ...intent, root: "relative" },
  { ...intent, source: "../a" },
  { ...intent, destination: ".GIT/config" },
  { ...intent, completed: "yes" },
  { ...intent, kind: "copy", copies: [{ root: "/checkout", path: "outside", text: "edit", disk: { text: "disk", version: "v" } }] },
  { ...intent, kind: "save", saveText: "edit", completed: true },
  { ...intent, kind: "save", saveText: "edit", savedDisk: { text: "disk" } },
])("invalid intent is retained for inspection: %j", async value => {
  await fixture(async file => {
    const bytes = JSON.stringify({ ...value, storageVersion: 1, ...owner });
    await writeFile(file, bytes);
    await expect(new FileOperationJournal(file, owner).readIntent()).rejects.toThrow("Invalid operation journal");
    expect(await readFile(file, "utf8")).toBe(bytes);
  });
});

test("journal serializes writes and reads, and a failed write does not poison later writes", async () => {
  await fixture(async file => {
    const journal = new FileOperationJournal(file, owner);
    await mkdir(file + ".tmp");
    await expect(journal.writeIntent(intent)).rejects.toThrow();
    await rm(file + ".tmp", { recursive: true });
    const writes = Array.from({ length: 12 }, (_, i) => journal.writeIntent({ ...intent, identity: String(i) }));
    const read = journal.readIntent();
    await Promise.all(writes);
    expect((await read)?.identity).toBe("11");
    expect((await new FileOperationJournal(file, owner).readIntent())?.identity).toBe("11");
  });
});
