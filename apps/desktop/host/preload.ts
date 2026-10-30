import { Schema } from "effect";
import { SendReceipt } from "@escode/contracts";
import { createDirectoryClient } from "@escode/client-runtime";
import { contextBridge, ipcRenderer, webUtils } from "electron";
type ProjectArguments =
  | ["drag-capture" | "trash-selection", string, string[]]
  | ["clipboard-capture", string, "copy" | "cut", string[]]
  | ["transfer", string, "paste" | "duplicate" | "drag-move" | "drag-copy" | "import", string, string[]]
  | ["file-operation", string, "move" | "rename", string, string]
  | ["create-entry", string, string, string, "file" | "folder"]
  | ["file-operation-ack" | "worktree-managed" | "worktree-options" | "status", string]
  | ["worktree-remove" | "read", string, string]
  | ["open"]
  | ["entry-action", string, string, "copy-path" | "copy-relative" | "finder"]
  | ["save", string, string, string, string]
  | ["diff", string, string, "staged" | "unstaged" | "untracked"];
type ChatArguments =
  | [operation: "createDraft", project: string | null]
  | [operation: "context", project: string | null, id: string, target: string | null]
  | [operation: "execution", project: string, id: string, mode: "new" | "reuse", value: string, commit: string]
  | [operation: "targets"]
  | [operation: "create", project: string, checkout: string]
  | [operation: "open" | "composer" | "disconnect" | "resolveSend", project: string | null, id: string]
  | [operation: "send" | "draft", project: string | null, id: string, text: string]
  | [operation: "stop", project: string | null, id: string, target?: string]
  | [operation: "answer", project: string | null, id: string, token: string, answer: unknown];
const directories = createDirectoryClient(() => ipcRenderer.invoke("local-bootstrap"), reconcile);
async function createEntry(root: string, parent: string, name: string, kind: "file" | "folder") {
  const key = `escode-create:${JSON.stringify([root, parent, name, kind])}`;
  const saved = localStorage.getItem(key);
  const command = saved ? JSON.parse(saved) : { commandId: crypto.randomUUID(), admissionEpoch: await directories.createState(), root, parent, name, kind };
  localStorage.setItem(key, JSON.stringify(command));
  const receipt = await directories.createEntry(command);
  if (receipt.status === "accepted" || receipt.status === "rejected") localStorage.removeItem(key);
  if (receipt.status !== "accepted") throw Error(receipt.message);
  return receipt.path;
}
async function reconcile(project: string | null, id: string) {
  const saved = localStorage.getItem(`escode-send:${JSON.stringify([project, id])}`);
  if (saved) {
    const command = JSON.parse(saved);
    const receipt = await directories.sendStatus(command.commandId);
    if (receipt?.status === "admitted" || receipt?.status === "dispatching") return;
    await directories.chatHistory(project, id, null);
    if (!receipt || receipt.status !== "accepted")
      return `Previous Send ${receipt?.status ?? "unavailable or expired"}; identity and text retained. Review history before Resolve previous Send…`;
  }
}
async function open(project: string | null, id: string) {
  const detail = await directories.openChat(project, id);
  await reconcile(project, id);
  return detail;
}
async function send(project: string | null, id: string, text: string) {
  const key = `escode-send:${JSON.stringify([project, id])}`;
  const saved = localStorage.getItem(key);
  let command;
  let result;
  if (saved) {
    command = JSON.parse(saved);
    result = await directories.sendStatus(command.commandId);
  } else {
    const state = await directories.sendState(project, id);
    command = { ...state, commandId: crypto.randomUUID(), project, id, text };
    localStorage.setItem(key, JSON.stringify(command));
    result = await directories.sendMessage(command);
  }
  if (result === null) throw Error("Send status unavailable; identity and text retained. Inspect history, then Resolve previous Send…");
  const receipt = Schema.decodeUnknownSync(SendReceipt)(result);
  if (receipt.status !== "accepted") throw Error(`Send ${receipt.status}. ${receipt.message} Inspect history; work was not resent.`);
  localStorage.removeItem(key);
  const composerKey = `escode-composer:${id}`;
  if (localStorage.getItem(composerKey) === command.text) localStorage.setItem(composerKey, "");
  await ipcRenderer.invoke("lifecycle", "flushClientStorage");
  if (text !== command.text) throw Error("Previous Send accepted. Current text retained; Send again explicitly.");
}
async function control(operation: "stop" | "answer", project: string | null, id: string, target: string | undefined, token = "", answer: unknown = null) {
  const key = `escode-control:${JSON.stringify([project, id, operation, target, token])}`;
  const saved = localStorage.getItem(key);
  const state = await directories.sendState(project, id);
  const command = saved ? JSON.parse(saved) : { ...state, commandId: crypto.randomUUID(), project, id, text: "", control: { operation, target, token, answer } };
  localStorage.setItem(key, JSON.stringify(command));
  const receipt = saved ? (await directories.sendStatus(command.commandId) ?? await directories.sendMessage(command)) : await directories.sendMessage(command);
  if (!receipt) throw Error("Control outcome unavailable; command identity retained. Refresh to inspect current work.");
  if (receipt.status !== "accepted") throw Error(`${operation} ${receipt.status}: ${receipt.message}`);
  localStorage.removeItem(key);
}
async function transfer(root: string, kind: "paste" | "duplicate" | "drag-move" | "drag-copy" | "import", parent: string, paths: string[]) {
  if (kind === "paste") {
    const token = await ipcRenderer.invoke("native-clipboard-capture");
    if (token) return directories.transferAction({ root, operation: "transfer", kind: "import", parent, paths: [token] });
  }
  return directories.transferAction({ root, operation: "transfer", kind, parent, paths });
}
window.addEventListener("unload", () => { void directories.close(); });
contextBridge.exposeInMainWorld(
  "escode",
  Object.freeze({
    sendState: directories.sendState,
    sendMessage: directories.sendMessage,
    sendStatus: directories.sendStatus,
    chatLive: directories.chatLive,
    chatHistory: directories.chatHistory,
    chatSummaries: directories.chatSummaries,
    listDirectory: directories.listDirectory,
    watchFiles: directories.watchFiles,
    nativeFiles: (files: File[]) => {
      if (!Array.isArray(files) || !files.length) throw Error("No native files.");
      const paths = files.map((file) => webUtils.getPathForFile(file));
      if (paths.some((path) => !path)) throw Error("A genuine native file reference is required.");
      return ipcRenderer.invoke("native-import-capture", paths);
    },
    lifecycle: (...call: ["load"] | ["persist", import("@escode/contracts").WorkspaceState] | ["dirty", string] | ["prepare" | "finish", string?]) =>
      call[0] === "load" ? directories.loadWorkspace()
      : call[0] === "persist" ? directories.persistWorkspace(call[1])
      : ipcRenderer.invoke("lifecycle", ...call),
    onClose: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("close-request", listener);
      return () => ipcRenderer.removeListener("close-request", listener);
    },
    chat: (...call: ChatArguments) => {
      const [operation, ...args] = call;
      return ["createDraft", "context", "execution"].includes(operation)
      ? (async () => {
        if (call[0] === "createDraft") return directories.draftAction({ operation: call[0], project: call[1] });
        if (call[0] === "context") {
          const [, project, id, target] = call;
          const { expected } = await directories.sendState(project, id);
          return directories.draftAction({ operation: call[0], project, id, expected, target });
        }
        if (call[0] === "execution") {
          const [, project, id, mode, value, commit] = call;
          const { expected } = await directories.sendState(project, id);
          return directories.draftAction({ operation: call[0], project, id, expected, mode, value, commit });
        }
      })()
      : call[0] === "draft" ? Promise.resolve().then(() => {
        localStorage.setItem(`escode-composer:${String(call[2])}`, String(call[3]));
        return ipcRenderer.invoke("lifecycle", "flushClientStorage");
      })
      : call[0] === "open"
      ? open(call[1], call[2])
      : call[0] === "composer" ? Promise.resolve().then(() => {
        const text = localStorage.getItem(`escode-composer:${String(call[2])}`);
        const saved = localStorage.getItem(`escode-send:${JSON.stringify([call[1], call[2]])}`);
        return text || (saved ? JSON.parse(saved).text : "");
      })
      : call[0] === "resolveSend" ? ipcRenderer.invoke("chat", operation, ...args).then(confirmed => {
        if (confirmed) localStorage.removeItem(`escode-send:${JSON.stringify([call[1], call[2]])}`);
      })
      : call[0] === "stop" ? control("stop", call[1], call[2], call[3])
      : call[0] === "answer" ? control("answer", call[1], call[2], "", call[3], call[4])
      : call[0] === "send" ? send(call[1], call[2], call[3])
      : ipcRenderer.invoke("chat", operation, ...args);
    },
    toolStatus: () => ipcRenderer.invoke("tools:status"),
    project: (...call: ProjectArguments) =>
      call[0] === "status" ? directories.gitStatus(call[1])
      : call[0] === "worktree-options" ? directories.worktreeOptions(call[1])
      : call[0] === "drag-capture" ? directories.transferAction({ root: call[1], operation: call[0], paths: call[2] })
      : call[0] === "clipboard-capture" ? directories.transferAction({ root: call[1], operation: call[0], kind: call[2], paths: call[3] })
      : call[0] === "transfer" ? transfer(call[1], call[2], call[3], call[4])
      : call[0] === "create-entry" ? createEntry(call[1], call[2], call[3], call[4])
      : call[0] === "diff" ? directories.readDiff(call[1], call[2], call[3])
      : call[0] === "read" ? directories.readFile(call[1], call[2])
      : call[0] === "trash-selection" ? directories.trashEntries(call[1], call[2])
      : call[0] === "save" ? directories.saveFile(call[1], call[2], call[3], call[4])
      : call[0] === "file-operation"
        ? directories.moveEntry({ root: call[1], action: call[2], source: call[3], target: call[4] })
        : call[0] === "file-operation-ack" ? directories.ackFileOperation(call[1])
        : ipcRenderer.invoke("project", ...call),
  }),
);
