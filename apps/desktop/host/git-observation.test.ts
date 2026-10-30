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
  const next = observe("checkout");
  for (let i = 0; i < 20; i++) expect(observe("checkout")).toBe(next);
  await new Promise(resolve => setImmediate(resolve));
  expect(scans).toBe(1);
  releases.shift()!(1);
  expect(await first).toBe(1);
  await new Promise(resolve => setImmediate(resolve));
  expect(scans).toBe(2);
  const third = observe("checkout");
  releases.shift()!(2);
  expect(await next).toBe(2);
  await new Promise(resolve => setImmediate(resolve));
  releases.shift()!(3);
  expect(await third).toBe(3);
  const rebuilt = observe("checkout");
  await new Promise(resolve => setImmediate(resolve));
  expect(scans).toBe(4);
  releases.shift()!(4);
  expect(await rebuilt).toBe(4);
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
