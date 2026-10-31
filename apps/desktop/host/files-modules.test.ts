import { Schema } from "effect";
import { WorkspaceState } from "@escode/contracts";
import { reconcile } from "./file-operation-state";
import { test, expect, vi } from "vite-plus/test";
import { FilesModel, type Listing } from "../src/files-model";
import { FilesViewport } from "../src/files-viewport";

function fixture() {
  const requests: { path: string; signal: AbortSignal; resolve: (listing: Listing) => void; reject: (error: Error) => void }[] = [];
  const watches: { paths: string[]; changed: (error?: string, ready?: boolean) => void; released: boolean }[] = [];
  const model = new FilesModel({
    list: (path, signal) => new Promise((resolve, reject) => requests.push({ path, signal, resolve, reject })),
    watch: (paths, changed) => {
      const watch = { paths, changed, released: false }; watches.push(watch);
      return () => { watch.released = true; };
    },
  });
  return { model, requests, watches };
}
const entry = (path: string, directory = false) => ({ path, directory });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("complete siblings publish sorted immediately, exact nodes survive reorder, cached reopen deduplicates", async () => {
  const { model, requests } = fixture();
  const first = model.load('');
  expect(model.load('')).toBe(first);
  await flush();
  expect(requests).toHaveLength(1);
  requests[0].resolve({ entries: [entry('z'), entry('A'), entry('a'), entry('folder', true)] });
  await first;
  expect(model.cache[''].entries?.map(item => item.path)).toEqual(['folder', 'a', 'A', 'z']);
  const nodes = [...model.cache[''].entries!];
  await model.load(''); expect(requests).toHaveLength(1);
  model.refresh(); await flush();
  requests[1].resolve({ entries: [entry('a'), entry('folder', true), entry('z'), entry('A')] });
  await flush();
  model.cache[''].entries!.forEach((node, index) => expect(node).toBe(nodes[index]));
});

test("800ms indicator never delays ready data; cancellation settles callers and ignores late continuations", async () => {
  vi.useFakeTimers();
  try {
    const { model, requests } = fixture();
    const pending = model.load(''); await flush();
    await vi.advanceTimersByTimeAsync(799); expect(model.cache['']).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1); expect(model.cache[''].slow).toBe(true);
    model.cancel(); expect((await pending).error).toContain('cancelled');
    expect(requests[0].signal.aborted).toBe(true);
    const next = model.load(''); await flush();
    requests[1].resolve({ entries: [entry('current')] }); await next;
    requests[0].resolve({ entries: [entry('stale')] }); await flush();
    expect(model.cache[''].entries).toEqual([entry('current')]);
    expect(model.cache[''].slow).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test("invalidate during reads discards stale errors and preserves the last good listing on transient failure", async () => {
  const { model, requests } = fixture();
  const first = model.load(''); await flush(); requests[0].resolve({ entries: [entry('good')] }); await first;
  model.refresh(); await flush();
  model.refresh(); await flush();
  requests[1].reject(Error('stale')); await flush(); expect(model.cache[''].error).toBeUndefined();
  requests[2].reject(Error('offline')); await flush();
  expect(model.cache[''].entries).toEqual([entry('good')]); expect(model.cache[''].error).toContain('offline');
  model.refresh(); await flush(); requests[3].resolve({ entries: [] }); await flush();
  expect(model.cache[''].entries).toEqual([]); expect(model.cache[''].error).toBeUndefined();
});

test("remembered expansion discovers only reachable directories, ignores fail open, and prunes only success", async () => {
  const { model, requests } = fixture();
  const expanded = ['folder', 'folder/deep', 'closed/deep', 'missing'];
  model.discover(expanded, true); await flush(); expect(requests.map(r => r.path)).toEqual(['']);
  requests[0].resolve({ entries: [entry('folder', true), entry('closed', true)], ignored: ['folder'], filterError: 'git failed' }); await flush();
  model.discover(expanded, true); await flush(); expect(requests.map(r => r.path)).toEqual(['', 'folder']);
  requests[1].resolve({ entries: [entry('folder/deep', true)] }); await flush();
  model.discover(expanded, true); await flush(); expect(requests[2].path).toBe('folder/deep');
  const child = model.load('folder/deep');
  model.invalidate(); const root = model.load(''); await flush();
  requests[3].resolve({ entries: [entry('closed', true)] }); await root;
  expect(model.directories()).toEqual(['']); expect((await child).error).toContain('cancelled');
  requests[2].resolve({ entries: [entry('folder/deep/stale')] }); await flush();
  expect(model.rows(expanded).map(row => row.path)).toEqual(['closed']);
});

test("watch readiness recovers, retired callbacks cannot refresh, edit pause defers publication", async () => {
  const { model, requests, watches } = fixture();
  const status = vi.fn();
  const release = model.watch([''], status);
  watches[0].changed(undefined, true); await flush();
  requests[0].resolve({ entries: [entry('keep')] }); await flush();
  model.pause(true); watches[0].changed(); await flush(); expect(requests).toHaveLength(1);
  expect(model.cache[''].entries).toEqual([entry('keep')]);
  model.pause(false); await flush(); expect(requests).toHaveLength(2);
  requests[1].resolve({ entries: [entry('new')] }); await flush();
  release(); expect(watches[0].released).toBe(true);
  watches[0].changed('retired'); await flush(); expect(requests).toHaveLength(2);
  const releaseNext = model.watch([''], status); watches[1].changed(undefined, true); await flush();
  expect(requests).toHaveLength(3); requests[2].resolve({ entries: [entry('recovered')] }); await flush();
  expect(model.cache[''].entries).toEqual([entry('recovered')]); releaseNext(); model.cancel();
});

test("viewport bounds 10000 logical rows, pins focus/edit/drag and measures wrapping and width changes", () => {
  const viewport = new FilesViewport();
  const keys = Array.from({ length: 10000 }, (_, index) => String(index));
  viewport.setRows(keys, 240);
  expect(viewport.mounted(0, 560).length).toBeLessThan(45);
  expect(viewport.mounted(140000, 560, ['0', '9999'])).toEqual(expect.arrayContaining([0, 9999]));
  expect(viewport.mounted(140000, 560, ['0', '9999']).length).toBeLessThan(50);
  expect(viewport.measure('0', 84)).toBe(true); viewport.setRows(keys, 240);
  expect(viewport.offsets[1]).toBe(84); expect(viewport.height).toBe(280056);
  expect(viewport.indexAt(83)).toBe(0); expect(viewport.indexAt(84)).toBe(1);
  expect(viewport.reveal('9999', 0, 560)).toBe(279496);
  expect(viewport.measure('0', 84)).toBe(false);
  viewport.setRows(keys, 400); expect(viewport.offsets[1]).toBe(28);
});

test("measurement and width changes preserve the visible identity and within-row offset; reveal corrects estimates", () => {
  const viewport = new FilesViewport();
  const keys = Array.from({ length: 1000 }, (_, index) => String(index));
  viewport.setRows(keys, 240);
  const top = 100 * 28 + 7;
  viewport.measure('0', 100); viewport.measure('50', 60);
  const anchored = viewport.setRows(keys, 240, top);
  expect(anchored).toBe(top + 104);
  expect(keys[viewport.indexAt(anchored)]).toBe('100');
  expect(anchored - viewport.offsets[100]).toBe(7);
  const estimated = viewport.reveal('999', anchored, 560);
  expect(viewport.hasMeasurement('999')).toBe(false);
  viewport.measure('999', 140); viewport.setRows(keys, 240, estimated);
  expect(viewport.hasMeasurement('999')).toBe(true);
  const corrected = viewport.reveal('999', estimated, 560);
  expect(corrected).toBe(estimated + 112);
  expect(viewport.offsets[1000]).toBe(corrected + 560);
  const resized = viewport.setRows(keys, 400, anchored);
  expect(resized).toBe(top);
  expect(keys[viewport.indexAt(resized)]).toBe('100');
  expect(viewport.hasMeasurement('999')).toBe(false);
});

test("authoritative parent removal aborts an uncached descendant and exact special paths remain ordinary nodes", async () => {
  const { model, requests } = fixture();
  const root = model.load(''); await flush();
  requests[0].resolve({ entries: [entry('__proto__', true), entry('constructor', true)] }); await root;
  const child = model.load('__proto__'); await flush();
  expect(requests[1].path).toBe('__proto__');
  model.invalidate(); const next = model.load(''); await flush();
  requests[2].resolve({ entries: [] }); await next;
  expect((await child).error).toContain('cancelled');
  requests[1].resolve({ entries: [entry('__proto__/late')] }); await flush();
  expect(model.directories()).toEqual(['']); expect(model.rows([])).toEqual([]);
});

 test("explicit refresh bypasses edit deferral without losing cached contents", async () => {
  const { model, requests } = fixture();
  const first = model.load(''); await flush(); requests[0].resolve({ entries: [entry('old')] }); await first;
  model.pause(true); model.refresh(); await flush(); expect(requests).toHaveLength(1);
  model.refresh(true); await flush(); expect(model.cache[''].entries).toEqual([entry('old')]);
  requests[1].resolve({ entries: [entry('new')] }); await flush();
  expect(model.cache[''].entries).toEqual([entry('new')]); model.cancel();
});

test("a saved viewport anchor restores identity when previous heights are unavailable", () => {
  const viewport = new FilesViewport(); const keys = ['one', 'two', 'three'];
  viewport.setRows(keys, 200); viewport.measure('one', 84); viewport.setRows(keys, 200);
  const saved = viewport.anchor(91)!; expect(saved).toEqual({ path: 'two', offset: 7 });
  const restored = new FilesViewport(); restored.setRows(keys, 200);
  expect(restored.anchor(restored.offsets[keys.indexOf(saved.path)] + saved.offset)).toEqual(saved);
  expect(viewport.setRows(['inserted', ...keys], 200, 91)).toBe(119);
});

test("retained contents are not authoritative while refreshing or after failure", async () => {
  const { model, requests } = fixture();
  const first = model.load(''); await flush(); requests[0].resolve({ entries: [entry('old')] }); await first;
  expect(model.resolved('')).toBe(true);
  model.refresh(); await flush(); expect(model.resolved('')).toBe(false);
  expect(model.cache[''].entries).toEqual([entry('old')]);
  requests[1].reject(Error('offline')); await flush(); expect(model.resolved('')).toBe(false);
  model.refresh(); await flush(); requests[2].resolve({ entries: [entry('new')] }); await flush();
  expect(model.resolved('')).toBe(true);
});

 test("scroll anchors cross the workspace contract and follow known move/Trash outcomes", () => {
  const state = { projects: [], selected: '', drafts: [], views: { repo: { files: {
    expanded: [], selected: [], focus: '', scroll: 90, scrollAnchor: { path: 'folder/file', offset: 7 } as { path: string; offset: number } | undefined,
  } } } };
  const intent = { root: 'repo', checkoutIdentity: 'checkout', source: 'folder', destination: 'renamed', identity: 'file', kind: 'move' as const };
  reconcile(state, intent);
  expect(state.views.repo.files.scrollAnchor).toEqual({ path: 'renamed/file', offset: 7 });
  expect(() => Schema.decodeUnknownSync(WorkspaceState)(state)).not.toThrow();
  reconcile(state, { ...intent, source: 'renamed', kind: 'trash' });
  expect(state.views.repo.files.scrollAnchor).toBeUndefined();
  expect(() => Schema.decodeUnknownSync(WorkspaceState)(state)).not.toThrow();
});
