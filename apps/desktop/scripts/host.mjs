import { build } from "esbuild";
await build({
  entryPoints: ["host/main.ts", "host/preload.ts"],
  outdir: "dist/host",
  bundle: true,
  platform: "node",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  external: ["electron"],
});
