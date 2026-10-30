import { _electron } from "@playwright/test";
import electron from "electron";
import { resolve } from "node:path";

export function launchDesktop(
  userData: string,
  tools?: string,
  packaged = process.env.ESCODE_PACKAGED === "1",
) {
  const env: Record<string, string> = {
    ...process.env,
    PATH: [tools, packaged ? "/usr/bin:/bin" : process.env.PATH].filter(Boolean).join(":"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ESCODE_DEV_URL;
  return _electron.launch({
    executablePath: packaged
      ? resolve("release/mac-arm64/escode.app/Contents/MacOS/escode")
      : (electron as unknown as string),
    args: [...(packaged ? [] : ["."]), `--user-data-dir=${userData}`],
    env,
  });
}

// Serializable browser-side fixture reader; production lists never fetch composers.
export function readChats(project: string | null): Promise<import("../host/chat").SavedChat[]> {
  return new Promise((resolve, reject) => {
    const off = window.escode.chatSummaries(async ({ chats }) => {
      off();
      try {
        resolve(await Promise.all(chats.filter(c => c.project === project).map(async c => ({
          ...c, draft: await window.escode.chat("composer", c.project, c.id),
        }))));
      } catch (error) { reject(error); }
    }, error => { off(); reject(Error(error)); });
  });
}
