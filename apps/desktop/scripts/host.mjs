import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
await import("./filesystem.mjs");
await writeFile("dist/host/sqlite-worker.cjs", await readFile("host/sqlite-worker.cjs"));
const bundle = await build({
  entryPoints: ["host/main.ts", "host/preload.ts", "host/recovery-admin.ts"],
  outdir: "dist/host",
  bundle: true,
  metafile: true,
  platform: "node",
  format: "cjs",
  define: { "import.meta.dirname": "__dirname" },
  outExtension: { ".js": ".cjs" },
  external: ["electron"],
});

// Derive notices from bundled inputs so dependency changes cannot omit attribution.
const packages = new Map();
for (const input of [...new Set(Object.values(bundle.metafile.outputs).flatMap((output) => Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([path]) => path)))].filter((path) => path.includes("node_modules/"))) {
  let directory = dirname(input);
  while (directory !== ".") {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (!packages.has(manifest.name)) {
        let license;
        for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENSE-MIT"]) {
          try { license = await readFile(join(directory, name), "utf8"); break; } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        if (!license) throw Error(`Missing bundled license: ${manifest.name}`);
        packages.set(manifest.name, { name: manifest.name, version: manifest.version, license: manifest.license, text: license });
      }
      break;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    directory = dirname(directory);
  }
}
const attribution = await Promise.all([
  "../../packages/host/T3-LICENSE", "host/vendor/T3-LICENSE", "host/vendor/CODEX-LICENSE", "host/vendor/CODEX-NOTICE", "host/vendor/VSCODE-LICENSE", "host/vendor/RIPGREP-LICENSE",
].map(path => readFile(path, "utf8")));
await writeFile("dist/host/codex-extraction.json", await readFile("host/vendor/extraction.json"));
await writeFile("dist/host/foundation-NOTICES.txt", [...attribution, ...[...packages.values()].map((p) => `${p.name}@${p.version} (${p.license})\n${p.text}`)].join("\n\n"));
await writeFile("dist/host/foundation-dependencies.json", JSON.stringify([...packages.values()].map(({ text: _text, ...p }) => p), null, 2) + "\n");
