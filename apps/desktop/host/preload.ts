import { listDirectory } from "@escode/client-runtime";
import { contextBridge, ipcRenderer, webUtils } from "electron";
contextBridge.exposeInMainWorld(
  "escode",
  Object.freeze({
    listDirectory: (root: string, path: string) =>
      listDirectory(() => ipcRenderer.invoke("local-bootstrap"), root, path),
    watchFiles: (root: string, paths: string[], callback: (error?: string) => void) => {
      const id = crypto.randomUUID();
      let disposed = false;
      const listener = (_event: unknown, value: { id: string; root: string; error?: string }) => {
        if (!disposed && value.id === id && value.root === root) callback(value.error);
      };
      ipcRenderer.on("files-changed", listener);
      void ipcRenderer.invoke("files-watch", root, id, paths).catch((error) => {
        if (!disposed) callback(String(error));
      });
      return () => {
        disposed = true;
        ipcRenderer.removeListener("files-changed", listener);
        void ipcRenderer.invoke("files-watch", root, id, []).catch(() => {});
      };
    },
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
