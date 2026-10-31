import { afterEach, expect, test, vi } from "vite-plus/test";
import { createFileActivation, type BufferState } from "../src/file-activation";
import { preserveClose } from "../src/close-preservation";
import { initialize, memory } from "../src/workspace";

const root = "/repo";
const disk = (text: string) => ({ text, version: text });
function buffer(text: string, baseline = text) {
  return { disk: disk(baseline), model: { getValue: () => text, setValue: vi.fn((value: string) => { text = value; }) } } as unknown as BufferState;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  initialize({ projects: [{ project: root, root }], selected: root, drafts: [],
    views: { [root]: { path: "a.txt", openFiles: ["a.txt"], fileViews: { "a.txt": "file" } } } });
  const project = vi.fn();
  const lifecycle = vi.fn(async (_operation: string): Promise<unknown> => undefined);
  vi.stubGlobal("window", { escode: { project, lifecycle }, dispatchEvent: vi.fn() });
  const buffers = new Map<string, BufferState>();
  const apply = vi.fn((result: { file: string; view: "file" | "conflict" | "staged" | "unstaged" | "untracked" }) => {
    memory.views[root] = { ...memory.views[root], path: result.file,
      fileViews: { ...memory.views[root].fileViews, [result.file]: result.view } };
  });
  const activation = createFileActivation({ root, buffers, apply, report: vi.fn(), addBuffer(file, baseline) {
    const value = buffer(baseline.text);
    value.disk = baseline;
    buffers.set(file, value);
    return value;
  } });
  return { project, lifecycle, buffers, apply, activation };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test("a newer comparison rejects an older normal read without creating its buffer", async () => {
  const f = fixture(), slow = deferred<ReturnType<typeof disk>>();
  f.project.mockImplementation((operation, _root, file) => operation === "diff"
    ? { original: "HEAD", modified: "disk B" } : file === "slow.txt" ? slow.promise : disk("disk B"));
  const older = f.activation.open({ file: "slow.txt" });
  expect(await f.activation.open({ file: "b.txt", view: "staged" })).toBe(true);
  slow.resolve(disk("late A"));
  expect(await older).toBe(false);
  expect(f.buffers.has("slow.txt")).toBe(false);
  expect(f.apply).toHaveBeenCalledTimes(1);
  expect(f.apply.mock.calls[0][0]).toMatchObject({ file: "b.txt", view: "staged" });
});

test.each([false, true])("conflict restoration refreshes clean buffers but preserves dirty baseline: dirty=%s", async dirty => {
  const f = fixture(), b = buffer(dirty ? "my edits" : "old disk", "old disk");
  f.buffers.set("a.txt", b);
  memory.views[root].fileViews = { "a.txt": "conflict" };
  f.project.mockResolvedValue(disk("new disk"));
  expect(await f.activation.restore("a.txt")).toBe(true);
  expect(b.disk.text).toBe(dirty ? "old disk" : "new disk");
  expect(b.model.getValue()).toBe(dirty ? "my edits" : "new disk");
  expect(f.apply.mock.calls[0][0]).toMatchObject({ conflict: dirty ? { path: "a.txt", disk: disk("new disk") } : null });
});

test("pending restoration blocks comparison refresh and cancelled scope cannot activate", async () => {
  const f = fixture(), slow = deferred<ReturnType<typeof disk>>();
  memory.views[root].fileViews = { "a.txt": "staged" };
  f.project.mockReturnValue(slow.promise);
  let current = true;
  const opening = f.activation.open({ file: "slow.txt", current: () => current });
  await f.activation.refresh();
  expect(f.project).toHaveBeenCalledTimes(1);
  current = false;
  slow.resolve(disk("late"));
  expect(await opening).toBe(false);
  expect(f.apply).not.toHaveBeenCalled();
});

test("successful lookup retains a focus checkpoint after its popup closes", async () => {
  const f = fixture();
  f.project.mockResolvedValue(disk("file"));
  let popupOpen = true;
  expect(await f.activation.open({ file: "a.txt", current: () => popupOpen })).toBe(true);
  const focusCurrent = f.activation.checkpoint();
  popupOpen = false;
  expect(focusCurrent()).toBe(true);
  f.activation.invalidate();
  expect(focusCurrent()).toBe(false);
});

test("later Cancel preserves proposed Discard and an earlier completed Save", async () => {
  const f = fixture(), a = buffer("save me", "disk a"), b = buffer("keep me", "disk b"), c = buffer("cancel me");
  c.disk = disk("disk c");
  f.lifecycle.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
  const publish = vi.fn();
  const files = [a, b, c].map((value, i) => ({ root, path: `${i}.txt`, buffer: value,
    save: async () => { value.disk = disk(value.model.getValue()); return true; } }));
  expect(await preserveClose(files, publish)).toBe(false);
  expect(a.disk.text).toBe("save me");
  expect(b.model.getValue()).toBe("keep me");
  expect(b.model.setValue).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

test.each(["persist", "finish"])("failed %s restores close publication and drafts before resetting models", async failure => {
  const f = fixture(), b = buffer("my edits", "disk");
  vi.useFakeTimers();
  memory.drafts = [{ root, path: "a.txt", text: "my edits", disk: b.disk }];
  const previous = structuredClone(memory.views[root]);
  f.lifecycle.mockImplementation(async (operation: string) => {
    if (operation === "dirty") return 1;
    if (failure === "persist" && memory.views[root].openFiles?.length === 0) {
      memory.drafts.push({ root: "/other", path: "new.txt", text: "newer", disk: disk("old") });
      throw Error("disk full");
    }
  });
  const closing = preserveClose([{ root, path: "a.txt", buffer: b, save: async () => true }],
    () => ({ view: { root, value: { openFiles: [], path: "" } } }),
    async () => { if (failure === "finish") throw Error("finish failed"); });
  const rejected = expect(closing).rejects.toThrow(failure === "persist" ? "disk full" : "finish failed");
  await vi.runAllTimersAsync();
  await rejected;
  expect(memory.views[root]).toEqual(previous);
  expect(memory.drafts).toContainEqual({ root, path: "a.txt", text: "my edits", disk: disk("disk") });
  if (failure === "persist") expect(memory.drafts.some(d => d.root === "/other")).toBe(true);
  expect(b.model.setValue).not.toHaveBeenCalled();
});


test("Discard resets a model only after its recovery deletion and lifecycle completion", async () => {
  const f = fixture(), b = buffer("my edits", "disk");
  vi.useFakeTimers();
  memory.drafts = [{ root, path: "a.txt", text: "my edits", disk: b.disk }];
  f.lifecycle.mockImplementation(async operation => operation === "dirty" ? 1 : undefined);
  const finish = vi.fn(async () => {
    expect(memory.drafts).toEqual([]);
    expect(b.model.getValue()).toBe("my edits");
  });
  const closing = preserveClose([{ root, path: "a.txt", buffer: b, save: async () => true }], () => ({}), finish);
  await vi.runAllTimersAsync();
  expect(await closing).toBe(true);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(b.model.getValue()).toBe("disk");
});
