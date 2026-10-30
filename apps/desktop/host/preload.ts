import { createDirectoryClient } from "@escode/client-runtime";
import { contextBridge, ipcRenderer, webUtils } from "electron";
const directories = createDirectoryClient(() => ipcRenderer.invoke("local-bootstrap"));
window.addEventListener("unload", () => { void directories.close(); });
contextBridge.exposeInMainWorld(
  "escode",
  Object.freeze({
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
    chat: (operation: string, ...args: unknown[]) => ipcRenderer.invoke("chat", operation, ...args),
    toolStatus: () => ipcRenderer.invoke("tools:status"),
    project: (operation: string, ...args: string[]) =>
      ipcRenderer.invoke("project", operation, ...args),
  }),
);
