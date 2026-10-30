import { test, expect, vi } from "vite-plus/test";
import * as fs from "node:fs";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FoundationState } from "./foundation-state";
vi.mock("node:fs", { spy: true });

test("fresh identities and exact owned records survive a second startup without touching legacy or external bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "escode-foundation-"));
  try {
    const legacy = join(directory, "chats.json");
    const external = join(directory, "project.txt");
    writeFileSync(legacy, "legacy bytes");
    writeFileSync(external, "project bytes");
    const store = FoundationState.open(join(directory, "foundation"));
    const identity = store.read();
    store.put({
      id: "chat-1",
      hostId: identity.hostId,
      clientId: identity.clientId,
      path: "/exact/é/../checkout",
      filesystemIdentity: { dev: "16777234", ino: "9007199254740993" },
      providerId: "codex/thread-1",
      ownership: "external",
    });
    const saved = store.read();
    store.close();
    const restarted = FoundationState.open(join(directory, "foundation"));
    expect(restarted.read()).toEqual(saved);
    restarted.close();
    expect(readFileSync(legacy, "utf8")).toBe("legacy bytes");
    expect(readFileSync(external, "utf8")).toBe("project bytes");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("incomplete initialization, writes, unsupported versions and unreadable records never replace identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "escode-foundation-failures-"));
  try {
    const root = join(directory, "foundation");
    const store = FoundationState.open(root);
    const identity = store.read();
    expect(() => FoundationState.open(root)).toThrow();
    store.close();
    const file = join(root, "state.json");
    const original = readFileSync(file);
    chmodSync(file, 0);
    try {
      expect(() => FoundationState.open(root)).toThrow();
    } finally {
      chmodSync(file, 0o600);
    }
    for (const bytes of [
      "{",
      JSON.stringify({ ...identity, version: 2 }),
      JSON.stringify({ ...identity, hostId: "wrong" }),
      JSON.stringify({ ...identity, hostId: [identity.hostId], clientId: [identity.clientId] }),
    ]) {
      writeFileSync(file, bytes);
      expect(() => FoundationState.open(root)).toThrow();
      expect(readFileSync(file, "utf8")).toBe(bytes);
    }
    writeFileSync(file, original);
    writeFileSync(join(root, "state.json.tmp"), "partial write");
    expect(() => FoundationState.open(root)).toThrow();
    expect(readFileSync(file)).toEqual(original);
    rmSync(join(root, "state.json.tmp"));
    rmSync(file);
    expect(() => FoundationState.open(root)).toThrow();
    expect(() => FoundationState.open(root)).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed persistence blocks subsequent effects, preserves previous bytes and leaves interruption evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "escode-foundation-write-"));
  try {
    const store = FoundationState.open(directory + "/foundation");
    const identity = store.read();
    const file = join(directory, "foundation/state.json");
    const original = readFileSync(file);
    const record = {
      id: "chat",
      hostId: identity.hostId,
      clientId: identity.clientId,
      path: "/checkout",
      filesystemIdentity: { dev: "1", ino: "2" },
      providerId: null,
      ownership: "external" as const,
    };
    expect(() => store.put({ ...record, hostId: "other" })).toThrow();
    expect(() => store.put({ ...record, providerId: "x".repeat(1024 * 1024) })).toThrow("limit");
    expect(store.read()).toEqual(identity);
    writeFileSync(join(directory, "foundation/state.json.tmp"), "interrupted");
    expect(() => store.put(record)).toThrow();
    expect(() => store.put(record)).toThrow("unavailable");
    expect(readFileSync(file)).toEqual(original);
    store.close();
    expect(() => FoundationState.open(join(directory, "foundation"))).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("disk failure after temporary-file creation retains identity and blocks restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "escode-foundation-disk-"));
  try {
    const root = join(directory, "foundation");
    const store = FoundationState.open(root);
    const state = store.read();
    const before = readFileSync(join(root, "state.json"));
    const fault = vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
      throw Object.assign(Error("disk full"), { code: "ENOSPC" });
    });
    try {
      expect(() =>
        store.put({
          id: "chat",
          hostId: state.hostId,
          clientId: state.clientId,
          path: "/exact/path",
          filesystemIdentity: { dev: "1", ino: "2" },
          providerId: "thread",
          ownership: "scratch",
        }),
      ).toThrow("disk full");
    } finally {
      fault.mockRestore();
    }
    expect(readFileSync(join(root, "state.json"))).toEqual(before);
    expect(() => store.read()).toThrow("unavailable");
    store.close();
    expect(() => FoundationState.open(root)).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing, unreadable, linked and ambiguous stores are not initialized afresh", () => {
  const directory = mkdtempSync(join(tmpdir(), "escode-foundation-access-"));
  try {
    const root = join(directory, "foundation");
    mkdirSync(root);
    expect(() => FoundationState.open(root)).toThrow();
    mkdirSync(join(root, "state.json"));
    expect(() => FoundationState.open(root)).toThrow();
    rmSync(join(root, "state.json"), { recursive: true });
    const external = join(directory, "external.json");
    writeFileSync(external, "untouched");
    symlinkSync(external, join(root, "state.json"));
    expect(() => FoundationState.open(root)).toThrow();
    expect(readFileSync(external, "utf8")).toBe("untouched");
    rmSync(join(root, "state.json"));
    writeFileSync(join(root, "owner.lock"), "interrupted owner");
    expect(() => FoundationState.open(root)).toThrow();
    expect(readFileSync(join(root, "owner.lock"), "utf8")).toBe("interrupted owner");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each([1, 2, 3])(
  "sync failure at publication step %i retains blocking recovery evidence",
  async (step) => {
    const actual = await vi.importActual<typeof fs>("node:fs");
    const directory = mkdtempSync(join(tmpdir(), "escode-foundation-sync-"));
    try {
      const root = join(directory, "foundation");
      const store = FoundationState.open(root);
      const state = store.read();
      let calls = 0;
      const fault = vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
        if (++calls === step) throw Error("sync failed");
        actual.fsyncSync(fd);
      });
      try {
        expect(() =>
          store.put({
            id: "chat",
            hostId: state.hostId,
            clientId: state.clientId,
            path: "/exact/path",
            filesystemIdentity: { dev: "1", ino: "2" },
            providerId: "thread",
            ownership: "scratch",
          }),
        ).toThrow("sync failed");
      } finally {
        fault.mockRestore();
      }
      expect(JSON.parse(readFileSync(join(root, "state.json"), "utf8")).hostId).toBe(state.hostId);
      store.close();
      expect(() => FoundationState.open(root)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test.each([3, 4, 5])(
  "initialization sync failure at step %i blocks identity replacement",
  async (step) => {
    const actual = await vi.importActual<typeof fs>("node:fs");
    const directory = mkdtempSync(join(tmpdir(), "escode-foundation-init-"));
    try {
      const root = join(directory, "foundation");
      let calls = 0;
      const fault = vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
        if (++calls === step) throw Error("initialization sync failed");
        actual.fsyncSync(fd);
      });
      try {
        expect(() => FoundationState.open(root)).toThrow("initialization sync failed");
      } finally {
        fault.mockRestore();
      }
      expect(() => FoundationState.open(root)).toThrow();
      expect(readFileSync(join(root, "owner.lock"), "utf8")).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("creation receipts recover lost results without repeating effects and retain crash uncertainty", () => {
  const directory = mkdtempSync(join(tmpdir(), "escode-create-receipt-"));
  const root = join(directory, "foundation");
  let store = FoundationState.open(root);
  const command = { commandId: "create", admissionEpoch: store.admissionEpoch, root: directory, parent: "", name: "new.txt", kind: "file" as const };
  let effects = 0;
  try {
    const effect = () => { effects++; writeFileSync(join(directory, "new.txt"), "", { flag: "wx" }); return "new.txt"; };
    expect(store.create(command, effect).status).toBe("accepted");
    expect(store.create(command, effect).path).toBe("new.txt");
    expect(effects).toBe(1);
    expect(() => store.create({ ...command, name: "other" }, effect)).toThrow("identity conflict");
    store.close();
    store = FoundationState.open(root);
    expect(store.create(command, effect).status).toBe("accepted");
    expect(effects).toBe(1);
    const lost = { ...command, commandId: "lost-native", admissionEpoch: store.admissionEpoch };
    expect(store.create(lost, () => { throw Error("lost native result"); }).status).toBe("uncertain");
    expect(store.create(lost, effect).status).toBe("uncertain");
    expect(effects).toBe(1);
    store.close();
    const state = JSON.parse(readFileSync(join(root, "state.json"), "utf8"));
    state.creates[0].status = "dispatching";
    writeFileSync(join(root, "state.json"), JSON.stringify(state));
    store = FoundationState.open(root);
    expect(store.create(command, effect).status).toBe("uncertain");
    expect(effects).toBe(1);
    expect(() => store.create({ ...command, commandId: "expired" }, effect)).toThrow("Expired creation epoch");
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("creation rejects exhausted receipt storage before effects", () => {
  const directory = mkdtempSync(join(tmpdir(), "escode-create-limit-"));
  const root = join(directory, "foundation");
  let store = FoundationState.open(root);
  try {
    store.close();
    const state = JSON.parse(readFileSync(join(root, "state.json"), "utf8"));
    state.creates = Array.from({ length: 1000 }, (_, i) => ({ command: { commandId: String(i), admissionEpoch: "old", root: directory, parent: "", name: "file", kind: "file" }, status: "uncertain", path: "", message: "" }));
    writeFileSync(join(root, "state.json"), JSON.stringify(state));
    store = FoundationState.open(root);
    const effect = vi.fn(() => "file");
    expect(() => store.create({ ...state.creates[0].command, commandId: "new", admissionEpoch: store.admissionEpoch }, effect)).toThrow("capacity exhausted");
    expect(effect).not.toHaveBeenCalled();
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
