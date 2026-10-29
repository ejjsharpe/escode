import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "escode",
  Object.freeze({
    toolStatus: () => ipcRenderer.invoke("tools:status"),
    project: (operation: string, ...args: string[]) =>
      ipcRenderer.invoke("project", operation, ...args),
  }),
);
