import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins:
    mode === "test"
      ? []
      : [
          stylex.vite({ useCSSLayers: true, dev: mode === "development", runtimeInjection: false }),
          react(),
        ],
  build: { outDir: "dist/renderer" },
  test: { include: ["host/**/*.test.ts"], testTimeout: 15000 },
}));
