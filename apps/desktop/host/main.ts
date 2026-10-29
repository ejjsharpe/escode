import { app, BrowserWindow, ipcMain, session, dialog } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { toolStatus } from "./tools";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
import { Workspace } from "./workspace";
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
  const workspace = new Workspace(join(app.getPath("userData"), "workspace.json"));
  let mayClose = false;
  window.on("close", (event) => {
    if (mayClose) return;
    event.preventDefault();
    window.webContents.send("close-request");
  });
  app.on("before-quit", (event) => {
    if (mayClose) return;
    event.preventDefault();
    window.webContents.send("close-request");
  });
  ipcMain.handle("lifecycle", async (event, operation: unknown, ...args: unknown[]) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== documentURL
    )
      throw Error("Invalid sender");
    if (operation === "load" && !args.length) {
      const state = await workspace.read();
      const errors: string[] = [];
      const restored = [];
      for (const item of state.projects) {
        try {
          const p = await Project.open(item.root, helper);
          if (p.repository() !== item.project) {
            p.close();
            throw Error("Repository identity changed");
          }
          projects.get(p.root)?.close();
          projects.set(p.root, p);
          restored.push(await p.status());
        } catch (error) {
          errors.push(`${item.root}: ${String(error)}`);
        }
      }
      return { state, restored, errors };
    }
    if (operation === "persist" && args.length === 1) return workspace.write(args[0]);
    if (operation === "dirty" && args.length === 1 && typeof args[0] === "string") {
      return (
        await dialog.showMessageBox(window, {
          message: `Save changes to ${args[0]}?`,
          buttons: ["Save", "Discard", "Cancel"],
          defaultId: 0,
          cancelId: 2,
        })
      ).response;
    }
    const project = args[0];
    if (
      project !== undefined &&
      (typeof project !== "string" ||
        ![...projects.values()].some((p) => p.repository() === project))
    )
      throw Error("Unknown project");
    if (operation === "prepare") {
      if (!chats.active(project as string | undefined)) return true;
      return (
        (
          await dialog.showMessageBox(window, {
            message:
              "Active agent work will be interrupted. Completed edits, saved chats and worktrees are retained.",
            buttons: ["Stop and Close", "Cancel"],
            defaultId: 1,
            cancelId: 1,
          })
        ).response === 0
      );
    }
    if (operation === "finish") {
      await chats.shutdown(project as string | undefined);
      if (project === undefined) {
        mayClose = true;
        app.quit();
      } else {
        for (const [root, p] of projects)
          if (p.repository() === project) {
            p.close();
            projects.delete(root);
          }
      }
      return;
    }
    throw Error("Invalid lifecycle request");
  });
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
    if (operation === "worktree-options" && !args.length) return project.worktreeOptions();
    if (
      operation === "worktree-create" &&
      args.length === 2 &&
      args.every((a) => typeof a === "string")
    )
      return project.createWorktree(
        join(app.getPath("userData"), "worktrees"),
        args[0] as string,
        args[1] as string,
      );
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
      if (!target.validateRepository().includes(target.root))
        throw Error("Checkout is no longer registered with Git.");
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
