import { Effect, Cause, Result, Exit, Layer, Schedule, Schema, Scope, Semaphore, Stream, Fiber } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { Bootstrap, ChatDetail, HostQueries, type SendCommand, type HistoryPage, type ChatSummaries, type DirectoryResult } from "@escode/contracts";

export function createDirectoryClient(bootstrap: () => Promise<unknown>, reconcile?: (project: string | null, id: string) => Promise<string | undefined>) {
  const queries = Semaphore.makeUnsafe(4);
  let queued = 0;
  type Client = Effect.Success<ReturnType<typeof makeClient>>;
  const makeClient = () => RpcClient.make(HostQueries);
  let session: { scope: Scope.Closeable; client: Promise<Client> } | undefined;
  async function close() {
    const previous = session;
    session = undefined;
    if (previous) await Effect.runPromise(Scope.close(previous.scope, Exit.void));
  }
  function connect() {
    if (session) return session.client;
    const scope = Scope.makeUnsafe();
    const client = (async () => {
      const target = Schema.decodeUnknownSync(Bootstrap)(await bootstrap());
      const url = new URL(target.url);
      if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || !url.port ||
          url.pathname !== "/directories" || url.username || url.password || url.hash ||
          url.searchParams.get("hostId") !== target.hostId || url.searchParams.get("wire") !== target.wireRevision ||
          !/^[0-9a-f]{64}$/.test(url.searchParams.get("ticket") ?? "") || target.expires <= Date.now())
        throw Error("Invalid local bootstrap");
      const socket = Socket.layerWebSocket(url.href).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
      const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false, retryPolicy: Schedule.recurs(0) })
        .pipe(Layer.provide([socket, RpcSerialization.layerJson]));
      const context = await Effect.runPromise(Layer.buildWithScope(protocol, scope));
      return Effect.runPromise(makeClient().pipe(Effect.provide(context), Effect.provideService(Scope.Scope, scope)));
    })();
    session = { scope, client };
    return client;
  }
  async function chatQuery<A>(request: (client: Client) => Effect.Effect<A, unknown>): Promise<A> {
    if (queued >= 16) throw Error("Chat query admission exhausted. Retry explicitly.");
    queued++;
    try {
      const current = connect();
      try {
        const client = await current;
        const result = await Effect.runPromise(Effect.exit(queries.withPermit(request(client)).pipe(Effect.timeout("35 seconds"))));
        if (Exit.isSuccess(result)) return result.value;
        const failure = Cause.findError(result.cause);
        if (Result.isSuccess(failure) && typeof failure.success === "string")
          throw Object.assign(Error(failure.success), { domain: true });
        throw Cause.squash(result.cause);
      } catch (error) {
        if (!(error as { domain?: boolean })?.domain && session?.client === current) await close();
        throw error;
      }
    } finally { queued--; }
  }
  return {
    draftAction: (action: import("@escode/contracts").DraftAction) => chatQuery(client => client.draftAction({ action })),
    sendState: (project: string | null, id: string) => chatQuery(client => client.sendState({ project, id })),
    sendMessage: (command: SendCommand) => chatQuery(client => client.sendMessage({ command })),
    sendStatus: (commandId: string) => chatQuery(client => client.sendStatus({ commandId })),
    openChat: (project: string | null, id: string) => chatQuery(client => client.openChat({ project, id })),
    chatLive(project: string | null, id: string, apply: (detail: typeof ChatDetail.Type) => void, error: (message: string) => void) {
      let active = true;
      const controller = new AbortController();
      let epoch: string | undefined, revision = 0;
      let items: typeof ChatDetail.Type.items = [];
      const attempt = () => Effect.gen(function* () {
        epoch = undefined; revision = 0; items = [];
        const client = yield* Effect.tryPromise(connect);
        const warning = reconcile ? yield* Effect.tryPromise(() => reconcile(project, id)) : undefined;
        yield* client.chatLive({ project, id }).pipe(Stream.timeout("3 seconds"), Stream.runForEach(batch => Effect.sync(() => {
          if (!active) return;
          if (batch.epoch === epoch && batch.revision <= revision) return;
          if (batch.revision !== revision + 1 || (epoch && epoch !== batch.epoch)) throw Error("Live coverage reset required. Reopen the view.");
          const next = items.filter(item => !batch.removed.some(old => old.id === item.id && old.turnId === item.turnId));
          for (const change of batch.changes) {
            const index = next.findIndex(item => item.id === change.item.id && item.turnId === change.item.turnId);
            if (change.append && index < 0) throw Error("Incomplete live batch. Reopen the view.");
            const item = { ...change.item, text: change.append ? next[index].text + change.item.text : change.item.text };
            if (index < 0) next.push(item); else next[index] = item;
          }
          const detail = Schema.decodeUnknownSync(ChatDetail)({ ...batch.detail, items: next });
          if (new TextEncoder().encode(JSON.stringify(detail)).length > 512 * 1024) throw Error("Live cache exhausted");
          apply(detail);
          if (warning && revision === 0) error(warning);
          items = next; epoch = batch.epoch; revision = batch.revision;
        })));
      });
      const recover = Effect.gen(function* () {
        for (let retry = 0; active; retry++) {
          const current = connect();
          const result = yield* Effect.exit(attempt());
          if (!active) return;
          const failure = Exit.isFailure(result) ? Cause.findError(result.cause) : undefined;
          const domainError = failure && Result.isSuccess(failure) && typeof failure.success === "string";
          // A moved chat invalidates its old subscription, not the shared connection.
          if (!domainError && session?.client === current) yield* Effect.tryPromise(close);
          if (retry >= 3) {
            error(`Live output unavailable; Retry to reload status/history. ${Exit.isFailure(result) ? String(result.cause) : "Stream ended"}`);
            return;
          }
          yield* Effect.sleep("500 millis");
        }
      });
      void Effect.runPromise(recover, { signal: controller.signal }).catch(value => { if (active) error(String(value)); });
      return () => { active = false; items = []; controller.abort(); };
    },
    chatHistory: (project: string | null, id: string, cursor: string | null): Promise<HistoryPage> =>
      chatQuery(client => client.chatHistory({ project, id, cursor })),
    async listDirectory(root: string, path: string): Promise<DirectoryResult> {
      if (queued >= 10000) throw Error("Directory query admission exhausted. Refresh to retry.");
      queued++;
      const current = connect();
      try {
        return await Effect.runPromise(queries.withPermit(Effect.gen(function* () {
          const client = yield* Effect.tryPromise(() => current);
          return yield* client.listDirectory({ root, path });
        })).pipe(Effect.timeout("10 seconds")));
      } catch (error) {
        if (session?.client === current) await close();
        throw error;
      } finally { queued--; }
    },
    watchFiles(root: string, paths: string[], notify: (error?: string, ready?: boolean) => void) {
      let disposed = false;
      const controller = new AbortController();
      const current = connect();
      const effect = Effect.gen(function* () {
        const client = yield* Effect.tryPromise(() => current);
        yield* client.watchDirectories({ root, paths }).pipe(Stream.runForEach((change) => Effect.sync(() => {
          if (!disposed) notify(change.error, change.ready);
        })));
      });
      void Effect.runPromise(effect, { signal: controller.signal }).catch(async (error) => {
        if (disposed) return;
        if (!disposed) notify(String(error));
      });
      return () => { disposed = true; controller.abort(); };
    },
    chatSummaries(apply: (value: ChatSummaries) => void, error: (message: string) => void) {
      let active = true;
      const attempt = Effect.gen(function* () {
        const current = connect();
        yield* Effect.gen(function* () {
          const client = yield* Effect.tryPromise(() => current);
          yield* client.chatSummaries().pipe(Stream.runForEach(value => Effect.sync(() => { if (active) apply(value); })));
        }).pipe(Effect.catch(() => Effect.tryPromise(async () => {
          if (session?.client === current) await close();
          if (active) error("Chat summaries unavailable. Reconnecting…");
        })));
      }).pipe(Effect.catch(() => Effect.void), Effect.andThen(Effect.sleep("500 millis")));
      const fiber = Effect.runFork(Effect.forever(attempt));
      return () => { active = false; void Effect.runPromise(Fiber.interrupt(fiber)); };
    },
    close,
  };
}
