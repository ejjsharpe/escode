import { executeSend } from "./send";
import { Schema } from "effect";
import { SendCommand } from "@escode/contracts";
import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  dialog,
  clipboard,
  ClipboardItem,
  shell,
} from "electron";
import { join, resolve, dirname, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, statSync } from "node:fs";
import { NativeImport } from "./native-import";
import { startDirectoryHost } from "@escode/host";
import { maximumFrameBytes, type DirectoryResult } from "@escode/contracts";
import { FoundationState } from "./foundation-state";
import { pathToFileURL, fileURLToPath } from "node:url";
import { draftSettings, toolStatus } from "./tools";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
import { Workspace } from "./workspace";
import { Project } from "./project";
import { FileOperations } from "./file-operations";
import { affected } from "./file-operation-state";
const developmentOrigin = /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.ESCODE_DEV_URL ?? "")
  ? process.env.ESCODE_DEV_URL!
  : "http://127.0.0.1:5173";
app.whenReady().then(async () => {
  mkdirSync(app.getPath("userData"), { recursive: true, mode: 0o700 });
  let foundation: FoundationState;
  try {
    foundation = FoundationState.open(join(app.getPath("userData"), "foundation"));
  } catch (error) {
    dialog.showErrorBox(
      "Foundation state unavailable",
      `${String(error)}\nExisting state is retained. Resolve storage access or perform explicit recovery before restarting.`,
    );
    app.quit();
    return;
  }
  app.once("will-quit", () => foundation.close());
  const page = pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  const dev = !app.isPackaged && process.env.ESCODE_DEV_URL === developmentOrigin;
  const documentURL = dev ? developmentOrigin + "/" : page;
  const window = new BrowserWindow({
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 17 },
    backgroundColor: "#18191c",
    width: 1100,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  let directoryOrigin = "";
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          dev
            ? `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${developmentOrigin.replace("http:", "ws:")} ${directoryOrigin}; worker-src 'self' blob:; font-src 'self' data:`
            : `default-src 'self'; connect-src ${directoryOrigin}; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; font-src 'self' data:`,
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
  const store = new Chats(join(app.getPath("userData"), "host-chats-v1.json"));
  const chats = new ChatService(store, undefined, undefined, draftSettings);
  const projects = new Map<string, Project>();
  const projectSessions = new Map<string, object>();
  const unapprovedProjects = new Set<string>();
  const removing = new Set<string>();
  let quitting = false;
  let mutationOrigin: string | undefined;
  const workspace = new Workspace(join(app.getPath("userData"), "client-workspace-v1.json"), foundation.read());
  const operations = new FileOperations(
    workspace,
    join(app.getPath("userData"), "client-file-operation-v1.json"),
    foundation.read(),
  );
  mkdirSync(app.getPath("userData"), { recursive: true, mode: 0o700 });
  const stateFiles = [
    "workspace.json",
    "client-workspace-v1.json",
    "client-file-operation-v1.json",
    "approved-projects.json",
    "host-chats-v1.json",
    "file-operation.json",
    "foundation/state.json",
    "foundation/owner.lock",
  ]
    .flatMap((name) => [name, name + ".tmp"])
    .map((name) => join(realpathSync(app.getPath("userData")), name));
  const protectedFiles = new Set(stateFiles.map((file) => file.normalize("NFC").toLowerCase()));
  const isAppState = (path: string) => {
    if (protectedFiles.has(path.normalize("NFC").toLowerCase())) return true;
    try {
      const target = statSync(path);
      return stateFiles.some((file) => {
        try {
          const state = statSync(file);
          return target.dev === state.dev && target.ino === state.ino;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  };
  const clipboardFormat = "web application/x.escode-files";
  let fileClipboard:
    | {
        token: string;
        root: string;
        checkout: string;
        cut: boolean;
        entries: { source: string; identity: string; directory: boolean }[];
      }
    | undefined;
  let fileDrag: typeof fileClipboard;
  const imports = new Map<string, { entries: NativeImport[]; expires: number }>();
  const protectImport = (path: string) => {
    if (
      isAppState(path) ||
      stateFiles.some((file) =>
        affected(file.normalize("NFC").toLowerCase(), path.normalize("NFC").toLowerCase()),
      )
    )
      throw Error("Protected app state is inside this import.");
  };
  const captureImport = (paths: string[]) => {
    if (!paths.length || paths.length > 10000) throw Error("No native file references.");
    const entries: NativeImport[] = [];
    try {
      for (const path of new Set(paths)) {
        const entry = new NativeImport(path, protectImport);
        if (entries.some((existing) => existing.identity === entry.identity)) {
          entry.close();
          continue;
        }
        entries.push(entry);
        if (stateFiles.some((file) => entry.containsDirectory(dirname(file))))
          throw Error("Protected app state is inside this import.");
      }
      const pruned = entries.filter(
        (entry) =>
          !entries.some(
            (parent) =>
              parent !== entry &&
              parent.directory &&
              entry.parents.split(",").includes(parent.identity),
          ),
      );
      entries.filter((entry) => !pruned.includes(entry)).forEach((entry) => entry.close());
      return pruned;
    } catch (error) {
      entries.forEach((e) => e.close());
      throw error;
    }
  };
  const clearImports = () => {
    for (const value of imports.values()) value.entries.forEach((e) => e.close());
    imports.clear();
  };
  window.webContents.on("did-start-navigation", clearImports);
  window.webContents.on("render-process-gone", clearImports);
  const expiry = setInterval(() => {
    for (const [token, value] of imports)
      if (Date.now() > value.expires) {
        value.entries.forEach((e) => e.close());
        imports.delete(token);
      }
  }, 10000);
  window.on("closed", () => {
    clearInterval(expiry);
    clearImports();
  });
  // This channel is reachable only through the isolated preload's File resolver.
  ipcMain.handle("native-import-capture", (event, paths: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== documentURL ||
      !Array.isArray(paths) ||
      paths.some((p) => typeof p !== "string")
    )
      throw Error("Invalid native import sender or references.");
    const entries = captureImport(paths);
    const token = randomUUID();
    imports.set(token, { entries, expires: Date.now() + 60000 });
    return token;
  });
  let mayClose = false;
  window.on("close", (event) => {
    if (mayClose) return;
    event.preventDefault();
    if (process.platform === "darwin") window.hide();
    else window.webContents.send("close-request");
  });
  app.on("activate", () => {
    if (window.isDestroyed()) return;
    window.show();
    window.focus();
  });
  app.on("before-quit", (event) => {
    if (mayClose) return;
    event.preventDefault();
    window.show();
    window.focus();
    window.webContents.send("close-request");
  });
  const workspaceAction = async (operation: "load" | "persist", ...args: unknown[]) => {
    if (operation === "load" && !args.length) {
      const state = await workspace.read();
      const approved = await workspace.approved();
      // Saved registration survives editor closure. Approvals are host-owned authority.
      state.savedProjects ??= [...state.projects];
      const historical = (await store.all())
        .filter((c) => c.project !== null)
        .map((c) => ({ project: c.project!, root: c.project! }));
      for (const item of [...approved, ...historical])
        if (!state.savedProjects.some((p) => p.project === item.project))
          state.savedProjects.push(item);
      for (const item of state.savedProjects)
        if (approved.some((p) => p.project === item.project && p.root === item.root))
          projectSessions.set(item.project, projectSessions.get(item.project) ?? {});
      const errors: string[] = [];
      const restored = [];
      for (const item of state.projects) {
        if (!approved.some((p) => p.project === item.project && p.root === item.root)) {
          unapprovedProjects.add(item.project);
          errors.push(
            `${item.root}: Use Open project to approve this saved directory. Saved state is retained.`,
          );
          restored.push({
            project: item.project,
            root: item.root,
            branch: "Approval required",
            changes: [],
            approvalRequired: true,
          });
          continue;
        }
        unapprovedProjects.delete(item.project);
        if (!projectSessions.has(item.project)) projectSessions.set(item.project, {});
        try {
          const p = await Project.restore(item.root, item.project, helper);
          projects.get(p.root)?.close();
          projects.set(p.root, p);
          restored.push(await p.status());
        } catch (error) {
          errors.push(`${item.root}: ${String(error)}`);
          restored.push({
            project: item.project,
            root: item.root,
            branch: "Checkout unavailable",
            changes: [],
          });
        }
      }
      const recovery = await operations.recover(checkout);
      if (recovery) errors.push(recovery);
      // Recovery changes drafts/paths on disk; registration was derived in memory above.
      return {
        state: { ...(await workspace.read()), savedProjects: state.savedProjects },
        restored,
        errors,
      };
    }
    if (operation === "persist" && args.length === 1) {
      return operations.persist(args[0]);
    }
    throw Error("Invalid workspace request");
  };
  ipcMain.handle("lifecycle", async (event, operation: unknown, ...args: unknown[]) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== documentURL
    )
      throw Error("Invalid sender");
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
        (!projectSessions.has(project) && !unapprovedProjects.has(project)))
    )
      throw Error("Unknown project");
    if (operation === "prepare") {
      if (project !== undefined || !chats.active()) return true;
      return (
        (
          await dialog.showMessageBox(window, {
            message:
              "Active agent work will be interrupted. Completed edits, saved chats and worktrees are retained.",
            detail: (await store.all()).filter((chat) => chats.checkoutActive(chat.project, chat.id)).map((chat) => `${chat.id} · ${chat.checkout}`).join("\n"),
            buttons: ["Stop and Close", "Cancel"],
            defaultId: 1,
            cancelId: 1,
          })
        ).response === 0
      );
    }
    if (operation === "finish") {
      // Editor closure retains checkout authority and every live chat session.
      if (project !== undefined) return;
      quitting = true;
      try {
        await chats.shutdown();
        mayClose = true;
        app.quit();
      } catch (error) {
        quitting = false;
        throw error;
      }
      return;
    }
    throw Error("Invalid lifecycle request");
  });
  const helper = join(app.isPackaged ? process.resourcesPath : __dirname, "filesystem");
  const checkout = async (root: unknown) => {
    if (typeof root !== "string") throw Error("Invalid checkout");
    const existing = projects.get(root);
    const associations = await Promise.all([...projectSessions.keys()].map((id) => store.list(id)));
    const linked = associations.flat().filter((c) => c.checkout === root && !c.removed);
    const saved = linked.find((c) => c.directoryIdentity) ?? linked[0];
    if (saved?.directoryIdentity) {
      const error = await store.validateDirectory(saved);
      if (error) throw Error(error);
      if (existing) {
        try {
          existing.checkoutIdentity();
          return existing;
        } catch {
          // Only the validated original directory may replace a stale cache entry.
          existing.close();
          projects.delete(root);
        }
      }
    } else if (existing) return existing;
    const candidate = saved
      ? await Project.restore(root, saved.project!, helper)
      : await Project.open(root, helper);
    if (!projectSessions.has(candidate.repository())) {
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
  const authorizeHistory = async (root: string | null, id: string) => {
    if (quitting || (root !== null && removing.has(root))) throw Error("Chat unavailable during shutdown or removal");
    const chat = await store.get(root, id);
    if (root !== null) {
      if (!(await workspace.approved()).some(p => p.project === root))
        throw Error("Open this project first. Use Open project… to approve its saved directory.");
    }
    return chat;
  };
  const expectedSend = async (root: string | null, id: string) => {
    const chat = await authorizeHistory(root, id);
    const detail = chats.snapshot(root, id);
    return JSON.stringify([chats.revision(id), chat.checkout, chat.threadId, chat.phase, chat.directoryIdentity,
      chat.worktree, chat.scratch, detail.connected, detail.busy, detail.turnId]);
  };
  const dispatchSend = async (command: SendCommand) => {
    const { project: root, id } = command;
    const owner = root === null ? undefined : projectSessions.get(root);
    const requireOpen = () => {
      if (quitting || (root !== null && (removing.has(root) || !owner || projectSessions.get(root) !== owner)))
        throw Error("Chat unavailable during shutdown, removal or lost project approval");
    };
    requireOpen();
    return chats.send(
          root,
          id,
          command.text,
          async (chat) => {
            if (await expectedSend(root, id) !== command.expected) throw Error("Chat/context state changed. Inspect before sending again.");
            if (chat.project === null) {
              requireOpen();
              return;
            }
            const target = await checkout(chat.checkout);
            requireOpen();
            target.checkoutIdentity();
            if (
              chat.phase === "draft" &&
              !chat.directoryIdentity &&
              !chat.worktree?.reservation &&
              !target.validateRepository().includes(target.root)
            )
              throw Error("Choose an available Git checkout before first Send. Prompt retained.");
            if (target.repository() !== root)
              throw Error(
                "Saved checkout is unavailable or no longer belongs to this project. Prompt retained; restore this exact path and Retry.",
              );
          },
          async (chat) => {
            if (!chat.worktree) return chat;
            if (chat.worktree.reservation) {
              store.validateWorktree(chat);
              return chat;
            }
            const source = await checkout(chat.worktree.source);
            requireOpen();
            if (source.repository() !== root) throw Error("Wrong project checkout.");
            const prepared = await store.prepareWorktree(
              chat,
              source,
              join(app.getPath("userData"), "worktrees"),
            );
            requireOpen();
            const target = await checkout(prepared.checkout);
            requireOpen();
            if (target.repository() !== root || !target.validateRepository().includes(target.root))
              throw Error("Prepared checkout is no longer registered with this project.");
            return prepared;
          },
        ).then(() => undefined);
  };
    const currentTarget = async (identity: string) => {
      const state = await workspace.read();
      const saved = [
        ...(state.savedProjects ?? []),
        ...state.projects,
        ...(await workspace.approved()),
      ];
      const p = saved.find((p) => p.project === identity);
      if (!p) throw Error("Unknown saved project.");
      return state.views[identity]?.checkout ?? p.root;
    };
  const draftAction = async (action: import("@escode/contracts").DraftAction) => {
    const { operation, project: root } = action;
    const requireOpen = () => {
      if (quitting || (root !== null && (!projectSessions.has(root) || removing.has(root))))
        throw Error("Open and approve this project first.");
    };
    requireOpen();
    const args = operation === "createDraft" ? [] : operation === "context"
      ? [action.id, action.target] : [action.id, action.mode, action.value, action.commit];
    if (operation === "createDraft" && !args.length)
      return store.createDraft(root, root === null ? "" : await currentTarget(root), true);
    if (
      operation === "context" &&
      args.length === 2 &&
      typeof args[0] === "string" &&
      (args[1] === null || typeof args[1] === "string")
    ) {
      const target = args[1];
      if (target !== null && !projectSessions.has(target))
        throw Error("Approve the target using Open project… first.");
      return chats.context(
        root,
        args[0],
        target,
        target === null ? "" : await currentTarget(target),
        undefined,
        async () => { if (await expectedSend(root, args[0] as string) !== action.expected) throw Error("Draft changed. Inspect and retry."); },
      );
    }
    if (
      root !== null &&
      operation === "execution" &&
      args.length === 4 &&
      args.every((a) => typeof a === "string")
    ) {
      const [id, mode, value, commit] = args as string[];
      const saved = await store.get(root, id);
      const source = saved.worktree?.source ?? saved.checkout;
      const project = await checkout(source);
      requireOpen();
      const options = project.worktreeOptions();
      if (project.repository() !== root) throw Error("Wrong project checkout.");
      if (mode === "new") {
        if (!options.bases.some((b) => b.ref === value && b.commit === commit))
          throw Error("Base is missing or changed. Refresh and choose again.");
        return chats.context(root, id, root, source, { source, ref: value, commit }, async () => { if (await expectedSend(root, id) !== action.expected) throw Error("Draft changed. Inspect and retry."); });
      }
      if (mode === "reuse" && options.checkouts.includes(value)) {
        const target = await checkout(value);
        requireOpen();
        if (target.repository() !== root) throw Error("Wrong project checkout.");
        return chats.context(root, id, root, target.root, undefined, async () => { if (await expectedSend(root, id) !== action.expected) throw Error("Draft changed. Inspect and retry."); });
      }
      throw Error("Choose a Git-discovered worktree explicitly.");
    }
    throw Error("Invalid draft action");
  };
  const fileContext = async (root: string, path: string) => {
    if (!projects.has(root)) throw Error("Open and approve this checkout first.");
    const project = await checkout(root), identity = project.repository(), owner = projectSessions.get(identity);
    const check = () => {
      if (!owner || projectSessions.get(identity) !== owner || projects.get(root) !== project || quitting || removing.has(identity))
        throw Error("Originating project unavailable or app quitting.");
      if (isAppState(resolve(root, path))) throw Error("App state is unavailable through project file operations.");
      project.checkoutIdentity();
    };
    check(); return { project, check };
  };
  const directoryHost = await startDirectoryHost({
    draftAction,
    sendState: async (root, id) => ({ admissionEpoch: foundation.admissionEpoch, expected: await expectedSend(root, id) }),
    sendStatus: async commandId => {
      const receipt = foundation.receipt(commandId);
      if (receipt) await authorizeHistory(receipt.command.project, receipt.command.id);
      return receipt;
    },
    sendMessage: async input => {
      const command = Schema.decodeUnknownSync(SendCommand)(input);
      await authorizeHistory(command.project, command.id);
      return executeSend(foundation, command, async () => {
        if (command.control) {
          const { operation, target, token, answer } = command.control;
          if (operation === "stop") await chats.stop(command.project, command.id, target);
          else await chats.answer(command.project, command.id, token, answer);
        } else await dispatchSend(command);
      });
    },
    chatSnapshot: async (root, id) => { await authorizeHistory(root, id); return chats.inspect(root, id); },
    openChat: async (root, id) => { await authorizeHistory(root, id); return chats.open(root, id); },
    history: async (root, id, cursor) => { await authorizeHistory(root, id); return chats.history(root, id, cursor); },
    summaries: async () => {
      const state = await workspace.read();
      const saved = [...(state.savedProjects ?? []), ...state.projects, ...await workspace.approved()];
      return Promise.all((await store.all()).filter(c => c.project === null || saved.some(p => p.project === c.project)).map(async c => {
        const activity = chats.summary(c.project, c.id);
        const contextError = c.phase === "draft" && ((c.project === null && !c.scratch) || (c.worktree && !c.worktree.reservation))
          ? c.availabilityError : await store.validateDirectory(c);
        return { id: c.id, project: c.project, checkout: c.checkout, threadId: c.threadId,
          createdAt: c.createdAt, legacyOrder: c.legacyOrder, phase: c.phase, initialSend: c.initialSend,
          removed: c.removed, scratch: c.scratch, hasSent: c.hasSent, worktree: c.worktree, ...activity, unavailable: !!(c.removed || contextError || activity.unavailable) };
      }));
    },
    loadWorkspace: () => workspaceAction("load") as Promise<typeof import("@escode/contracts").WorkspaceLoad.Type>,
    persistWorkspace: async (state) => { await workspaceAction("persist", state); },
    readFile: async (root, path) => { const { project } = await fileContext(root, path); return project.read(path); },
    saveFile: async (root, path, text, version) => {
      const { project, check } = await fileContext(root, path);
      if (mutationOrigin) throw Error("File operation awaiting confirmation.");
      return operations.save(project, path, text, version, check);
    },
    ...foundation.read(), origin: dev ? developmentOrigin : "file://",
    watch: (root, paths, notify) => {
      const project = projects.get(root);
      if (!project) throw Error("Open and approve this checkout first.");
      const identity = project.repository(), session = projectSessions.get(identity);
      if (!session || quitting || removing.has(identity)) throw Error("Project session closed.");
      for (const path of paths) {
        const absolute = resolve(root, path);
        if (isAppState(absolute) || stateFiles.some((file) => file.startsWith(absolute + "/")))
          throw Error("App state is unavailable in Files.");
      }
      return project.watchFiles([...paths], (error) => {
        if (projects.get(root) !== project || projectSessions.get(identity) !== session || quitting || removing.has(identity))
          notify("Originating project unavailable or app quitting.");
        else notify(error);
      });
    },
    list: async (root, path): Promise<DirectoryResult> => {
      // Only native-approved, already-open checkouts can reach filesystem adapters.
      if (!projects.has(root)) return { kind: "denied", message: "Open and approve this checkout first." };
      const project = await checkout(root);
      const identity = project.repository(), owner = projectSessions.get(identity);
      const check = () => {
        if (!owner || projectSessions.get(identity) !== owner || projects.get(root) !== project || quitting || removing.has(identity))
          throw Error("Originating project unavailable or app quitting.");
        project.checkoutIdentity();
      };
      const protectedPath = (path: string) => {
        const absolute = resolve(project.root, path);
        return isAppState(absolute) || stateFiles.some((file) => file.startsWith(absolute + "/"));
      };
      if (path && protectedPath(path))
        return { kind: "denied", message: "App state is unavailable in Files." };
      if (path && (path.startsWith("/") || path.includes("\0") || path.split("/").some((p) => p === ".." || p.toLowerCase() === ".git")))
        return { kind: "denied", message: "Directory path denied." };
      try {
        check();
        const result = await project.filteredFiles(path);
        check();
        const entries = result.entries.filter((entry) => !protectedPath(entry.path));
        const paths = new Set(entries.map((entry) => entry.path));
        const listing = { ...result, entries, ignored: result.ignored.filter((entry) => paths.has(entry)) };
        if (Buffer.byteLength(JSON.stringify(listing)) > maximumFrameBytes / 2)
          return { kind: "overflow", message: "Directory listing exceeds the connection limit." };
        return { kind: "available", listing };
      } catch (error) {
        return { kind: "unavailable", message: String(error) };
      }
    },
  });
  directoryOrigin = directoryHost.origin;
  ipcMain.handle("local-bootstrap", (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== documentURL || args.length) throw Error("Invalid local bootstrap request");
    if (quitting) throw Error("App is quitting.");
    return directoryHost.bootstrap();
  });
  app.once("will-quit", () => { void directoryHost.close(); });
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
      const opened = existing ?? candidate;
      try {
        await workspace.approve(opened.repository(), opened.root);
      } catch (error) {
        if (!existing) opened.close();
        throw error;
      }
      if (!existing) projects.set(candidate.root, candidate);
      unapprovedProjects.delete(opened.repository());
      if (!projectSessions.has(opened.repository())) projectSessions.set(opened.repository(), {});
      await store.migrate(opened.repository(), opened.checkouts());
      return opened.status();
    }
    if (["read", "save", "files", "files-filter"].includes(String(operation))) throw Error("Invalid project request");
    const requestedRoot = args.shift();
    if (
      [
        "entry-action",
        "drag-capture",
        "clipboard-capture",
        "transfer",
        "trash-selection",
        "file-operation",
        "file-operation-ack",
        "create-entry",
      ].includes(String(operation)) &&
      (typeof requestedRoot !== "string" || !projects.has(requestedRoot))
    )
      throw Error("Open and approve this checkout first.");
    const project = await checkout(requestedRoot);
    if (
      ["read", "save", "diff"].includes(String(operation)) &&
      typeof args[0] === "string" &&
      isAppState(resolve(project.root, args[0]))
    )
      throw Error("App state is unavailable through project file operations.");
    const identity = project.repository();
    const owner = projectSessions.get(identity);
    const checkFilesSession = () => {
      if (
        !owner ||
        projectSessions.get(identity) !== owner ||
        projects.get(project.root) !== project ||
        quitting
      )
        throw Error("Originating project unavailable or app quitting.");
      project.checkoutIdentity();
    };
    if (operation === "entry-action") checkFilesSession();
    if (removing.has(identity)) throw Error("Worktree removal is in progress. Retry afterward.");
    if (operation === "file-operation-ack" && !args.length) {
      if (mutationOrigin) throw Error("File operation is still delivering results.");
      return operations.ack(project.root);
    }
    const protect = (path: string) => {
      const absolute = resolve(project.root, path);
      if (
        isAppState(absolute) ||
        stateFiles.some((file) =>
          affected(file.normalize("NFC").toLowerCase(), absolute.normalize("NFC").toLowerCase()),
        )
      )
        throw Error("Protected app state is inside this operation.");
    };
    const capture = (paths: string[]) => {
      if (!paths.length || paths.length > 10000 || paths.some((p) => typeof p !== "string"))
        throw Error("Select entries first.");
      const entries = [...new Set(paths)].map((source) => {
        protect(source);
        return {
          source,
          identity: project.operationIdentity(source),
          directory: statSync(resolve(project.root, source)).isDirectory(),
        };
      });
      return entries.filter(
        (e) =>
          !entries.some(
            (parent) => parent !== e && parent.directory && affected(e.source, parent.source),
          ),
      );
    };
    if (operation === "drag-capture" && args.length === 1 && Array.isArray(args[0])) {
      operations.assertIdle();
      fileDrag = {
        token: randomUUID(),
        root: project.root,
        checkout: project.checkoutIdentity(),
        cut: false,
        entries: capture(args[0] as string[]),
      };
      return fileDrag.token;
    }
    if (
      operation === "clipboard-capture" &&
      args.length === 2 &&
      ["copy", "cut"].includes(String(args[0])) &&
      Array.isArray(args[1])
    ) {
      operations.assertIdle();
      fileClipboard = {
        token: randomUUID(),
        root: project.root,
        checkout: project.checkoutIdentity(),
        cut: args[0] === "cut",
        entries: capture(args[1] as string[]),
      };
      await clipboard.write([new ClipboardItem({ [clipboardFormat]: fileClipboard.token })]);
      return `${fileClipboard.cut ? "Cut" : "Copied references for"} ${fileClipboard.entries.length} item(s). Paste within this checkout.`;
    }
    if (
      operation === "transfer" &&
      args.length === 3 &&
      ["paste", "duplicate", "drag-move", "drag-copy", "import"].includes(String(args[0])) &&
      typeof args[1] === "string" &&
      Array.isArray(args[2])
    ) {
      if (mutationOrigin) throw Error("Another file operation is pending.");
      const duplicate = args[0] === "duplicate";
      const dragging = args[0] === "drag-move" || args[0] === "drag-copy";
      let nativeEntries: NativeImport[] | undefined;
      const nativeDrop = args[0] === "import";
      const reference = duplicate ? undefined : dragging ? fileDrag : fileClipboard;
      const item =
        duplicate || dragging || nativeDrop
          ? undefined
          : (await clipboard.read()).find((item) => item.types.includes(clipboardFormat));
      const token = dragging
        ? args[2][0]
        : item
          ? await (await item.getType(clipboardFormat)).text()
          : "";
      if (nativeDrop) {
        const captured = imports.get(String(args[2][0]));
        if (!captured || captured.expires < Date.now())
          throw Error("Native references expired. Drop again.");
        imports.delete(String(args[2][0]));
        nativeEntries = captured.entries;
      } else if (args[0] === "paste" && !item) {
        const native = (await clipboard.read()).find((item) =>
          item.types.includes("text/uri-list"),
        );
        if (native)
          nativeEntries = captureImport(
            (await (await native.getType("text/uri-list")).text())
              .split(/\r?\n/)
              .filter((p) => p && !p.startsWith("#"))
              .map((p) => fileURLToPath(p)),
          );
      }
      if (
        !duplicate &&
        !nativeEntries &&
        (!reference ||
          reference.root !== project.root ||
          reference.checkout !== project.checkoutIdentity() ||
          token !== reference.token)
      )
        throw Error(
          "No current escode file references for this checkout. Copy or cut again in Files.",
        );
      const entries =
        nativeEntries ?? (duplicate ? capture(args[2] as string[]) : [...reference!.entries]);
      if (dragging) fileDrag = undefined;
      const parent = args[1];
      let checkoutIdentity: string, parentIdentity: string;
      try {
        checkoutIdentity = project.checkoutIdentity();
        parentIdentity = parent ? project.operationIdentity(parent) : checkoutIdentity;
      } catch (error) {
        nativeEntries?.forEach((e) => e.close());
        throw error;
      }
      const owner = projectSessions.get(identity);
      const check = () => {
        if (
          !owner ||
          projectSessions.get(identity) !== owner ||
          projects.get(project.root) !== project ||
          quitting
        )
          throw Error("Originating project unavailable or app quitting.");
        if (
          project.checkoutIdentity() !== checkoutIdentity ||
          (parent ? project.operationIdentity(parent) : project.checkoutIdentity()) !==
            parentIdentity
        )
          throw Error("Destination folder changed. Retry paste.");
      };
      mutationOrigin = project.root;
      const results: (import("./file-operations").OperationResult & { source: string })[] = [];
      const open: string[] = [];
      try {
        if (args[0] === "drag-move") {
          check();
          const answer = await dialog.showMessageBox(window, {
            message: `Move ${entries.length} item(s)?`,
            detail: `Checkout: ${project.root}\nSources:\n${entries.map((e) => e.source).join("\n")}\nDestination folder: ${parent || "(checkout root)"}\nUnsaved edits follow moved paths. Earlier text undo history resets.`,
            buttons: ["Move", "Cancel"],
            defaultId: 1,
            cancelId: 1,
          });
          if (answer.response !== 0)
            return {
              results: [],
              open: [],
              requiresAck: false,
              message: "Drag move cancelled. No files changed.",
            };
          check();
        }
        operations.beginBatch(project.root);
        for (const entry of entries) {
          const source = entry.source;
          const sourceLabel = entry instanceof NativeImport ? entry.path : source;
          let destination = "";
          try {
            const folder = duplicate ? (dirname(source) === "." ? "" : dirname(source)) : parent;
            destination = folder ? folder + "/" + basename(source) : basename(source);
            // A native basename may be legal on disk but unsupported by the app's name policy.
            // Reject it before even offering destructive collision choices.
            project.validateName(basename(destination));
            const validateTransfer = (allowOriginal = false) => {
              check();
              project.validateName(basename(destination));
              if (entry instanceof NativeImport) {
                protectImport(entry.path);
                entry.validate();
                if (entry.containsDirectory(resolve(project.root, folder)))
                  throw Error("Choose a destination outside the source folder.");
                // Never Trash an imported original, even if a different spelling resolves to it.
                try {
                  if (!allowOriginal && project.operationIdentity(destination) === entry.identity)
                    throw Error("Destination is the native original. Choose a free sibling name.");
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                }
              } else protect(source);
              protect(destination);
              if (
                !(entry instanceof NativeImport) &&
                (project.operationIdentity(source) !== entry.identity ||
                  statSync(resolve(project.root, source)).isDirectory() !== entry.directory)
              )
                throw Error("Captured source changed. Copy or cut it again.");
            };
            validateTransfer(true);
            if (entry instanceof NativeImport) await project.preflightImport(entry);
            const kind =
              !nativeEntries && (args[0] === "drag-move" || (!dragging && reference?.cut))
                ? "move"
                : "copy";
            if (!(entry instanceof NativeImport) && entry.directory && affected(folder, source))
              throw Error("Choose a destination outside the source folder.");
            const siblings = await project.files(folder);
            const folded = (p: string) => p.normalize("NFC").toLowerCase();
            const state = await workspace.read();
            const occupied = (p: string) =>
              siblings.some((e) => folded(e.path) === folded(p)) ||
              state.drafts.some(
                (d) => d.root === project.root && affected(folded(d.path), folded(p)),
              );
            const free = () => {
              const name = basename(source),
                extension = entry.directory ? "" : extname(name),
                stem = name.slice(0, name.length - extension.length);
              for (let i = 1; i < 100000; i++) {
                const name = `${stem} copy${i === 1 ? "" : " " + i}${extension}`;
                project.validateName(name);
                const candidate = folder ? folder + "/" + name : name;
                if (!occupied(candidate)) return candidate;
              }
              throw Error("No free sibling name found.");
            };
            if (destination === source && kind === "move")
              throw Error("Source already belongs to this folder; cut retained.");
            if (
              duplicate ||
              (entry instanceof NativeImport
                ? siblings.some(
                    (e) =>
                      folded(e.path) === folded(destination) &&
                      project.operationIdentity(e.path) === entry.identity,
                  )
                : destination === source)
            )
              destination = free();
            else if (occupied(destination)) {
              const existing = siblings.find((e) => folded(e.path) === folded(destination));
              if (existing) destination = existing.path;
              project.validateName(basename(destination));
              const dirty = state.drafts.filter(
                (d) => d.root === project.root && affected(folded(d.path), folded(destination)),
              );
              const replace = !entry.directory && existing && !existing.directory && !dirty.length;
              const buttons = dirty.length
                ? ["Open affected files", "Keep Both", "Cancel"]
                : replace
                  ? ["Replace", "Keep Both", "Skip", "Cancel"]
                  : ["Keep Both", "Skip", "Cancel"];
              validateTransfer();
              const targetIdentity = existing ? project.operationIdentity(destination) : "";
              const answer = await dialog.showMessageBox(window, {
                message: `Destination occupied: ${destination}`,
                detail: dirty.length
                  ? `Unsaved destination blocks Replace. Save or discard ordinarily before retrying.\n${dirty.map((d) => d.path).join("\n")}`
                  : replace
                    ? "Replace moves the existing clean disk file to macOS Trash before transferring. A failed transfer can leave that file in Trash."
                    : "Folder/type conflicts cannot merge or replace trees.",
                buttons,
                defaultId: buttons.length - 1,
                cancelId: buttons.length - 1,
              });
              check();
              const choice = buttons[answer.response];
              if (choice === "Cancel") {
                results.push({
                  source: sourceLabel,
                  applied: false,
                  message: "Cancelled; remaining references retained.",
                });
                break;
              }
              if (choice === "Open affected files") {
                open.push(...dirty.map((d) => d.path));
                break;
              }
              if (choice === "Skip") {
                results.push({
                  source: sourceLabel,
                  applied: false,
                  message: "Skipped; reference retained.",
                });
                continue;
              }
              if (choice === "Keep Both") destination = free();
              else {
                const latest = await workspace.read();
                if (
                  latest.drafts.some(
                    (d) => d.root === project.root && affected(folded(d.path), folded(destination)),
                  )
                )
                  throw Error("Destination became dirty. Save/discard before retrying.");
                if (project.operationIdentity(destination) !== targetIdentity)
                  throw Error("Destination changed after consent.");
                protect(destination);
                const removed = await operations.run(project, "trash", destination, "", () => {
                  validateTransfer();
                  if (project.operationIdentity(destination) !== targetIdentity)
                    throw Error("Destination changed after consent.");
                });
                results.push({ source: destination, ...removed });
                if (removed.persistencePending) break;
                await operations.ack();
              }
            }
            project.validateName(basename(destination));
            protect(destination);
            check();
            const result = await operations.run(
              project,
              kind,
              source,
              destination,
              validateTransfer,
              entry instanceof NativeImport ? entry : undefined,
            );
            results.push({ source: sourceLabel, ...result });
            if (result.applied && !nativeEntries && !dragging && reference?.cut)
              reference.entries = reference.entries.filter((e) => e !== entry);
            if (result.persistencePending) break;
            try {
              await operations.ack();
            } catch (error) {
              result.persistencePending = true;
              results[results.length - 1].message +=
                ` Journal acknowledgement failed: ${String(error)}`;
              break;
            }
          } catch (error) {
            results.push({
              source: sourceLabel,
              applied: false,
              message: `${destination || source}: ${String(error)}`,
            });
          }
        }
        return {
          results,
          open,
          requiresAck: operations.hasBatchFacts(project.root),
          message:
            results
              .map(
                (r) =>
                  `${r.source.startsWith("/") ? r.source : project.root + "/" + r.source}: ${r.message}`,
              )
              .join("\n") || "No transfer completed. Available edits retained.",
        };
      } finally {
        nativeEntries?.forEach((e) => e.close());
        operations.releaseEmptyBatch();
        mutationOrigin = undefined;
      }
    }
    if (
      operation === "create-entry" &&
      args.length === 3 &&
      args.every((a) => typeof a === "string")
    ) {
      if (mutationOrigin || quitting) throw Error("File operation unavailable.");
      operations.assertIdle();
      const [parent, name, kind] = args as [string, string, "file" | "folder"];
      project.validateName(name);
      const absolute = resolve(project.root, parent, name);
      if (
        isAppState(absolute) ||
        stateFiles.some((file) =>
          [absolute, ...(parent ? [resolve(project.root, parent)] : [])].some((path) =>
            affected(file.normalize("NFC").toLowerCase(), path.normalize("NFC").toLowerCase()),
          ),
        )
      )
        throw Error("Protected app state is inside this operation.");
      const owner = projectSessions.get(identity);
      const state = await workspace.read();
      if (
        state.drafts.some(
          (d) =>
            d.root === project.root &&
            affected(
              d.path.normalize("NFC").toLowerCase(),
              (parent ? parent + "/" + name : name).normalize("NFC").toLowerCase(),
            ),
        )
      )
        throw Error("Destination recovery drafts need preserving. Choose a free name.");
      if (
        mutationOrigin ||
        quitting ||
        !projects.has(project.root) ||
        !owner ||
        projectSessions.get(identity) !== owner
      )
        throw Error("Originating project closed or operation pending.");
      operations.assertIdle();
      return project.create(parent, name, kind);
    }
    if (
      operation === "trash-selection" &&
      args.length === 1 &&
      Array.isArray(args[0]) &&
      args[0].length > 0 &&
      args[0].length <= 10000 &&
      args[0].every((path) => typeof path === "string")
    ) {
      if (mutationOrigin) throw Error("Another file operation is pending.");
      mutationOrigin = project.root;
      try {
        operations.beginBatch(project.root);
        const owner = projectSessions.get(identity);
        const checkOrigin = () => {
          if (
            !owner ||
            projectSessions.get(identity) !== owner ||
            quitting ||
            projects.get(project.root) !== project
          )
            throw Error("Originating project unavailable or app quitting.");
        };
        // Only validated native identities grant authority; hidden selection is still input.
        const paths = [...new Set(args[0] as string[])];
        const entries = paths
          .map((source) => {
            try {
              const absolute = resolve(project.root, source);
              if (
                isAppState(absolute) ||
                stateFiles.some((file) =>
                  affected(
                    file.normalize("NFC").toLowerCase(),
                    absolute.normalize("NFC").toLowerCase(),
                  ),
                )
              )
                throw Error("Protected app state is inside this operation.");
              return {
                source,
                identity: project.operationIdentity(source),
                directory: statSync(absolute).isDirectory(),
                error: "",
              };
            } catch (error) {
              return { source, identity: "", directory: false, error: String(error) };
            }
          })
          .filter(
            (entry, _, all) =>
              !all.some(
                (parent) =>
                  parent !== entry &&
                  parent.directory &&
                  !parent.error &&
                  affected(entry.source, parent.source),
              ),
          );
        const state = await workspace.read();
        const dirty = state.drafts.filter(
          (d) => d.root === project.root && entries.some((entry) => affected(d.path, entry.source)),
        );
        const answer = await dialog.showMessageBox(window, {
          message: `Move ${entries.length} item${entries.length === 1 ? "" : "s"} to macOS Trash?`,
          detail:
            entries.map((e) => `${project.root}/${e.source}`).join("\n") +
            `\nDirty descendants (${dirty.length}): ${dirty.map((d) => project.root + "/" + d.path).join(", ") || "None"}\nDisk files can be recovered in Finder Trash.`,
          buttons: dirty.length
            ? ["Save and Move to Trash", "Discard and Move to Trash", "Cancel"]
            : ["Move to Trash", "Cancel"],
          defaultId: dirty.length ? 2 : 1,
          cancelId: dirty.length ? 2 : 1,
        });
        if (answer.response !== 0 && !(dirty.length && answer.response === 1))
          return {
            results: [],
            saves: [],
            requiresAck: false,
            message: "Cancelled; edits retained.",
          };
        const results: import("./file-operations").TrashResult[] = [];
        const saves: import("./file-operations").SavedFile[] = [];
        for (const entry of entries) {
          const { source } = entry;
          try {
            checkOrigin();
            if (entry.error) throw Error(entry.error);
            const check = () => {
              checkOrigin();
              if (project.operationIdentity(source) !== entry.identity)
                throw Error("Source changed after confirmation. Refresh and inspect actual paths.");
            };
            check();
            if (dirty.length && answer.response === 0) {
              let conflicted = false;
              for (const d of dirty.filter((d) => affected(d.path, source))) {
                check();
                const saved = await operations.save(project, d.path, d.text, d.disk.version, check);
                if (saved.kind !== "saved") {
                  results.push({
                    source,
                    applied: false,
                    message: `Save conflict: ${d.path}. Edits retained; resolve the conflict before retrying Trash.`,
                    conflict: { path: d.path, disk: saved.disk },
                  });
                  conflicted = true;
                  break;
                }
                saves.push({ path: d.path, disk: saved.disk });
                if (saved.persistencePending) {
                  results.push({
                    source,
                    applied: false,
                    persistencePending: true,
                    message: saved.message!,
                  });
                  conflicted = true;
                  break;
                }
                if (d.path === source) entry.identity = project.operationIdentity(source);
              }
              if (conflicted) continue;
            }
            const result = await operations.run(project, "trash", source, "", check);
            // A fully persisted item can release the shared journal for the next item.
            if (!result.persistencePending) {
              try {
                await operations.ack();
              } catch (error) {
                result.persistencePending = true;
                result.message += ` Recovery journal needs retry: ${String(error)}`;
              }
            }
            results.push({ source, ...result });
          } catch (error) {
            results.push({ source, applied: false, message: String(error) });
          }
        }
        return {
          results,
          saves,
          requiresAck: operations.hasBatchFacts(project.root),
          message: [
            ...saves.map((saved) => `${project.root}/${saved.path}: Saved.`),
            ...results.map((r) => `${project.root}/${r.source}: ${r.message}`),
          ].join("\n"),
        };
      } finally {
        operations.releaseEmptyBatch();
        mutationOrigin = undefined;
      }
    }
    if (operation === "save") {
      if (mutationOrigin) throw Error("File operation awaiting confirmation.");
      operations.assertIdle();
    }
    if (
      operation === "file-operation" &&
      args.length === 3 &&
      args.every((a) => typeof a === "string") &&
      ["move", "rename"].includes(args[0] as string)
    ) {
      if (mutationOrigin) throw Error("Another file operation is pending.");
      mutationOrigin = project.root;
      try {
        const [action, source, target] = args as ["move" | "rename", string, string];
        const kind = action === "rename" ? "move" : action;
        const destination =
          action === "rename" ? project.renameDestination(source, target) : target;
        operations.assertIdle();
        const owner = projectSessions.get(identity);
        const originalIdentity = project.operationIdentity(source);
        const check = () => {
          if (!owner || projectSessions.get(identity) !== owner || quitting)
            throw Error("Originating project unavailable or app quitting.");
          for (const path of [source, ...(kind === "move" ? [destination] : [])]) {
            const absolute = resolve(project.root, path);
            if (
              isAppState(absolute) ||
              stateFiles.some((file) => affected(file.toLowerCase(), absolute.toLowerCase()))
            )
              throw Error("Protected app state is inside this operation.");
          }
          if (project.operationIdentity(source) !== originalIdentity)
            throw Error(
              "Source changed after confirmation. Edits retained; retry after inspecting actual paths.",
            );
        };
        check();
        return await operations.run(project, kind, source, destination, check);
      } finally {
        mutationOrigin = undefined;
      }
    }
    const managedRoot = join(app.getPath("userData"), "worktrees");
    if (operation === "worktree-managed" && !args.length)
      return project.managedWorktrees(managedRoot);
    if (operation === "worktree-remove" && args.length === 1 && typeof args[0] === "string") {
      const root = args[0];
      removing.add(identity);
      try {
        const linked = (await chats.list(identity)).filter((c) => c.checkout === root);
        const check = async () => {
          const state = await workspace.read();
          if (state.drafts.some((d) => d.root === root))
            throw Error(
              "Unsaved buffers or recovery drafts need this checkout. Save or discard them first.",
            );
          if (linked.some((c) => chats.checkoutActive(identity, c.id)))
            throw Error("Stop linked agents before removal.");
          return project.removalCheck(managedRoot, root);
        };
        const before = await check();
        const answer = await dialog.showMessageBox(window, {
          message: "Remove managed worktree?",
          detail: `Path: ${root}\nRetained branch: ${before.branch}\nAffected chats: ${linked.map((c) => c.id).join(", ") || "None"}\nBranches, commits and chat history are retained. Linked chats become unavailable.`,
          buttons: ["Remove worktree", "Cancel"],
          defaultId: 1,
          cancelId: 1,
        });
        if (answer.response !== 0) return false;
        await check();
        // Persist intent for every chat before any destructive operation.
        await Promise.all(linked.map((c) => chats.markUnavailable(identity, c.id)));
        await check();
        project.removeWorktree(managedRoot, root, before.commit);
        projects.get(root)?.close();
        projects.delete(root);
        return true;
      } catch (error) {
        throw Error(
          `Removal did not complete. Inspect ${root}; uncertain leftovers are retained. Retry revalidates all checks. ${String(error)}`,
        );
      } finally {
        removing.delete(identity);
      }
    }
    if (operation === "worktree-options" && !args.length) return project.worktreeOptions();
    if (operation === "status" && !args.length) return project.status();
    if (
      operation === "entry-action" &&
      args.length === 2 &&
      typeof args[0] === "string" &&
      ["copy-path", "copy-relative", "finder"].includes(String(args[1]))
    ) {
      if (args[0]) protect(args[0]);
      else if (isAppState(project.root)) throw Error("App state is unavailable in Files.");
      const location = project.entryLocation(args[0]);
      if (args[1] === "finder") shell.showItemInFolder(location);
      else
        await clipboard.write([
          new ClipboardItem({
            "text/plain": args[1] === "copy-relative" ? args[0] || "." : location,
          }),
        ]);
      return;
    }
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
    if (operation === "resolveSend" && args.length === 2) {
      const [root, id] = args;
      if ((root !== null && typeof root !== "string") || typeof id !== "string") throw Error("Invalid chat");
      await authorizeHistory(root, id);
      const result = await dialog.showMessageBox(window, {
        type: "warning", buttons: ["Cancel", "I inspected history; allow a new Send"], defaultId: 0, cancelId: 0,
        message: "Resolve the previous Send locally?",
        detail: "Inspect reloaded provider history first. The previous command receipt remains on the host. This only releases this composer's pending identity; it does not resend or undo any work. Your text stays available. A later explicit Send may repeat effects if the previous result remains uncertain.",
      });
      return result.response === 1;
    }
    if (operation === "targets" && !args.length) {
      const state = await workspace.read();
      const approved = await workspace.approved();
      const saved = [...(state.savedProjects ?? []), ...state.projects, ...approved];
      const unique = [...new Map(saved.map((p) => [p.project, p])).values()];
      for (const p of unique)
        if (approved.some((a) => a.project === p.project))
          projectSessions.set(p.project, projectSessions.get(p.project) ?? {});
      const targets: { project: string | null; checkout: string }[] = unique.map((p) => ({
        project: p.project,
        checkout: state.views[p.project]?.checkout ?? p.root,
      }));
      if ((await store.all()).some((c) => c.project === null))
        targets.push({ project: null, checkout: "" });
      return targets;
    }
    const root = args.shift();
    if (root !== null && typeof root !== "string") throw Error("Invalid project");
    const owner = root === null ? undefined : projectSessions.get(root);
    const requireOpen = () => {
      if (quitting) throw Error("App is quitting.");
      if (root === null) return;
      if (removing.has(root)) throw Error("Worktree removal is in progress. Retry afterward.");
      if (!owner || projectSessions.get(root) !== owner || quitting)
        throw Error("Open this project first. Use Open project… to approve its saved directory.");
    };
    requireOpen();

    if (root !== null && operation === "create" && args.length === 1) {
      const target = await checkout(args[0]);
      requireOpen();
      if (!target.validateRepository().includes(target.root))
        throw Error("Checkout is no longer registered with Git.");
      if (target.repository() !== root) throw Error("Checkout belongs to another project.");
      return chats.create(root, target.root);
    }
    const [id] = args;
    if (typeof id !== "string" || id.length > 100) throw Error("Invalid chat identity");
    await chats.list(root).then((list) => {
      if (!list.some((c) => c.id === id)) throw Error("Unknown project/chat");
    });
    requireOpen();
    if (args.length === 1 && operation === "disconnect") return chats.disconnect(root, id);
    throw Error("Invalid chat request");
  });
  void window.loadURL(documentURL);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
