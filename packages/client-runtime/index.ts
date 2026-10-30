import { Effect, Exit, Layer, Schedule, Schema, Scope, Semaphore, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { Bootstrap, Directories, type DirectoryResult } from "@escode/contracts";

export function createDirectoryClient(bootstrap: () => Promise<unknown>) {
  const queries = Semaphore.makeUnsafe(4);
  let queued = 0;
  type Client = Effect.Success<ReturnType<typeof makeClient>>;
  const makeClient = () => RpcClient.make(Directories);
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
  return {
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
        if (session?.client === current) await close();
        if (!disposed) notify(String(error));
      });
      return () => { disposed = true; controller.abort(); };
    },
    close,
  };
}
