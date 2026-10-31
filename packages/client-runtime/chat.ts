import { Schema } from "effect";
import { SendCommand } from "@escode/contracts";
import type { createHostClient } from "./index";

type Host = Pick<ReturnType<typeof createHostClient>,
  "sendState" | "sendMessage" | "sendStatus" | "openChat" | "chatHistory" | "chatLive">;

export function createChatClient(host: Host, {
  storage, flush, confirmResolve,
}: {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  flush: () => Promise<void>;
  confirmResolve: (project: string | null, id: string) => Promise<boolean>;
}) {
  const busy = new Set<string>();
  const sendKey = (project: string | null, id: string) => `escode-send:${JSON.stringify([project, id])}`;
  const composerKey = (id: string) => `escode-composer:${id}`;
  function pending(project: string | null, id: string) {
    const saved = storage.getItem(sendKey(project, id));
    if (saved === null) return;
    const command = Schema.decodeUnknownSync(SendCommand)(JSON.parse(saved));
    if (command.project !== project || command.id !== id || command.control)
      throw Error("Invalid pending Send; identity and text retained.");
    return command;
  }
  function composer(project: string | null, id: string) {
    return storage.getItem(composerKey(id)) ?? pending(project, id)?.text ?? "";
  }
  const revisionKey = (id: string) => `escode-composer-revision:${id}`;
  async function draft(id: string, text: string) {
    const revision = crypto.randomUUID();
    storage.setItem(revisionKey(id), revision);
    storage.setItem(composerKey(id), text);
    await flush();
    return revision;
  }
  async function reconcile(project: string | null, id: string) {
    const command = pending(project, id);
    if (!command) return;
    const receipt = await host.sendStatus(command.commandId);
    if (receipt?.status === "admitted" || receipt?.status === "dispatching") return;
    await host.chatHistory(project, id, null);
    if (!receipt || receipt.status !== "accepted")
      return `Previous Send ${receipt?.status ?? "unavailable or expired"}; identity and text retained. Review history before Resolve previous Send…`;
  }
  return {
    composer,
    draft,
    async open(project: string | null, id: string) {
      const detail = await host.openChat(project, id);
      await reconcile(project, id);
      return detail;
    },
    live(project: string | null, id: string, apply: Parameters<Host["chatLive"]>[2], error: (message: string) => void) {
      return host.chatLive(project, id, apply, error, () => reconcile(project, id));
    },
    async send(project: string | null, id: string, text: string) {
      if (busy.has(id)) throw Error("Send recovery already pending for this chat.");
      busy.add(id);
      try {
        let command = pending(project, id);
        const revision = await draft(id, text);
        let receipt;
        if (command) receipt = await host.sendStatus(command.commandId);
        else {
          const state = await host.sendState(project, id);
          command = { ...state, commandId: crypto.randomUUID(), project, id, text };
          storage.setItem(sendKey(project, id), JSON.stringify(command));
          receipt = await host.sendMessage(command);
        }
        if (receipt === null)
          throw Error("Send status unavailable; identity and text retained. Inspect history, then Resolve previous Send…");
        if (receipt.status !== "accepted")
          throw Error(`Send ${receipt.status}. ${receipt.message} Inspect history; work was not resent.`);
        if (storage.getItem(revisionKey(id)) === revision && storage.getItem(composerKey(id)) === command.text) storage.setItem(composerKey(id), "");
        await flush();
        // Failed composer persistence must retain the identity for a status-only retry.
        storage.removeItem(sendKey(project, id));
        if (text !== command.text)
          throw Error("Previous Send accepted. Current text retained; Send again explicitly.");
        return composer(project, id);
      } finally { busy.delete(id); }
    },
    async resolveSend(project: string | null, id: string) {
      if (busy.has(id)) throw Error("Send recovery already pending for this chat.");
      busy.add(id);
      try {
        const key = sendKey(project, id);
        const saved = storage.getItem(key);
        if (await confirmResolve(project, id)) {
          await draft(id, composer(project, id));
          // A delayed confirmation must not release a newer command's identity.
          if (storage.getItem(key) === saved) storage.removeItem(key);
        }
      } finally { busy.delete(id); }
    },
  };
}
