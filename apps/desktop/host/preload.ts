import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "escode",
  Object.freeze({
    chat: (operation: string, ...args: unknown[]) => ipcRenderer.invoke("chat", operation, ...args),
    toolStatus: () => ipcRenderer.invoke("tools:status"),
    project: (operation: string, ...args: string[]) =>
      ipcRenderer.invoke("project", operation, ...args),
  }),
);
