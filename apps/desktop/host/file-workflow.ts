import { relative, isAbsolute, join, resolve, dirname, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  MessageBoxOptions,
  MessageBoxReturnValue,
  clipboard as electronClipboard,
} from "electron";
import type { startHost } from "@escode/host";
import { maximumFrameBytes, type DirectoryResult } from "@escode/contracts";
import { DurableFiles } from "./durable-files";
import { NativeImport } from "./native-import";
import { FileOperations } from "./file-operations";
import { affected } from "./file-operation-state";
import { Checkout, limit } from "./project";
import type { Workspace } from "./workspace";

type HostOptions = Parameters<typeof startHost>[0];
type FileActions = Pick<
  HostOptions,
  "observeFiles" | "searchFiles" | "lookupFile" | "createEntry" | "readDiff" | "readFile" | "saveFile" | "watch" | "list"
>;

export function createFileWorkflow({
  userData,
  workspace,
  admissionEpoch,
  projects,
  projectSessions,
  removing,
  checkout,
  isQuitting,
  showMessageBox,
  clipboard,
  writeClipboard,
}: {
  userData: string;
  workspace: Workspace;
  admissionEpoch: string;
  projects: Map<string, Checkout>;
  projectSessions: Map<string, object>;
  removing: Set<string>;
  checkout: (root: unknown) => Promise<Checkout>;
  isQuitting: () => boolean;
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
  clipboard: Pick<typeof electronClipboard, "read">;
  writeClipboard: (data: Record<string, string>) => Promise<void>;
}) {
  const commands = new DurableFiles(workspace.database, workspace.owner.clientId, admissionEpoch);
  let mutationOrigin: string | undefined;
  const operations = new FileOperations(
    workspace,
    join(userData, "client-file-operation-v1.json"),
    workspace.owner,
  );
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const stateFiles = [
    "durable-chats-v1.sqlite-state-v1/state.sqlite",
    "durable-chats-v1.sqlite-state-v1/state.sqlite-wal",
    "durable-chats-v1.sqlite-state-v1/state.sqlite-shm",
    "durable-chats-v1.sqlite-state-v1.established",
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
    .map((name) => join(realpathSync(userData), name));
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
  const protectImport = (path: string, operation = "import") => {
    if (
      isAppState(path) ||
      stateFiles.some((file) =>
        affected(file.normalize("NFC").toLowerCase(), path.normalize("NFC").toLowerCase()),
      )
    )
      throw Error(`Protected app state is inside this ${operation}.`);
  };
  const captureImport = (paths: string[]) => {
    if (imports.size >= 16)
      throw Error("Too many pending native imports. Wait for references to expire.");
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
  const fileContext = async (root: string, path: string) => {
    if (!projects.has(root)) throw Error("Open and approve this checkout first.");
    const project = await checkout(root),
      identity = project.repositoryGit.repository(),
      owner = projectSessions.get(identity);
    const check = () => {
      if (
        !owner ||
        projectSessions.get(identity) !== owner ||
        projects.get(root) !== project ||
        isQuitting() ||
        removing.has(identity)
      )
        throw Error("Originating project unavailable or app quitting.");
      if (isAppState(resolve(root, path)))
        throw Error("App state is unavailable through project file operations.");
      project.checkoutIdentity();
    };
    check();
    return { project, check };
  };
  async function approvedFiles(root: string) {
    if (!projects.has(root)) throw Error("Open and approve this checkout first.");
    const project = await checkout(root);
    if (removing.has(project.repositoryGit.repository()) || isQuitting()) throw Error("Project unavailable.");
    return project;
  }
  async function moveEntry({
    root,
    action,
    source,
    target,
  }: import("@escode/contracts").MoveEntry) {
    const project = await approvedFiles(root);
    const identity = project.repositoryGit.repository();
    if (mutationOrigin) throw Error("Another file operation is pending.");
    mutationOrigin = project.root;
    try {
      const destination = action === "rename" ? project.renameDestination(source, target) : target;
      operations.assertIdle();
      const owner = projectSessions.get(identity);
      const originalIdentity = project.operationIdentity(source);
      const check = () => {
        if (!owner || projectSessions.get(identity) !== owner || isQuitting())
          throw Error("Originating project unavailable or app quitting.");
        for (const path of [source, destination]) {
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
      return await operations.run(project, "move", source, destination, check);
    } finally {
      mutationOrigin = undefined;
    }
  }
  async function ackFileOperation(root: string) {
    const project = await approvedFiles(root);
    if (mutationOrigin) throw Error("File operation is still delivering results.");
    await operations.ack(project.root);
  }
  const trashEntries = async (root: string, selection: readonly string[]) => {
    const { project, check } = await fileContext(root, "");
    check();
    const identity = project.repositoryGit.repository();
    if (mutationOrigin) throw Error("Another file operation is pending.");
    mutationOrigin = project.root;
    try {
      operations.beginBatch(project.root);
      const owner = projectSessions.get(identity);
      const checkoutIdentity = project.checkoutIdentity();
      const checkOrigin = () => {
        if (project.checkoutIdentity() !== checkoutIdentity || removing.has(identity))
          throw Error("Originating checkout unavailable.");
        if (
          !owner ||
          projectSessions.get(identity) !== owner ||
          isQuitting() ||
          projects.get(project.root) !== project
        )
          throw Error("Originating project unavailable or app quitting.");
      };
      // Only validated native identities grant authority; hidden selection is still input.
      const paths = [...new Set(selection)];
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
      const answer = await showMessageBox({
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
  };
  async function transferAction(action: import("@escode/contracts").TransferAction) {
    const { root, operation, paths } = action;
    const project = await approvedFiles(root);
    const identity = project.repositoryGit.repository();
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
    if (operation === "drag-capture") {
      operations.assertIdle();
      fileDrag = {
        token: randomUUID(),
        root: project.root,
        checkout: project.checkoutIdentity(),
        cut: false,
        entries: capture([...paths]),
      };
      return fileDrag.token;
    }
    if (action.operation === "clipboard-capture") {
      operations.assertIdle();
      fileClipboard = {
        token: randomUUID(),
        root: project.root,
        checkout: project.checkoutIdentity(),
        cut: action.kind === "cut",
        entries: capture([...paths]),
      };
      await writeClipboard({ [clipboardFormat]: fileClipboard.token });
      return `${fileClipboard.cut ? "Cut" : "Copied references for"} ${fileClipboard.entries.length} item(s). Paste within this checkout.`;
    }
    if (action.operation === "transfer") {
      if (mutationOrigin) throw Error("Another file operation is pending.");
      const duplicate = action.kind === "duplicate";
      const dragging = action.kind === "drag-move" || action.kind === "drag-copy";
      let nativeEntries: NativeImport[] | undefined;
      const nativeDrop = action.kind === "import";
      const reference = duplicate ? undefined : dragging ? fileDrag : fileClipboard;
      const item =
        duplicate || dragging || nativeDrop
          ? undefined
          : (await clipboard.read()).find((item) => item.types.includes(clipboardFormat));
      const token = dragging
        ? paths[0]
        : item
          ? await (await item.getType(clipboardFormat)).text()
          : "";
      if (nativeDrop) {
        const captured = imports.get(String(paths[0]));
        if (!captured || captured.expires < Date.now())
          throw Error("Native references expired. Drop again.");
        imports.delete(String(paths[0]));
        nativeEntries = captured.entries;
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
      const entries = nativeEntries ?? (duplicate ? capture([...paths]) : [...reference!.entries]);
      if (dragging) fileDrag = undefined;
      const parent = action.parent;
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
          isQuitting()
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
        if (action.kind === "drag-move") {
          check();
          const answer = await showMessageBox({
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
              !nativeEntries && (action.kind === "drag-move" || (!dragging && reference?.cut))
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
              const answer = await showMessageBox({
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
    throw Error("Invalid transfer request");
  }
  const actions: FileActions = {
    createEntry: async (command) => {
      const { root, parent, name, kind } = command;
      const { project, check } = await fileContext(root, parent);
      return commands.run({ ...command, checkoutIdentity: project.checkoutIdentity() }, { command, status: "uncertain" as const, path: parent ? parent + "/" + name : name, message: "Creation outcome uncertain; inspect exact path. Creation was not repeated." }, async (): Promise<typeof import("@escode/contracts").CreateReceipt.Type> => {
        if (mutationOrigin || isQuitting()) throw Error("File operation unavailable.");
        operations.assertIdle();
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
        check();
        if (mutationOrigin) throw Error("File operation awaiting confirmation.");
        operations.assertIdle();
        const destination = parent ? parent + "/" + name : name;
        const identity = () => {
          try {
            return project.operationIdentity(destination);
          } catch {
            return "";
          }
        };
        const before = identity();
        try {
          return { command, status: "accepted", path: project.create(parent, name, kind), message: "" };
        } catch (error) {
          return { command, status: before && identity() === before ? "rejected" : "uncertain", path: destination, message: String(error) };
        }
      });
    },
    readDiff: async (root, path, area) => {
      const { project, check } = await fileContext(root, path);
      const result = await project.diff({ path, area });
      check();
      return result;
    },
    observeFiles: (root, notify) => {
      const project = projects.get(root);
      if (!project) throw Error("Open and approve this checkout first.");
      const identity = project.repositoryGit.repository(), session = projectSessions.get(identity);
      if (!session || isQuitting() || removing.has(identity)) throw Error("Project session closed.");
      if (isAppState(root) || stateFiles.some(file => file.startsWith(root + "/"))) throw Error("App state is unavailable in Files.");
      return project.observeFiles(error => {
        if (projects.get(root) !== project || projectSessions.get(identity) !== session || isQuitting() || removing.has(identity))
          notify("Originating project unavailable or app quitting.");
        else notify(error);
      });
    },
    searchFiles: async (root, query, signal, history) => {
      const { project, check } = await fileContext(root, "");
      const result = await project.discover(query, signal, history);
      check();
      return result;
    },
    lookupFile: async (root, query) => {
      if (typeof root !== "string" || root.length > 4096 || typeof query !== "string" ||
          !query || query.length > 4096 || query.includes("\0") || query.split("/").includes(".."))
        throw Error("Enter an exact file path of at most 4096 characters without traversal.");
      const path = relative(root, resolve(root, query));
      if (!path || isAbsolute(path) || path.startsWith("../")) throw Error("Path outside active checkout.");
      const { project, check } = await fileContext(root, path);
      await project.read(path);
      check();
      return path;
    },
    readFile: async (root, path) => {
      const { project } = await fileContext(root, path);
      return project.read(path);
    },
    saveFile: async (root, path, text, version) => {
      if (Buffer.byteLength(text) > limit) throw Error("Invalid save: file exceeds 2 MiB.");
      const { project, check } = await fileContext(root, path);
      if (mutationOrigin) throw Error("File operation awaiting confirmation.");
      return operations.save(project, path, text, version, check);
    },
    watch: (root, paths, notify) => {
      const project = projects.get(root);
      if (!project) throw Error("Open and approve this checkout first.");
      const identity = project.repositoryGit.repository(),
        session = projectSessions.get(identity);
      if (!session || isQuitting() || removing.has(identity))
        throw Error("Project session closed.");
      for (const path of paths) {
        const absolute = resolve(root, path);
        if (isAppState(absolute) || stateFiles.some((file) => file.startsWith(absolute + "/")))
          throw Error("App state is unavailable in Files.");
      }
      return project.watchFiles([...paths], (error) => {
        if (
          projects.get(root) !== project ||
          projectSessions.get(identity) !== session ||
          isQuitting() ||
          removing.has(identity)
        )
          notify("Originating project unavailable or app quitting.");
        else notify(error);
      });
    },
    list: async (root, path): Promise<DirectoryResult> => {
      // Only native-approved, already-open checkouts can reach filesystem adapters.
      if (!projects.has(root))
        return { kind: "denied", message: "Open and approve this checkout first." };
      const project = await checkout(root);
      const identity = project.repositoryGit.repository(),
        owner = projectSessions.get(identity);
      const check = () => {
        if (
          !owner ||
          projectSessions.get(identity) !== owner ||
          projects.get(root) !== project ||
          isQuitting() ||
          removing.has(identity)
        )
          throw Error("Originating project unavailable or app quitting.");
        project.checkoutIdentity();
      };
      const protectedPath = (path: string) => {
        const absolute = resolve(project.root, path);
        return isAppState(absolute) || stateFiles.some((file) => file.startsWith(absolute + "/"));
      };
      if (path && protectedPath(path))
        return { kind: "denied", message: "App state is unavailable in Files." };
      if (
        path &&
        (path.startsWith("/") ||
          path.includes("\0") ||
          path.split("/").some((p) => p === ".." || p.toLowerCase() === ".git"))
      )
        return { kind: "denied", message: "Directory path denied." };
      try {
        check();
        const result = await project.filteredFiles(path);
        check();
        const entries = result.entries.filter((entry) => !protectedPath(entry.path));
        const paths = new Set(entries.map((entry) => entry.path));
        const listing = {
          ...result,
          entries,
          ignored: result.ignored.filter((entry) => paths.has(entry)),
        };
        if (Buffer.byteLength(JSON.stringify(listing)) > maximumFrameBytes / 2)
          return { kind: "overflow", message: "Directory listing exceeds the connection limit." };
        return { kind: "available", listing };
      } catch (error) {
        return { kind: "unavailable", message: String(error) };
      }
    },
  };
  const captureNativeImport = (paths: string[]) => {
    const entries = captureImport(paths);
    const token = randomUUID();
    imports.set(token, { entries, expires: Date.now() + 60000 });
    return token;
  };
  const captureNativeClipboard = async () => {
    const items = await clipboard.read();
    if (items.some((item) => item.types.includes(clipboardFormat))) return null;
    const item = items.find((item) => item.types.includes("text/uri-list"));
    if (!item) return null;
    const paths = (await (await item.getType("text/uri-list")).text())
      .split(/\r?\n/)
      .filter((path) => path && !path.startsWith("#"))
      .map((path) => fileURLToPath(path));
    return captureNativeImport(paths);
  };
  const expireImports = () => {
    for (const [token, value] of imports)
      if (Date.now() > value.expires) {
        value.entries.forEach((e) => e.close());
        imports.delete(token);
      }
  };
  return {
    hostActions: { ...actions, transferAction: async (action: import("@escode/contracts").TransferAction) => action.operation === "transfer"
      ? commands.run({ ...action, checkoutIdentity: (await approvedFiles(action.root)).checkoutIdentity() }, { results: [], open: [], requiresAck: false, message: "Transfer outcome uncertain; inspect exact targets. Transfer was not repeated." }, () => transferAction(action))
      : transferAction(action), trashEntries, moveEntry, ackFileOperation },
    captureNativeImport,
    captureNativeClipboard,
    clearImports,
    expireImports,
    isAppState,
    protectPath: (path: string) => protectImport(path, "operation"),
    recover: () => operations.recover(checkout),
    acknowledgementRoots: () => operations.acknowledgementRoots(),
    persist: (state: unknown) => operations.persist(state),
  };
}
