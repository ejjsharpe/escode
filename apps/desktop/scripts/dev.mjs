import { spawn } from "node:child_process";
import { createServer } from "vite-plus";
await import("./host.mjs");
const server = await createServer({ server: { host: "127.0.0.1", port: 5173, strictPort: true } });
await server.listen();
const env = { ...process.env, ESCODE_DEV_URL: "http://127.0.0.1:5173" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn("electron", ["."], { stdio: "inherit", env });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 1);
});
