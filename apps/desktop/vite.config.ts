import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
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
  test: { include: ["host/**/*.test.ts"] },
}));
