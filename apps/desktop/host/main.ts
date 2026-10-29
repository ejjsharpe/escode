import { app, BrowserWindow, ipcMain, session, dialog } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { toolStatus } from "./tools";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
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
  const store = new Chats(join(app.getPath("userData"), "chats.json"));
  const chats = new ChatService(store);
  const projects = new Map<string, Project>();
  const helper = join(app.isPackaged ? process.resourcesPath : __dirname, "filesystem");
  const checkout = async (root: unknown) => {
    if (typeof root !== "string") throw Error("Invalid checkout");
    const existing = projects.get(root);
    if (existing) return existing;
    const candidate = await Project.open(root, helper);
    if (![...projects.values()].some((p) => p.repository() === candidate.repository())) {
      candidate.close();
      throw Error("Open this project first.");
    }
    projects.set(candidate.root, candidate);
    return candidate;
  };
  app.once("will-quit", () => {
    chats.close();
    for (const p of projects.values()) p.close();
  });
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
      const candidate = await Project.open(result.filePaths[0], helper);
      const existing = projects.get(candidate.root);
      if (existing) candidate.close();
      else projects.set(candidate.root, candidate);
      const opened = existing ?? candidate;
      await store.migrate(opened.repository(), opened.checkouts());
      return opened.status();
    }
    const project = await checkout(args.shift());
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
  ipcMain.handle("chat", async (event, operation: unknown, ...args: unknown[]) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== documentURL
    )
      throw Error("Invalid sender");
    const root = args.shift();
    if (typeof root !== "string" || ![...projects.values()].some((p) => p.repository() === root))
      throw Error("Open this project first.");
    if (operation === "list" && !args.length) return chats.list(root);
    if (operation === "create" && args.length === 1) {
      const target = await checkout(args[0]);
      if (target.repository() !== root) throw Error("Checkout belongs to another project.");
      return chats.create(root, target.root);
    }
    const [id, value, answer] = args;
    if (typeof id !== "string" || id.length > 100) throw Error("Invalid chat identity");
    await chats.list(root).then((list) => {
      if (!list.some((c) => c.id === id)) throw Error("Unknown project/chat");
    });
    if (args.length === 1) {
      if (operation === "open") return chats.open(root, id);
      if (operation === "snapshot") return chats.snapshot(root, id);
      if (operation === "stop") return chats.stop(root, id);
      if (operation === "disconnect") return chats.disconnect(root, id);
    }
    if (args.length === 2 && typeof value === "string" && value.length <= 100000) {
      if (operation === "draft") return chats.draft(root, id, value);
      if (operation === "send") return chats.send(root, id, value);
    }
    if (
      operation === "answer" &&
      args.length === 3 &&
      typeof value === "string" &&
      JSON.stringify(answer)?.length <= 200000
    )
      return chats.answer(root, id, value, answer);
    throw Error("Invalid chat request");
  });
  void window.loadURL(documentURL);
});
app.on("window-all-closed", () => app.quit());
