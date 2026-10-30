import { test, expect } from "vite-plus/test";
import { runProbe } from "../probe/probe";

test("disposable Effect/T3 path authenticates, streams, ACKs, cancels and cleans descendants", async () => {
  const result = await runProbe(false);
  expect(result.stalledBounded).toBe(true);
  expect(result.authRejected).toBe(true);
  expect(result.acks).toBeGreaterThan(0);
  expect(result.cancelled).toBe(true);
  expect(result.schemaRejected).toBe(true);
  expect(result.unknownHandled).toBe(true);
  expect(result.descendantCleaned).toBe(true);
}, 30000);
