import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchDesktop } from "./desktop";

test("frame observations for cold, cached, large and remembered expansion", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-viewport-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  for (const folder of ["cold", "large", "remembered/child/deep"]) await mkdir(join(root, folder), { recursive: true });
  for (const [folder, count] of [["cold", 30], ["large", 1000], ["remembered/child/deep", 5]] as const)
    await Promise.all(Array.from({ length: count }, (_, i) => writeFile(join(root, folder, `file-${String(i).padStart(4, "0")}.txt`), "fixture")));
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    const row = (path: string) => page.locator(`[data-path="${path}"] > .tree-row`);
    await expect(row("cold")).toBeVisible();
    const observe = async (path: string, label: string) => {
      await page.evaluate(path => {
        const start = performance.now();
        const frames: { time: number; mounted: number; logical: number; children: number; loading: boolean }[] = [];
        (window as any).frameProbe = { frames, running: true };
        const sample = () => {
          if (!(window as any).frameProbe.running) return;
          const tree = document.querySelector('[role="tree"][aria-label="Files"]')!;
          frames.push({ time: performance.now() - start, mounted: tree.querySelectorAll('[role="treeitem"]').length, logical: Number(tree.getAttribute("data-row-count") ?? tree.querySelectorAll('[role="treeitem"]').length),
            children: [...tree.querySelectorAll('[data-path]')].filter(e => e.getAttribute('data-path')!.startsWith(path + '/')).length,
            loading: tree.textContent!.includes('Loading files…') });
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        document.querySelector<HTMLElement>(`[data-path="${path}"] > .tree-row`)!.click();
      }, path);
      await expect.poll(() => page.locator(`[data-path^="${path}/"]`).count()).toBeGreaterThan(0);
      if (label === "remembered") await expect(row("remembered/child/deep/file-0000.txt")).toBeVisible();
      await page.waitForTimeout(250);
      const frames = await page.evaluate(() => { (window as any).frameProbe.running = false; return (window as any).frameProbe.frames as { time: number; mounted: number; logical: number; children: number; loading: boolean }[]; });
      if (path !== "remembered") expect([...new Set(frames.map(f => f.logical))].every(count => count === 3 || count === (path === "large" ? 1003 : 33))).toBe(true);
      console.log("FRAME", JSON.stringify({ label, first: frames.find(f => f.children)?.time, complete: frames.find(f => f.logical === (path === "large" ? 1003 : path === "cold" ? 33 : 10))?.time, logicalCounts: [...new Set(frames.map(f => f.logical))], counts: [...new Set(frames.map(f => f.children))], maxMounted: Math.max(...frames.map(f => f.mounted)), longestFrame: Math.max(...frames.slice(1).map((f, i) => f.time - frames[i].time)), loadingFrames: frames.filter(f => f.loading).length }));
    };
    await observe("cold", "cold");
    await row("cold").click();
    await observe("cold", "cached");
    await row("cold").click();
    await observe("large", "large");
    if (!process.env.ESCODE_TREE_BASELINE) {
      expect(await page.getByRole("treeitem").count()).toBeLessThan(100);
      const tree = page.getByRole("tree", { name: "Files", exact: true });
      await tree.focus();
      await page.keyboard.press("End");
      await expect(row("remembered")).toBeVisible();
      await page.keyboard.press("Home");
    }
    await row("large").click();
    await row("remembered").click();
    await row("remembered/child").click();
    await row("remembered/child/deep").click();
    await expect(row("remembered/child/deep/file-0000.txt")).toBeVisible();
    await row("remembered").click();
    // Remount with remembered expansion but a cold model, independent of Refresh cache policy.
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(row("remembered")).toBeVisible();
    await observe("remembered", "remembered");
    await expect(row("remembered/child/deep/file-0000.txt")).toBeVisible();
  } finally {
    app.process().kill("SIGKILL");
    await new Promise(resolve => app.process().once("exit", resolve));
    await rm(base, { recursive: true, force: true });
  }
});

test("single-line rows retain complete names, restore identity and keep the active descendant mounted", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-wrap-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  const names = Array.from({ length: 300 }, (_, i) => `${String(i).padStart(4, "0")}-${"long-filename-".repeat(12)}.txt`);
  await Promise.all(names.map(name => writeFile(join(root, name), "fixture")));
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    await page.getByRole("button", { name: "Open project…" }).click();
    const tree = page.getByRole("tree", { name: "Files", exact: true });
    await expect(tree).toHaveAttribute("data-row-count", "300");
    await tree.focus();
    await page.keyboard.type("0150");
    const focused = page.getByRole("treeitem", { name: names[150], exact: true });
    await expect(focused).toBeVisible();
    await expect(tree).toHaveAttribute("aria-activedescendant", root + ":" + names[150]);
    expect(await focused.evaluate(el => el.getBoundingClientRect().height)).toBe(28);
    const label = focused.locator(".tree-label");
    await expect(label).toHaveAttribute("title", names[150]);
    expect(await label.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    const anchor = () => tree.evaluate(el => {
      const top = el.getBoundingClientRect().top;
      const row = [...el.querySelectorAll<HTMLElement>('[data-path]')].find(row => row.getBoundingClientRect().bottom > top + 1 && row.getBoundingClientRect().top <= top + 1);
      return row?.dataset.path;
    });
    await expect.poll(anchor).toBeTruthy();
    const before = await anchor();
    await page.getByRole("button", { name: "Source Control", exact: true }).click();
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect.poll(anchor).toBe(before);
    expect(await tree.getByRole("treeitem").count()).toBeLessThan(100);
    await tree.focus(); await page.keyboard.press("Meta+a");
    await page.keyboard.press("End");
    await expect(tree).toHaveAttribute("aria-activedescendant", root + ":" + names[299]);
    await expect(page.getByRole("treeitem", { name: names[299], exact: true })).toBeVisible();
  } finally {
    app.process().kill("SIGKILL");
    await new Promise(resolve => app.process().once("exit", resolve));
    await rm(base, { recursive: true, force: true });
  }
});

test("cold long-name siblings have fixed positions in their first visible frame", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "escode-cold-wrapping-")));
  const root = join(base, "repo");
  execFileSync("git", ["init", root]);
  await mkdir(join(root, "plugins"));
  const names = [
    "withAndroidManifestFCMIconPlugin.js",
    "withAndroidSplashScreenStatusBarTranslucentPlugin.js",
    "withAndroidStylesAccentColorPlugin.js",
    "withAppDelegateReferrer.js",
  ];
  await Promise.all(names.map(name => writeFile(join(root, "plugins", name), "fixture")));
  const app = await launchDesktop(join(base, "user"));
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, root);
    await page.getByRole("button", { name: "Open project…", exact: true }).click();
    const row = page.locator('[data-path="plugins"] > .tree-row');
    await expect(row).toBeVisible();
    await page.evaluate(() => {
      const frames: { count: number; overlap: boolean; wrapped: boolean }[] = [];
      (window as any).coldWrapping = { frames, running: true };
      const sample = () => {
        if (!(window as any).coldWrapping.running) return;
        const rows = [...document.querySelectorAll('[data-path^="plugins/"]')]
          .map(row => row.getBoundingClientRect());
        frames.push({ count: rows.length, wrapped: rows.some(row => row.height > 28),
          overlap: rows.slice(1).some((row, index) => row.top < rows[index].bottom - 0.5) });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await row.click();
    await expect(page.locator('[data-path^="plugins/"]')).toHaveCount(names.length);
    await page.waitForTimeout(150);
    const frames = await page.evaluate(() => {
      (window as any).coldWrapping.running = false;
      return (window as any).coldWrapping.frames as { count: number; overlap: boolean; wrapped: boolean }[];
    });
    const visible = frames.filter(frame => frame.count > 0);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every(frame => !frame.wrapped)).toBe(true);
    expect(visible.every(frame => frame.count === names.length)).toBe(true);
    expect(visible.every(frame => !frame.overlap)).toBe(true);
  } finally {
    await app.close();
    await rm(base, { recursive: true, force: true });
  }
});
