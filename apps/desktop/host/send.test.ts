import { test, expect, vi } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("node:fs", { spy: true });
import { FoundationState } from "./foundation-state";

test("command identity survives restart, conflicts and expired admissions cannot repeat effects", () => {
  const directory = mkdtempSync(join(tmpdir(), "escode-send-"));
  try {
    let store = FoundationState.open(join(directory, "foundation"));
    const command = { commandId: "one", admissionEpoch: store.admissionEpoch, project: null,
      id: "chat", expected: "context", text: "hello" };
    store.admit(command);
    expect(() => store.admit({ ...command, text: "changed" })).toThrow("conflict");
    store.close();
    store = FoundationState.open(join(directory, "foundation"));
    expect(store.receipt("one")?.status).toBe("uncertain");
    expect(store.admit(command).status).toBe("uncertain");
    expect(() => store.admit({ ...command, commandId: "two" })).toThrow("epoch");
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test("repeated admitted, accepted and uncertain commands never repeat the dispatch effect", async () => {
  const { executeSend } = await import("./send");
  const directory = mkdtempSync(join(tmpdir(), "escode-send-effects-"));
  try {
    const store = FoundationState.open(join(directory, "foundation"));
    const command = { commandId: "one", admissionEpoch: store.admissionEpoch, project: null,
      id: "chat", expected: "context", text: "retained prompt" };
    let effects = 0;
    const dispatch = async () => { effects++; throw Error("lost provider result"); };
    expect((await executeSend(store, command, dispatch)).status).toBe("uncertain");
    expect((await executeSend(store, command, dispatch)).command.text).toBe("retained prompt");
    expect(effects).toBe(1);
    const second = { ...command, commandId: "two" };
    expect((await executeSend(store, second, async () => { effects++; })).status).toBe("accepted");
    expect((await executeSend(store, second, dispatch)).status).toBe("accepted");
    expect(effects).toBe(2);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("failure at receipt persistence boundaries never admits a second provider effect", async () => {
  const { executeSend } = await import("./send");
  const { vi } = await import("vite-plus/test");
  const fs = await import("node:fs");
  for (const boundary of [1, 2, 3]) {
    const directory = mkdtempSync(join(tmpdir(), "escode-send-fault-"));
    let effects = 0;
    try {
      const store = FoundationState.open(join(directory, "foundation"));
      const command = { commandId: "one", admissionEpoch: store.admissionEpoch, project: null,
        id: "chat", expected: "context", text: "retained" };
      const write = (await vi.importActual<typeof fs>("node:fs")).writeFileSync;
      let writes = 0;
      const spy = vi.spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof write>) => {
        if (++writes === boundary) throw Error("injected disk failure");
        return write(...args);
      });
      await expect(executeSend(store, command, async () => { effects++; })).rejects.toThrow();
      spy.mockRestore();
      expect(effects).toBe(boundary === 3 ? 1 : 0);
      await expect(executeSend(store, command, async () => { effects++; })).rejects.toThrow();
      expect(effects).toBe(boundary === 3 ? 1 : 0);
    } finally { vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }); }
  }
});

test("receipt exhaustion rejects new admission before dispatch and preserves existing status", async () => {
  const { executeSend } = await import("./send");
  const directory = mkdtempSync(join(tmpdir(), "escode-send-capacity-"));
  try {
    const store = FoundationState.open(join(directory, "foundation"));
    let effects = 0;
    let exhausted = false;
    for (let index = 0; index < 12; index++) {
      const command = { commandId: String(index), admissionEpoch: store.admissionEpoch, project: null,
        id: "chat", expected: "context", text: "x".repeat(100000) };
      try { await executeSend(store, command, async () => { effects++; }); }
      catch { exhausted = true; break; }
    }
    expect(exhausted).toBe(true);
    expect(effects).toBeGreaterThan(0);
    expect(effects).toBeLessThan(12);
    expect(store.receipt("0")?.status).toBe("accepted");
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test.each(["admitted", "dispatching", "accepted"] as const)("restart after %s never dispatches recovered work", async status => {
  const { executeSend } = await import("./send");
  const directory = mkdtempSync(join(tmpdir(), "escode-send-restart-"));
  try {
    let store = FoundationState.open(join(directory, "foundation"));
    const command = { commandId: "one", admissionEpoch: store.admissionEpoch, project: null,
      id: "chat", expected: "context", text: "retained prompt" };
    const receipt = store.admit(command);
    let effects = status === "admitted" ? 0 : 1;
    store.record({ ...receipt, status });
    store.close();
    store = FoundationState.open(join(directory, "foundation"));
    const recovered = await executeSend(store, command, async () => { effects++; });
    expect(recovered.status).toBe(status === "accepted" ? "accepted" : "uncertain");
    expect(recovered.command.text).toBe("retained prompt");
    expect(effects).toBe(status === "admitted" ? 0 : 1);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
