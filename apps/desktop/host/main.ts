import { app, BrowserWindow, ipcMain, session, dialog } from "electron";
import { join, resolve } from "node:path";
import { mkdirSync, realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { toolStatus } from "./tools";
import { Chats } from "./chat";
import { ChatService } from "./chat-service";
import { Workspace } from "./workspace";
import { Project } from "./project";
import { FileOperations } from "./file-operations";
import { affected } from "./file-operation-state";
const developmentOrigin = /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.ESCODE_DEV_URL ?? "")
  ? process.env.ESCODE_DEV_URL!
  : "http://127.0.0.1:5173";
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
            ? `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${developmentOrigin.replace("http:", "ws:")}; worker-src 'self' blob:; font-src 'self' data:`
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
  const projectSessions = new Map<string, object>();
  const unapprovedProjects = new Set<string>();
  const closingProjects = new Set<string>();
  const removing = new Set<string>();
  let quitting = false;
  let mutationOrigin: string | undefined;
  const workspace = new Workspace(join(app.getPath("userData"), "workspace.json"));
  const operations = new FileOperations(
    workspace,
    join(app.getPath("userData"), "file-operation.json"),
  );
  mkdirSync(app.getPath("userData"), { recursive: true, mode: 0o700 });
  const stateFiles = [
    "workspace.json",
    "approved-projects.json",
    "chats.json",
    "file-operation.json",
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
      const approved = await workspace.approved();
      // Saved registration survives editor closure. Approvals are host-owned authority.
      state.savedProjects ??= [...state.projects];
      const historical = (await store.all()).map((c) => ({ project: c.project, root: c.project }));
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
      if (operations.busy)
        throw Error("File operation is persisting recovery intent. Retry after completion.");
      return workspace.write(args[0]);
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
      if (project === undefined) quitting = true;
      else closingProjects.add(project as string);
      try {
        await chats.shutdown(project as string | undefined);
        if (project === undefined) {
          mayClose = true;
          app.quit();
        } else {
          projectSessions.delete(project as string);
          unapprovedProjects.delete(project as string);
          for (const [root, p] of projects)
            if (p.repository() === project) {
              p.close();
              projects.delete(root);
            }
        }
      } catch (error) {
        quitting = false;
        throw error;
      } finally {
        if (typeof project === "string") closingProjects.delete(project);
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
    const associations = await Promise.all([...projectSessions.keys()].map((id) => store.list(id)));
    const saved = associations.flat().find((c) => c.checkout === root && !c.removed);
    const candidate = saved
      ? await Project.restore(root, saved.project, helper)
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
    const requestedRoot = args.shift();
    if (
      ["file-operation", "file-operation-ack"].includes(String(operation)) &&
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
    if (removing.has(identity)) throw Error("Worktree removal is in progress. Retry afterward.");
    if (operation === "file-operation-ack" && !args.length) return operations.ack(project.root);
    if (operation === "save") {
      if (mutationOrigin) throw Error("File operation awaiting confirmation.");
      operations.assertIdle();
    }
    if (
      operation === "file-operation" &&
      args.length === 3 &&
      args.every((a) => typeof a === "string") &&
      ["move", "trash"].includes(args[0] as string)
    ) {
      if (mutationOrigin) throw Error("Another file operation is pending.");
      mutationOrigin = project.root;
      try {
        const [kind, source, destination] = args as ["move" | "trash", string, string];
        operations.assertIdle();
        const owner = projectSessions.get(identity);
        let originalIdentity = project.operationIdentity(source);
        const check = () => {
          if (
            !owner ||
            projectSessions.get(identity) !== owner ||
            quitting ||
            closingProjects.has(identity)
          )
            throw Error("Originating project closed.");
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
        if (kind === "trash") {
          const state = await workspace.read();
          const dirty = state.drafts.filter(
            (d) => d.root === project.root && affected(d.path, source),
          );
          const answer = await dialog.showMessageBox(window, {
            message: "Move 1 item to macOS Trash?",
            detail: `${project.root}/${source}\nDirty descendants (${dirty.length}): ${dirty.map((d) => d.path).join(", ") || "None"}\nDisk files can be recovered in Finder Trash.`,
            buttons: dirty.length
              ? ["Save and Move to Trash", "Discard and Move to Trash", "Cancel"]
              : ["Move to Trash", "Cancel"],
            defaultId: dirty.length ? 2 : 1,
            cancelId: dirty.length ? 2 : 1,
          });
          if (answer.response === (dirty.length ? 2 : 1))
            return { applied: false, message: "Cancelled; edits retained." };
          if (dirty.length && answer.response === 0) {
            for (const d of dirty) {
              check();
              const saved = await project.save(d.path, d.text, d.disk.version);
              if (saved.kind !== "saved")
                throw Error(
                  `Save conflict: ${d.path}. Trash cancelled; edits retained. Open the file to resolve its save conflict.`,
                );
              // Explicit save atomically replaces a file's inode; folders keep their identity.
              if (d.path === source) originalIdentity = project.operationIdentity(source);
            }
          }
          check();
        }
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
    if (operation === "files" && args.length === 1 && typeof args[0] === "string") {
      const protectedPath = (path: string) => {
        const absolute = resolve(project.root, path);
        return isAppState(absolute) || stateFiles.some((file) => file.startsWith(absolute + "/"));
      };
      if (args[0] && protectedPath(args[0])) throw Error("App state is unavailable in Files.");
      return (await project.files(args[0])).filter((entry) => !protectedPath(entry.path));
    }
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
    if (operation === "catalogue" && !args.length) {
      const state = await workspace.read();
      const approved = await workspace.approved();
      const saved = [...(state.savedProjects ?? []), ...state.projects, ...approved];
      for (const item of saved)
        if (approved.some((p) => p.project === item.project && p.root === item.root))
          projectSessions.set(item.project, projectSessions.get(item.project) ?? {});
      return (await store.all()).filter((c) => saved.some((p) => p.project === c.project));
    }
    const root = args.shift();
    if (typeof root !== "string") throw Error("Invalid project");
    if (operation === "list" && !args.length) {
      const state = await workspace.read();
      const approved = await workspace.approved();
      if (
        ![...state.projects, ...(state.savedProjects ?? []), ...approved].some(
          (p) => p.project === root,
        ) &&
        !projectSessions.has(root)
      )
        throw Error("Unknown saved project");
      return chats.list(root);
    }
    const owner = projectSessions.get(root);
    const requireOpen = () => {
      if (removing.has(root)) throw Error("Worktree removal is in progress. Retry afterward.");
      if (!owner || projectSessions.get(root) !== owner || quitting || closingProjects.has(root))
        throw Error("Open this project first. Use Open project… to approve its saved directory.");
    };
    requireOpen();
    if (operation === "list" && !args.length) return chats.list(root);
    if (operation === "create" && args.length === 1) {
      const target = await checkout(args[0]);
      requireOpen();
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
    requireOpen();
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
