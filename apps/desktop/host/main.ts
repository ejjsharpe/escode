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
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { startDirectoryHost } from "@escode/host";
import { FoundationState } from "./foundation-state";
import { pathToFileURL } from "node:url";
import { draftSettings, toolStatus } from "./tools";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
import { Workspace } from "./workspace";
import { Project } from "./project";
import { createFileWorkflow } from "./file-workflow";
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
  const workspace = new Workspace(join(app.getPath("userData"), "client-workspace-v1.json"), foundation.read());
  const files = createFileWorkflow({
    userData: app.getPath("userData"), workspace, foundation, projects, projectSessions, removing,
    checkout: root => checkout(root), isQuitting: () => quitting,
    showMessageBox: options => dialog.showMessageBox(window, options), clipboard,
    writeClipboard: data => clipboard.write([new ClipboardItem(data)]),
  });
  const { isAppState, clearImports } = files;
  window.webContents.on("did-start-navigation", clearImports);
  window.webContents.on("render-process-gone", clearImports);
  const expiry = setInterval(files.expireImports, 10000);
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
    return files.captureNativeImport(paths);
  });
  ipcMain.handle("native-clipboard-capture", async (event) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== documentURL) throw Error("Invalid sender");
    return files.captureNativeClipboard();
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
      const recovery = await files.recover();
      if (recovery) errors.push(recovery);
      // Recovery changes drafts/paths on disk; registration was derived in memory above.
      return {
        state: { ...(await workspace.read()), savedProjects: state.savedProjects },
        restored,
        errors,
      };
    }
    if (operation === "persist" && args.length === 1) {
      return files.persist(args[0]);
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
    if (operation === "flushClientStorage" && !args.length) {
      // Electron requests a flush without a completion acknowledgement; recovery remains best effort.
      window.webContents.session.flushStorageData();
      return;
    }
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
    if (operation === "createDraft")
      return store.createDraft(root, root === null ? "" : await currentTarget(root), true);
    if (operation === "context") {
      const { id, target, expected } = action;
      if (target !== null && !projectSessions.has(target))
        throw Error("Approve the target using Open project… first.");
      return chats.context(root, id, target, target === null ? "" : await currentTarget(target), undefined,
        async () => { if (await expectedSend(root, id) !== expected) throw Error("Draft changed. Inspect and retry."); });
    }
    if (root !== null && operation === "execution") {
      const { id, mode, value, commit } = action;
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
  const directoryHost = await startDirectoryHost({
    gitStatus: async root => (await checkout(root)).status(),
    worktreeOptions: async root => (await checkout(root)).worktreeOptions(),
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
    createState: () => foundation.admissionEpoch,
    ...files.hostActions,
    ...foundation.read(), origin: dev ? developmentOrigin : "file://",
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
    if (["status", "worktree-options", "diff", "read", "save", "files", "files-filter", "create-entry", "trash-selection", "drag-capture", "clipboard-capture", "transfer"].includes(String(operation))) throw Error("Invalid project request");
    const requestedRoot = args.shift();
    if (
      [
        "entry-action",
        "drag-capture",
        "clipboard-capture",
        "transfer",
      ].includes(String(operation)) &&
      (typeof requestedRoot !== "string" || !projects.has(requestedRoot))
    )
      throw Error("Open and approve this checkout first.");
    const project = await checkout(requestedRoot);
    if (
      ["read", "save"].includes(String(operation)) &&
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
    const protect = (path: string) => files.protectPath(resolve(project.root, path));
    if (operation === "save") {
      files.assertIdle();
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
