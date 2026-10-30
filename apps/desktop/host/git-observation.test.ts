import { test, expect } from "vite-plus/test";
import { coalesceObservation } from "../../../packages/host/observation";

test("overlapping invalidations discard a delayed scan, coalesce and rebuild", async () => {
  const releases: ((value: number) => void)[] = [];
  let scans = 0;
  const observe = coalesceObservation(async () => {
    scans++;
    return new Promise<number>(resolve => releases.push(resolve));
  });
  const first = observe("checkout");
  for (let i = 0; i < 20; i++) expect(observe("checkout")).toBe(first);
  expect(scans).toBe(1);
  releases.shift()!(1);
  await new Promise(resolve => setImmediate(resolve));
  expect(scans).toBe(2);
  releases.shift()!(2);
  expect(await first).toBe(2);
  const rebuilt = observe("checkout");
  expect(scans).toBe(3);
  releases.shift()!(3);
  expect(await rebuilt).toBe(3);
});

test("failed scans release their cache and checkout observations are independent", async () => {
  const observe = coalesceObservation(async root => {
    if (root === "missing") throw Error("unavailable");
    return root;
  });
  await expect(observe("missing")).rejects.toThrow("unavailable");
  expect(await observe("other")).toBe("other");
  await expect(observe("missing")).rejects.toThrow("unavailable");
});
