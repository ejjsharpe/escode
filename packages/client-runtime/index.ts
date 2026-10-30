import { Effect, Layer, Schedule, Schema, Semaphore } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { Bootstrap, Directories, type DirectoryResult } from "@escode/contracts";

const queries = Semaphore.makeUnsafe(4);
let queued = 0;

export async function listDirectory(bootstrap: () => Promise<unknown>, root: string, path: string): Promise<DirectoryResult> {
  if (queued >= 10000) throw Error("Directory query admission exhausted. Refresh to retry.");
  queued++;
  try { return await Effect.runPromise(queries.withPermit(Effect.tryPromise({ try: () => query(bootstrap, root, path), catch: (error) => error }))); }
  finally { queued--; }
}

// A query scope releases its socket on success, failure or deadline; reads never fall back to IPC.
async function query(bootstrap: () => Promise<unknown>, root: string, path: string): Promise<DirectoryResult> {
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
  return Effect.runPromise(Effect.gen(function* () {
    const client = yield* RpcClient.make(Directories);
    return yield* client.listDirectory({ root, path });
  }).pipe(Effect.provide(protocol), Effect.scoped, Effect.timeout("10 seconds")));
}
