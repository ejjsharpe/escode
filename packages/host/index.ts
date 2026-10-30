import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Fiber, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { Directories, maximumFrameBytes, wireRevision, type Bootstrap, type DirectoryResult } from "@escode/contracts";

// One host scope; no provider or project resource belongs to a socket.
export async function startDirectoryHost(options: {
  hostId: string; clientId: string; origin: string;
  list(root: string, path: string): Promise<DirectoryResult>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const tickets = new Map<string, number>();
  let port = 0;
  let ready!: () => void;
  let failed!: (error: unknown) => void;
  const started = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
  const program = Effect.gen(function* () {
    const server = yield* NodeHttpServer.make(createServer, {
      host: "127.0.0.1", port: 0, websocket: { maxPayload: maximumFrameBytes, perMessageDeflate: false },
    });
    if (server.address._tag !== "InetAddressV4") throw Error("Expected loopback address");
    port = server.address.port;
    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    const rejected = new Set<number>();
    const reject = (id: number) => {
      rejected.add(id);
      return protocol.send(id, { _tag: "Defect", defect: "Invalid request or request admission exhausted" });
    };
    const pending = new Map<number, Set<string | number>>();
    const requestEnvelope = Schema.Struct({ _tag: Schema.Literal("Request"), id: Schema.String,
      tag: Schema.Literal("listDirectory"), payload: Schema.Unknown,
      headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
    });
    const boundedProtocol: typeof protocol = {
      ...protocol,
      run: (receive) => protocol.run((id, data) => Effect.suspend(() => {
        if (rejected.has(id)) return Effect.void;
        if (!data || typeof data !== "object") return reject(id);
        if (data._tag === "Request") {
          const requests = pending.get(id) ?? new Set<string | number>();
          if (!Schema.is(requestEnvelope)(data) || data.isNotification || data.discard ||
              requests.size >= 16 || requests.has(data.id)) return reject(id);
          requests.add(data.id); pending.set(id, requests);
        } else if (!["Ping", "Eof", "Ack", "Interrupt"].includes(data._tag)) return reject(id);
        return receive(id, data);
      })),
      send: (id, response, transferables) => {
        if (response._tag === "Exit") pending.get(id)?.delete(response.requestId);
        return protocol.send(id, response, transferables);
      },
    };
    yield* RpcServer.make(Directories, { concurrency: 16, onDisconnect: (id) => Effect.sync(() => { pending.delete(id); rejected.delete(id); }) }).pipe(
      Effect.provideService(RpcServer.Protocol, boundedProtocol),
      Effect.provide(Directories.toLayer({ listDirectory: ({ root, path }) =>
        Effect.tryPromise(() => options.list(root, path)).pipe(Effect.catch(() =>
          Effect.succeed({ kind: "unavailable" as const, message: "Directory unavailable. Refresh to retry." }))),
      })), Effect.forkScoped,
    );
    let connections = 0;
    yield* server.serve(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      const token = url.searchParams.get("ticket") ?? "";
      const expires = tickets.get(token);
      if (request.method !== "GET" || url.pathname !== "/directories" ||
          request.headers.host !== `127.0.0.1:${port}` || request.headers.origin !== options.origin ||
          url.searchParams.get("hostId") !== options.hostId || url.searchParams.get("wire") !== wireRevision ||
          !expires || expires <= now() || connections >= 8)
        return HttpServerResponse.empty({ status: 401 });
      tickets.delete(token);
      connections++;
      return yield* httpEffect.pipe(Effect.ensuring(Effect.sync(() => { connections--; })));
    }));
    ready();
    yield* Effect.never;
  }).pipe(Effect.scoped, Effect.provide([NodeHttpServer.layerHttpServices, RpcSerialization.layerJson]),
    Effect.tapCause((cause) => Effect.sync(() => failed(cause))));
  const fiber = Effect.runFork(program);
  await started;
  return {
    origin: `ws://127.0.0.1:${port}`,
    bootstrap(): Bootstrap {
      for (const [token, expires] of tickets) if (expires <= now()) tickets.delete(token);
      if (tickets.size >= 8) throw Error("Bootstrap admission exhausted. Retry after expiry.");
      const ticket = randomBytes(32).toString("hex"), expires = now() + 10000;
      tickets.set(ticket, expires);
      return { hostId: options.hostId, clientId: options.clientId, wireRevision, expires,
        url: `ws://127.0.0.1:${port}/directories?ticket=${ticket}&hostId=${options.hostId}&wire=${wireRevision}` };
    },
    close: () => Effect.runPromise(Fiber.interrupt(fiber)),
  };
}
