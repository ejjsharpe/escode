import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "escode",
  Object.freeze({ toolStatus: () => ipcRenderer.invoke("tools:status") }),
);
