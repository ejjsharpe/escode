import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "escode",
  Object.freeze({
    lifecycle: (operation: string, ...args: unknown[]) =>
      ipcRenderer.invoke("lifecycle", operation, ...args),
    onClose: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("close-request", listener);
      return () => ipcRenderer.removeListener("close-request", listener);
    },
    chat: (operation: string, ...args: unknown[]) => ipcRenderer.invoke("chat", operation, ...args),
    toolStatus: () => ipcRenderer.invoke("tools:status"),
    project: (operation: string, ...args: string[]) =>
      ipcRenderer.invoke("project", operation, ...args),
  }),
);
