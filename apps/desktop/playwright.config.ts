import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests", timeout: 45000, workers: 1 });
