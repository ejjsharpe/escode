import { app, BrowserWindow, ipcMain, session, dialog } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { toolStatus } from "./tools";
import { Project } from "./project";
const developmentOrigin = "http://127.0.0.1:5173";
app.whenReady().then(() => {
  const page = pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  const dev = !app.isPackaged && process.env.ESCODE_DEV_URL === developmentOrigin;
  const documentURL = dev ? developmentOrigin + "/" : page;
  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          dev
            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5173; worker-src 'self' blob:; font-src 'self' data:"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; font-src 'self' data:",
        ],
      },
    }),
  );
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== documentURL) event.preventDefault();
  });
  ipcMain.handle("tools:status", (event, ...args) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== documentURL ||
      args.length
    )
      throw new Error("Invalid tools request");
    return toolStatus();
  });
  let project: Project | undefined;
  ipcMain.handle("project", async (event, operation: unknown, ...args: unknown[]) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== documentURL
    )
      throw Error("Invalid sender");
    if (operation === "open" && args.length === 0) {
      const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
      if (result.canceled) return null;
      if (project) throw Error("One project is supported in this slice. Restart to open another.");
      project = await Project.open(result.filePaths[0]);
      return project.status();
    }
    if (!project) throw Error("Open a project first.");
    if (operation === "status" && !args.length) return project.status();
    if (operation === "files" && args.length === 1 && typeof args[0] === "string")
      return project.files(args[0]);
    if (operation === "read" && args.length === 1 && typeof args[0] === "string")
      return project.read(args[0]);
    if (operation === "save" && args.length === 3 && args.every((a) => typeof a === "string"))
      return project.save(args[0] as string, args[1] as string, args[2] as string);
    if (
      operation === "diff" &&
      args.length === 2 &&
      typeof args[0] === "string" &&
      typeof args[1] === "string"
    )
      return project.diff({ path: args[0], area: args[1] as "staged" });
    throw Error("Invalid project request");
  });
  void window.loadURL(documentURL);
});
app.on("window-all-closed", () => app.quit());
