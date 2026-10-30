import { Effect, Layer, Schedule, Schema, Semaphore, Stream, Fiber } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { Bootstrap, Directories, HostQueries, type ChatSummaries, type DirectoryResult } from "@escode/contracts";

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
  const protocol = await connection(bootstrap);
  return Effect.runPromise(Effect.gen(function* () {
    const client = yield* RpcClient.make(Directories);
    return yield* client.listDirectory({ root, path });
  }).pipe(Effect.provide(protocol), Effect.scoped, Effect.timeout("10 seconds")));
}

async function connection(bootstrap: () => Promise<unknown>) {
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
  return protocol;
}

export function subscribeChatSummaries(bootstrap: () => Promise<unknown>, apply: (value: ChatSummaries) => void, error: (message: string) => void) {
  let active = true;
  const attempt = Effect.gen(function* () {
    const protocol = yield* Effect.tryPromise(() => connection(bootstrap));
    yield* Effect.gen(function* () {
      const client = yield* RpcClient.make(HostQueries);
      yield* client.chatSummaries().pipe(Stream.runForEach((value) => Effect.sync(() => { if (active) apply(value); })));
    }).pipe(Effect.provide(protocol), Effect.scoped);
  }).pipe(Effect.catch((cause) => Effect.sync(() => { if (active) error(String(cause)); })), Effect.andThen(Effect.sleep("500 millis")));
  const fiber = Effect.runFork(Effect.forever(attempt));
  return () => { active = false; void Effect.runPromise(Fiber.interrupt(fiber)); };
}
