import { _electron } from "@playwright/test";
import electron from "electron";
import { Chats } from "../host/chat";
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
  const store = new Chats(join(userData, "durable-chats-v1"));
  const { hostId, clientId } = await store.database.ready;
  await store.database.close();
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

export async function writeChatFixture(file: string, bytes: string) {
  const { dirname } = await import("node:path");
  const store = new Chats(join(dirname(file), "durable-chats-v1"));
  try {
    await store.database.ready;
    const state = await store.database.read();
    await store.database.write(JSON.parse(bytes).chats, state.revision);
  } finally { await store.database.close(); }
}
export async function readChatFixture(file: string, _encoding: string) {
  const { dirname } = await import("node:path");
  const store = new Chats(join(dirname(file), "durable-chats-v1"));
  try { return JSON.stringify({ chats: (await store.database.read()).chats }); }
  finally { await store.database.close(); }
}
