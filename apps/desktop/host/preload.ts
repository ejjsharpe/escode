import { Schema } from "effect";
import { SendReceipt } from "@escode/contracts";
import { createDirectoryClient } from "@escode/client-runtime";
import { contextBridge, ipcRenderer, webUtils } from "electron";
const directories = createDirectoryClient(() => ipcRenderer.invoke("local-bootstrap"));
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
  if (text !== command.text) throw Error("Previous Send accepted. Current text retained; Send again explicitly.");
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
      ipcRenderer.invoke("lifecycle", operation, ...args),
    onClose: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("close-request", listener);
      return () => ipcRenderer.removeListener("close-request", listener);
    },
    chat: (operation: string, ...args: unknown[]) => operation === "open"
      ? directories.openChat(args[0] as string | null, args[1] as string)
      : operation === "composer" ? ipcRenderer.invoke("chat", operation, ...args).then(text => {
        const saved = localStorage.getItem(`escode-send:${JSON.stringify([args[0], args[1]])}`);
        return text || (saved ? JSON.parse(saved).text : "");
      })
      : operation === "resolveSend" ? ipcRenderer.invoke("chat", operation, ...args).then(confirmed => {
        if (confirmed) localStorage.removeItem(`escode-send:${JSON.stringify([args[0], args[1]])}`);
      })
      : operation === "send" ? send(args[0] as string | null, args[1] as string, args[2] as string)
      : ipcRenderer.invoke("chat", operation, ...args),
    toolStatus: () => ipcRenderer.invoke("tools:status"),
    project: (operation: string, ...args: string[]) =>
      ipcRenderer.invoke("project", operation, ...args),
  }),
);
