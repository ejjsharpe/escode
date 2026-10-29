import { app, BrowserWindow, ipcMain, session } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { toolStatus } from "./tools";
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
  void window.loadURL(documentURL);
});
app.on("window-all-closed", () => app.quit());
