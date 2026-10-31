import { connectCodex } from "./tools";

// Never resume a thread: thread/read validates the provider's retained context.
export async function inspectRecoveryProvider(threadId: string, checkout: string, executable?: string): Promise<boolean> {
  let rpc: Awaited<ReturnType<typeof connectCodex>> | undefined;
  try {
    rpc = await connectCodex(checkout, () => {}, () => {}, executable);
    const account = await rpc.request("account/read", { refreshToken: false }) as { account?: unknown };
    if (!account.account) return false;
    const { thread } = await rpc.request("thread/read", { threadId, includeTurns: true }) as import("./vendor/codex/src/schema").V2ThreadReadResponse;
    return thread.id === threadId && thread.cwd === checkout && Array.isArray(thread.turns);
  } catch { return false; }
  finally { rpc?.close(); await rpc?.finished; }
}
