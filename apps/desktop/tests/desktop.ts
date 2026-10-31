import { _electron } from "@playwright/test";
import electron from "electron";
import { FoundationState } from "../host/foundation-state";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolve } from "node:path";

export async function launchDesktop(
  userData: string,
  tools?: string,
  packaged = process.env.ESCODE_PACKAGED === "1",
) {
  // Explicitly seeded test recovery belongs to this installation's sole client.
  await mkdir(userData, { recursive: true });
  const foundation = FoundationState.open(join(userData, "foundation"));
  const { hostId, clientId } = foundation.read();
  foundation.close();
  let seededWorkspace = false;
  for (const name of ["client-workspace-v1.json", "client-file-operation-v1.json"]) {
    const file = join(userData, name);
    try {
      const state = JSON.parse(await readFile(file, "utf8"));
      if (state && state.storageVersion === undefined) {
        if (name === "client-workspace-v1.json") seededWorkspace = true;
        await writeFile(file, JSON.stringify({ ...state, storageVersion: 1, hostId, clientId }));
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  // Seeded approvals represent a native choice in this fixture, never a runtime migration.
  const approvalsFile = join(userData, "approved-projects.json");
  if (seededWorkspace) {
    try {
      const approvals = JSON.parse(await readFile(approvalsFile, "utf8"));
      for (const approval of approvals) {
        if (!approval.directoryIdentity) {
          const info = await stat(approval.root);
          approval.directoryIdentity = `${info.dev}:${info.ino}`;
        }
      }
      await writeFile(approvalsFile, JSON.stringify(approvals));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
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
