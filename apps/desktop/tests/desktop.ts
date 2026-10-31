import { _electron } from "@playwright/test";
import electron from "electron";
import { Chats } from "../host/chat";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolve } from "node:path";

export async function launchDesktop(
  userData: string,
  tools?: string,
  packaged = process.env.ESCODE_PACKAGED === "1",
) {
  await mkdir(userData, { recursive: true });
  const store = new Chats(join(userData, "durable-chats-v1"));
  await store.database.ready;
  await store.database.close();
  const env: Record<string, string> = {
    ...process.env,
    PATH: [tools, packaged ? "/usr/bin:/bin" : process.env.PATH].filter(Boolean).join(":"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ESCODE_DEV_URL;
  const runtime = await _electron.launch({
    executablePath: packaged
      ? resolve("release/mac-arm64/escode.app/Contents/MacOS/escode")
      : (electron as unknown as string),
    args: [...(packaged ? [] : ["."]), `--user-data-dir=${userData}`],
    env,
  });
  if (process.env.ESCODE_CHECKPOINT_LOAD) await runtime.evaluate(() => {
    const { Worker } = process.getBuiltinModule("node:worker_threads");
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
      if (message.operation === "recoveryRead" || message.operation === "recoveryWrite") (globalThis as any).__hostStorageWorker = this;
      return original.call(this, message, ...rest);
    };
  });
  return runtime;
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

export async function readRecoveryFixture(file: string, _encoding?: string) {
  const { dirname } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(join(dirname(file), "durable-chats-v1.sqlite-state-v1/state.sqlite"), { readOnly: true });
  try {
    const owner = database.prepare("SELECT clientId FROM identity").get()!;
    const row = database.prepare("SELECT body FROM client_recovery WHERE clientId=? AND kind=?").get(owner.clientId as string, file.includes("file-operation") ? "intent" : "workspace");
    return row?.body as string ?? "null";
  } finally { database.close(); }
}
export async function writeRecoveryFixture(file: string, bytes: string | Uint8Array) {
  const { dirname } = await import("node:path");
  const database = new Chats(join(dirname(file), "durable-chats-v1")).database;
  try {
    const owner = await database.ready;
    const kind = file.includes("file-operation") ? "intent" : "workspace";
    const previous = await database.recoveryRead(owner.clientId, kind);
    await database.recoveryWrite(owner.clientId, kind, JSON.parse(String(bytes)), previous.revision);
  } finally { await database.close(); }
}

export async function writeApprovalFixture(user: string, approvals: { project: string; root: string; directoryIdentity?: string }[]) {
  const store = new Chats(join(user, "durable-chats-v1"));
  try {
    const owner = await store.database.ready;
    approvals = approvals.map(approval => ({ ...approval }));
    for (const approval of approvals) {
      if (!approval.directoryIdentity) {
        const info = await stat(approval.root);
        approval.directoryIdentity = `${info.dev}:${info.ino}`;
      }
    }
    const previous = await store.database.recoveryRead(owner.hostId, "approvals");
    await store.database.recoveryWrite(owner.hostId, "approvals", approvals, previous.revision);
  } finally { await store.database.close(); }
}
export async function readApprovalFixture(user: string) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(user, "durable-chats-v1.sqlite-state-v1/state.sqlite"), { readOnly: true });
  try {
    const owner = db.prepare("SELECT hostId FROM identity").get()!;
    const row = db.prepare("SELECT body FROM client_recovery WHERE clientId=? AND kind='approvals'").get(owner.hostId as string);
    return JSON.parse(String(row?.body ?? "[]"));
  } finally { db.close(); }
}

// Audit rendered leaf text against its nearest opaque surface; no native widget claim.
export async function auditTextContrast(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const luminance = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    return Array.from(document.querySelectorAll("body *")).filter(e => !e.children.length && e.textContent?.trim() && e.getBoundingClientRect().width && e.getBoundingClientRect().height && getComputedStyle(e).visibility === "visible").flatMap(e => {
      let parent: Element | null = e;
      while (parent && getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)") parent = parent.parentElement;
      if (!parent) return [];
      const fg = luminance(getComputedStyle(e).color), bg = luminance(getComputedStyle(parent).backgroundColor);
      const ratio = (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
      return ratio < 4.5 ? [{ text: e.textContent!.trim().slice(0, 100), ratio }] : [];
    });
  });
}
