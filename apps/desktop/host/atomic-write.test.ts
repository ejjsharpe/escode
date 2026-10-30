import { test, expect, vi, afterEach } from "vite-plus/test";
import * as fs from "node:fs/promises";
import { atomicWriteJson } from "./atomic-write";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), open: vi.fn(), rename: vi.fn() }));
afterEach(() => vi.resetAllMocks());

test.each(["success", "file sync", "directory sync"])("atomic JSON write preserves durability order and propagates %s", async failure => {
  const events: string[] = [];
  const step = (name: string) => vi.fn(async () => {
    events.push(name);
    if (name === failure) throw Error(name);
  });
  const file = { writeFile: step("write"), sync: step("file sync"), close: step("file close") };
  const directory = { sync: step("directory sync"), close: step("directory close") };
  vi.mocked(fs.mkdir).mockImplementation(step("mkdir") as any);
  vi.mocked(fs.open).mockResolvedValueOnce(file as any).mockResolvedValueOnce(directory as any);
  vi.mocked(fs.rename).mockImplementation(step("rename"));
  const task = atomicWriteJson("/store/state.json", () => { events.push("encode"); return { value: 1 }; });
  if (failure === "success") await task;
  else await expect(task).rejects.toThrow(failure);
  expect(events).toEqual(failure === "file sync"
    ? ["mkdir", "encode", "write", "file sync", "file close"]
    : ["mkdir", "encode", "write", "file sync", "file close", "rename", "directory sync", "directory close"]);
  expect(fs.mkdir).toHaveBeenCalledWith("/store", { recursive: true, mode: 0o700 });
  expect(fs.open).toHaveBeenNthCalledWith(1, "/store/state.json.tmp", "w", 0o600);
  expect(file.writeFile).toHaveBeenCalledWith('{"value":1}');
  if (failure === "file sync") expect(fs.rename).not.toHaveBeenCalled();
  else {
    expect(fs.rename).toHaveBeenCalledWith("/store/state.json.tmp", "/store/state.json");
    expect(fs.open).toHaveBeenNthCalledWith(2, "/store", "r");
  }
});
