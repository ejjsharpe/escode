import { Schema } from "effect";
import { SendReceipt } from "@escode/contracts";
import { createDirectoryClient } from "@escode/client-runtime";
import { contextBridge, ipcRenderer, webUtils } from "electron";
const directories = createDirectoryClient(() => ipcRenderer.invoke("local-bootstrap"), reconcile);
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
  if (text !== command.text) throw Error("Previous Send accepted. Current text retained; Send again explicitly.");
}
async function control(operation: "stop" | "answer", project: string | null, id: string, target: string, token = "", answer: unknown = null) {
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
    lifecycle: (operation: string, ...args: unknown[]) =>
      operation === "load" ? directories.loadWorkspace()
      : operation === "persist" ? directories.persistWorkspace(args[0] as typeof import("@escode/contracts").WorkspaceState.Type)
      : ipcRenderer.invoke("lifecycle", operation, ...args),
    onClose: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("close-request", listener);
      return () => ipcRenderer.removeListener("close-request", listener);
    },
    chat: (operation: string, ...args: unknown[]) => ["createDraft", "context", "execution"].includes(operation)
      ? (async () => {
        const project = args[0] as string | null, id = args[1] as string;
        const expected = operation === "createDraft" ? undefined : (await directories.sendState(project, id)).expected;
        return directories.draftAction({ operation: operation as "createDraft" | "context" | "execution", project, ...(operation === "createDraft" ? {} : { id, expected }),
          ...(operation === "context" ? { target: args[2] as string | null } : {}),
          ...(operation === "execution" ? { mode: args[2] as "new" | "reuse", value: args[3] as string, commit: args[4] as string } : {}),
        });
      })()
      : operation === "draft" ? Promise.resolve(localStorage.setItem(`escode-composer:${String(args[1])}`, String(args[2])))
      : operation === "open"
      ? open(args[0] as string | null, args[1] as string)
      : operation === "composer" ? Promise.resolve().then(() => {
        const text = localStorage.getItem(`escode-composer:${String(args[1])}`);
        const saved = localStorage.getItem(`escode-send:${JSON.stringify([args[0], args[1]])}`);
        return text || (saved ? JSON.parse(saved).text : "");
      })
      : operation === "resolveSend" ? ipcRenderer.invoke("chat", operation, ...args).then(confirmed => {
        if (confirmed) localStorage.removeItem(`escode-send:${JSON.stringify([args[0], args[1]])}`);
      })
      : operation === "stop" ? control("stop", args[0] as string | null, args[1] as string, args[2] as string)
      : operation === "answer" ? control("answer", args[0] as string | null, args[1] as string, "", args[2] as string, args[3])
      : operation === "send" ? send(args[0] as string | null, args[1] as string, args[2] as string)
      : ipcRenderer.invoke("chat", operation, ...args),
    toolStatus: () => ipcRenderer.invoke("tools:status"),
    project: (operation: string, ...args: string[]) =>
      operation === "read" ? directories.readFile(args[0], args[1])
      : operation === "save" ? directories.saveFile(args[0], args[1], args[2], args[3])
      : ipcRenderer.invoke("project", operation, ...args),
  }),
);
