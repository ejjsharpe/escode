import { createChatClient, createHostClient } from "@escode/client-runtime";
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
  | ["defaults", string | null, string, "app" | "project", import("@escode/contracts").ChatDefaults?]
  | ["permissions", string | null, string, ("supervised" | "edits" | "full")?]
  | [operation: "renameTitle", project: string | null, id: string, title: string]
  | [operation: "regenerateTitle", project: string | null, id: string]
  | ["models", string | null, string, string?, string?]
  | [operation: "createDraft", project: string | null, checkout?: string]
  | [operation: "archive", project: string | null, id: string, archived: boolean]
  | [operation: "context", project: string | null, id: string, target: string | null]
  | [operation: "execution", project: string, id: string, mode: "new" | "reuse", value: string, commit: string]
  | [operation: "targets"]
  | [operation: "create", project: string, checkout: string]
  | [operation: "open" | "composer" | "disconnect" | "resolveSend", project: string | null, id: string]
  | [operation: "send" | "draft", project: string | null, id: string, text: string]
  | [operation: "stop" | "emergencyStop", project: string | null, id: string, target?: string]
  | [operation: "answer", project: string | null, id: string, token: string, answer: unknown];
const hostClient = createHostClient(() => ipcRenderer.invoke("local-bootstrap"));
const chatStorageReady = hostClient.clientChatStorage().then(state => {
  for (const [key, value] of Object.entries(state)) localStorage.setItem(key, value);
});
void chatStorageReady.catch(() => {});
async function flushChatStorage() {
  await hostClient.clientChatStorage(Object.fromEntries(Object.keys(localStorage)
    .filter(key => /^escode-(composer|composer-revision|send|control):/.test(key))
    .map(key => [key, localStorage.getItem(key)!])));
  await ipcRenderer.invoke("lifecycle", "flushClientStorage");
}
const chatClient = createChatClient(hostClient, {
  storage: localStorage,
  flush: flushChatStorage,
  confirmResolve: (project, id) => ipcRenderer.invoke("chat", "resolveSend", project, id),
});
async function createEntry(root: string, parent: string, name: string, kind: "file" | "folder") {
  const key = `escode-create:${JSON.stringify([root, parent, name, kind])}`;
  const saved = localStorage.getItem(key);
  const command = saved ? JSON.parse(saved) : { commandId: crypto.randomUUID(), admissionEpoch: await hostClient.createState(), root, parent, name, kind };
  localStorage.setItem(key, JSON.stringify(command));
  const receipt = await hostClient.createEntry(command);
  if (receipt.status === "accepted" || receipt.status === "rejected") localStorage.removeItem(key);
  if (receipt.status !== "accepted") throw Error(receipt.message);
  return receipt.path;
}
async function control(operation: "stop" | "answer" | "emergencyStop", project: string | null, id: string, target: string | undefined, token = "", answer: unknown = null) {
  if (operation === "emergencyStop") {
    if (!target) throw Error("Missing captured Stop target.");
    const state = await hostClient.sendState(project, id);
    const receipt = await hostClient.sendMessage({ ...state, commandId: crypto.randomUUID(), project, id, text: "",
      control: { operation: "stop", emergency: true, target, token: "", answer: null } });
    throw Error(receipt.message);
  }
  const key = `escode-control:${JSON.stringify([project, id, operation, target, token])}`;
  const saved = localStorage.getItem(key);
  const state = await hostClient.sendState(project, id);
  const command = saved ? JSON.parse(saved) : { ...state, commandId: crypto.randomUUID(), project, id, text: "", control: { operation, target, token, answer } };
  localStorage.setItem(key, JSON.stringify(command));
  try { await flushChatStorage(); }
  catch (error) { if (operation !== "stop") throw error; } // Stop still reaches host emergency admission on storage failure.
  const receipt = saved ? (await hostClient.sendStatus(command.commandId) ?? await hostClient.sendMessage(command)) : await hostClient.sendMessage(command);
  if (!receipt) throw Error("Control outcome unavailable; command identity retained. Refresh to inspect current work.");
  if (receipt.reason === "emergency-stop-available") return { reason: receipt.reason, message: receipt.message };
  if (receipt.status !== "accepted" && receipt.status !== "rejected") throw Error(`${operation} ${receipt.status}: ${receipt.message}`);
  localStorage.removeItem(key);
  try { await flushChatStorage(); }
  catch (error) { localStorage.setItem(key, JSON.stringify(command)); throw error; }
  if (receipt.status === "rejected") throw Error(`${operation} rejected: ${receipt.message}`);
}
async function transfer(root: string, kind: "paste" | "duplicate" | "drag-move" | "drag-copy" | "import", parent: string, paths: string[]) {
  const key = `escode-transfer:${JSON.stringify([root, kind, parent, paths])}`;
  const saved = localStorage.getItem(key);
  const commandId = crypto.randomUUID(), admissionEpoch = await hostClient.createState();
  const execute = async (action: import("@escode/contracts").TransferAction) => {
    localStorage.setItem(key, JSON.stringify(action));
    const result = await hostClient.transferAction(action);
    if (typeof result !== "string" && !result.uncertain && !result.results.some(r => r.persistencePending)) localStorage.removeItem(key);
    return result;
  };
  if (saved) return execute(JSON.parse(saved));
  if (kind === "paste") {
    const token = await ipcRenderer.invoke("native-clipboard-capture");
    if (token) return execute({ root, operation: "transfer", commandId, admissionEpoch, kind: "import", parent, paths: [token] });
  }
  return execute({ root, operation: "transfer", commandId, admissionEpoch, kind, parent, paths });
}
window.addEventListener("unload", () => { void hostClient.close(); });
contextBridge.exposeInMainWorld(
  "escode",
  Object.freeze({
    sendState: hostClient.sendState,
    sendMessage: hostClient.sendMessage,
    sendStatus: hostClient.sendStatus,
    chatLive: chatClient.live,
    checkpointRetention: hostClient.checkpointRetention,
    checkpointPoints: hostClient.checkpointPoints,
    rewind: hostClient.rewind,
    branchHistory: hostClient.branchHistory,
    inspectFiles: hostClient.inspectFiles,
    inspectBoundary: hostClient.inspectBoundary,
    chatHistory: hostClient.chatHistory,
    chatSummaries: hostClient.chatSummaries,
    observeFiles: hostClient.observeFiles,
    searchFiles: hostClient.searchFiles,
    lookupFile: hostClient.lookupFile,
    listDirectory: hostClient.listDirectory,
    watchFiles: hostClient.watchFiles,
    nativeFiles: (files: File[]) => {
      if (!Array.isArray(files) || !files.length) throw Error("No native files.");
      const paths = files.map((file) => webUtils.getPathForFile(file));
      if (paths.some((path) => !path)) throw Error("A genuine native file reference is required.");
      return ipcRenderer.invoke("native-import-capture", paths);
    },
    lifecycle: (...call: ["load"] | ["persist", import("@escode/contracts").WorkspaceState] | ["dirty", string] | ["prepare" | "finish", string?]) =>
      call[0] === "load" ? hostClient.loadWorkspace()
      : call[0] === "persist" ? hostClient.persistWorkspace(call[1])
      : ipcRenderer.invoke("lifecycle", ...call),
    onClose: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("close-request", listener);
      return () => ipcRenderer.removeListener("close-request", listener);
    },
    chat: async (...call: ChatArguments) => {
      await chatStorageReady;
      if (call[0] === "renameTitle" || call[0] === "regenerateTitle") return hostClient.titleAction({
        project: call[1], id: call[2], ...(call[0] === "renameTitle" ? { title: call[3] } : {}) });
      const [operation, ...args] = call;
      if (call[0] === "defaults") return hostClient.chatDefaults(call[1], call[2], call[3], call[4]);
      if (call[0] === "permissions") return hostClient.chatPermissions(call[1], call[2], call[3]);
      if (call[0] === "models") return hostClient.chatModels(call[1], call[2], call[3], call[4]);
      return ["archive", "createDraft", "context", "execution"].includes(operation)
      ? (async () => {
        if (call[0] === "createDraft") return hostClient.draftAction({ operation: call[0], project: call[1], ...(call[2] === undefined ? {} : { checkout: call[2] }) });
        if (call[0] === "archive") {
          const [, project, id, archived] = call;
          const { expected } = await hostClient.sendState(project, id);
          return hostClient.draftAction({ operation: "archive", project, id, expected, archived });
        }
        if (call[0] === "context") {
          const [, project, id, target] = call;
          const { expected } = await hostClient.sendState(project, id);
          return hostClient.draftAction({ operation: call[0], project, id, expected, target });
        }
        if (call[0] === "execution") {
          const [, project, id, mode, value, commit] = call;
          const { expected } = await hostClient.sendState(project, id);
          return hostClient.draftAction({ operation: call[0], project, id, expected, mode, value, commit });
        }
      })()
      : call[0] === "draft" ? chatClient.draft(call[2], call[3])
      : call[0] === "open"
      ? chatClient.open(call[1], call[2])
      : call[0] === "composer" ? Promise.resolve().then(() => chatClient.composer(call[1], call[2]))
      : call[0] === "resolveSend" ? chatClient.resolveSend(call[1], call[2])
      : (call[0] === "stop" || call[0] === "emergencyStop") ? control(call[0], call[1], call[2], call[3])
      : call[0] === "answer" ? control("answer", call[1], call[2], "", call[3], call[4])
      : call[0] === "send" ? chatClient.send(call[1], call[2], call[3])
      : ipcRenderer.invoke("chat", operation, ...args);
    },
    copyConversationCode: (text: string) => ipcRenderer.invoke("copy-conversation-code", text),
    toolStatus: () => ipcRenderer.invoke("tools:status"),
    project: (...call: ProjectArguments) =>
      call[0] === "status" ? hostClient.gitStatus(call[1])
      : call[0] === "worktree-options" ? hostClient.worktreeOptions(call[1])
      : call[0] === "drag-capture" ? hostClient.transferAction({ root: call[1], operation: call[0], paths: call[2] })
      : call[0] === "clipboard-capture" ? hostClient.transferAction({ root: call[1], operation: call[0], kind: call[2], paths: call[3] })
      : call[0] === "transfer" ? transfer(call[1], call[2], call[3], call[4])
      : call[0] === "create-entry" ? createEntry(call[1], call[2], call[3], call[4])
      : call[0] === "diff" ? hostClient.readDiff(call[1], call[2], call[3])
      : call[0] === "read" ? hostClient.readFile(call[1], call[2])
      : call[0] === "trash-selection" ? hostClient.trashEntries(call[1], call[2])
      : call[0] === "save" ? hostClient.saveFile(call[1], call[2], call[3], call[4])
      : call[0] === "file-operation"
        ? hostClient.moveEntry({ root: call[1], action: call[2], source: call[3], target: call[4] })
        : call[0] === "file-operation-ack" ? hostClient.ackFileOperation(call[1])
        : ipcRenderer.invoke("project", ...call),
  }),
);
