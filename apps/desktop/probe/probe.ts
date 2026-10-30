import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { Cause, Deferred, Effect, Exit, Layer, Queue, Schedule, Schema, Stream } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Rpc, RpcClient, RpcGroup, RpcSerialization, RpcServer } from "effect/rpc";
import { Socket } from "effect/socket";
import WebSocket from "ws";
import * as CodexRpc from "./vendor/codex/src/_generated/meta.gen.ts";
import type { CodexAppServerProtocolLogEvent } from "./vendor/codex/src/protocol.ts";
import * as CodexError from "./vendor/codex/src/errors.ts";
import * as Codex from "./vendor/codex/src/client.ts";
import { makeInMemoryStdio } from "./vendor/codex/src/_internal/stdio.ts";
import { codexCommand, findExecutable } from "../host/tools";

const Group = RpcGroup.make(Rpc.make("Output", { success: Schema.String, stream: true }));
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type OutputQueue = Queue.Queue<string, Cause.Done<void> | Error>;

function providerLogger(output: OutputQueue) {
  return (event: CodexAppServerProtocolLogEvent) => Effect.gen(function* () {
    if (event.direction !== "incoming" || event.stage !== "decoded") return;
    const payload = event.payload as { id?: unknown; method?: string; params?: unknown };
    if (payload.id !== undefined || typeof payload.method !== "string") return;
    const schemas: Record<string, Schema.Schema<unknown>> = CodexRpc.SERVER_NOTIFICATION_PARAMS;
    const schema = schemas[payload.method];
    if (schema && !Schema.is(schema)(payload.params)) {
      yield* Queue.fail(output, Error(`Invalid provider notification: ${payload.method}`));
    }
  });
}

function completeProviderOutput(output: OutputQueue, status: string) {
  return status === "completed" ? Queue.end(output) : Queue.fail(output, Error(`Provider turn ${status}`));
}

function providerOutput(cwd: string) {
  return Stream.unwrap(Effect.gen(function* () {
    const path = yield* Effect.tryPromise(() => findExecutable("codex"));
    const command = yield* Effect.tryPromise(() => codexCommand(path, ["app-server", "--listen", "stdio://"]));
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(ChildProcess.make(command.executable, command.args, {
      cwd, env: command.env, detached: true,
    }));
    yield* Effect.addFinalizer(() => handle.kill({ forceKillAfter: "300 millis" }).pipe(Effect.orDie));
    const output = yield* Queue.make<string, Cause.Done<void> | Error>({ capacity: 32 });
    const context = yield* Layer.build(Codex.layerChildProcess(handle, { logIncoming: true, logger: providerLogger(output) }));

    return yield* Effect.gen(function* () {
      const codex = yield* Codex.CodexAppServerClient;
      let bytes = 0;
      yield* codex.handleServerNotification("item/agentMessage/delta", ({ delta }) => {
        bytes += Buffer.byteLength(delta);
        return bytes > 65536 ? Queue.fail(output, Error("Probe output limit exceeded")) : Queue.offer(output, delta).pipe(Effect.asVoid);
      });
      yield* codex.handleServerNotification("turn/completed", ({ turn }) => completeProviderOutput(output, turn.status));
      yield* codex.handleUnknownServerRequest((method) => Effect.fail(
        CodexError.CodexAppServerRequestError.methodNotFound(method),
      ));
      yield* codex.request("initialize", {
        clientInfo: { name: "escode-disposable-probe", version: "0.0.0", title: null },
        capabilities: { experimentalApi: true, optOutNotificationMethods: null },
      });
      yield* codex.notify("initialized", undefined);
      const thread = yield* codex.request("thread/start", {
        cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only",
      });
      yield* codex.request("turn/start", {
        threadId: thread.thread.id,
        input: [{ type: "text", text: "Reply exactly ESCODE_EFFECT_OK. Do not use tools or change files.", text_elements: [] }],
      });
      return Stream.fromQueue(output);
    }).pipe(Effect.provide(context));
  }));
}

export async function runProbe(live: boolean) {
  const cwd = await mkdtemp(join(tmpdir(), "escode-effect-probe-"));
  const result = { stalledBounded: false, authRejected: false, acks: 0, cancelled: false, schemaRejected: false,
    unknownHandled: false, descendantCleaned: false, live, text: "", versions: process.versions };
  const program = Effect.gen(function* () {
    // Verify typed rejection and opaque unknown dispatch through the real T3 client.
    yield* Effect.gen(function* () {
      const memory = yield* makeInMemoryStdio();
      const client = yield* Codex.make(memory.stdio);
      const unknown = yield* Deferred.make<void>();
      yield* client.handleUnknownServerNotification((method, params) => Effect.sync(() => {
        assert.equal(method, "future/notification");
        assert.deepEqual(params, { text: "<script>not executable</script>" });
        result.unknownHandled = true;
      }).pipe(Effect.andThen(Deferred.succeed(unknown, undefined))));
      yield* Queue.offer(memory.input, new TextEncoder().encode(JSON.stringify({ method: "future/notification", params: { text: "<script>not executable</script>" } }) + "\n"));
      yield* Deferred.await(unknown);
      const invalid = yield* Effect.exit(client.request("initialize", { clientInfo: { name: 42 } } as never));
      assert(Exit.isFailure(invalid));
      result.schemaRejected = true;
    }).pipe(Effect.scoped);

    for (const failure of ["malformed", "failed", "interrupted"]) {
      yield* Effect.gen(function* () {
        const output = yield* Queue.make<string, Cause.Done<void> | Error>({ capacity: 32 });
        const memory = yield* makeInMemoryStdio();
        const client = yield* Codex.make(memory.stdio, { logIncoming: true, logger: providerLogger(output) });
        yield* client.handleServerNotification("turn/completed", ({ turn }) => completeProviderOutput(output, turn.status));
        const message = failure === "malformed"
          ? { method: "item/agentMessage/delta", params: { delta: 42 } }
          : { method: "turn/completed", params: { threadId: "t", turn: { id: "turn", status: failure, items: [], error: null, startedAt: null, completedAt: null, durationMs: null } } };
        yield* Queue.offer(memory.input, new TextEncoder().encode(JSON.stringify(message) + "\n"));
        yield* Queue.offer(output, "ESCODE_EFFECT_OK");
        const received = yield* Effect.exit(Stream.runCollect(Stream.fromQueue(output)));
        assert(Exit.isFailure(received), `${failure} provider payload was accepted`);
        assert.match(String(Cause.squash(received.cause)), new RegExp(failure === "malformed" ? "Invalid provider notification" : `Provider turn ${failure}`));
      }).pipe(Effect.scoped);
    }

    // Scope release must reap a stubborn descendant as well as its leader.
    let descendant = 0;
    yield* Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const handle = yield* spawner.spawn(ChildProcess.make("/bin/sh", ["-c", 'trap "" TERM; /bin/sh -c \'trap "" TERM; echo $$ > "$1"; while :; do /bin/sleep 1; done\' sh "$1" & wait', "sh", join(cwd, "pid")], { detached: true }));
      yield* Effect.addFinalizer(() => handle.kill({ forceKillAfter: "300 millis" }).pipe(Effect.orDie));
      yield* Effect.tryPromise(async () => {
        for (let i = 0; i < 100; i++) {
          try { descendant = Number(await readFile(join(cwd, "pid"), "utf8")); if (descendant) return; } catch { /* Wait for child startup. */ }
          await delay(10);
        }
        throw Error("Descendant did not start");
      });
    }).pipe(Effect.scoped);
    assert(descendant > 0);
    try { process.kill(descendant, 0); throw Error("Owned descendant survived scope release"); }
    catch (error) { assert.equal((error as NodeJS.ErrnoException).code, "ESRCH"); }
    result.descendantCleaned = true;

    const token = randomBytes(32).toString("hex");
    const server = yield* NodeHttpServer.make(createServer, { host: "127.0.0.1", port: 0, websocket: { maxPayload: 65536 } });
    assert.equal(server.address._tag, "InetAddressV4");
    const port = (server.address as { port: number }).port;
    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    let finalized = 0;
    const output = live ? providerOutput(cwd) : Stream.range(0, 100).pipe(Stream.map(String), Stream.rechunk(1));
    yield* RpcServer.make(Group).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.provide(Group.toLayer({ Output: () => output.pipe(Stream.orDie, Stream.ensuring(Effect.sync(() => { finalized++; }))) })),
      Effect.forkScoped,
    );
    yield* server.serve(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (request.url !== "/probe" || request.headers.host !== `127.0.0.1:${port}` ||
        request.headers.origin !== "escode://probe" || request.headers.authorization !== `Bearer ${token}` ||
        request.headers["x-escode-wire"] !== "1") return HttpServerResponse.empty({ status: 401 });
      return yield* httpEffect;
    }));
    const headers = { Authorization: `Bearer ${token}`, Origin: "escode://probe", "x-escode-wire": "1" };
    for (const options of [
      { path: "/probe", headers: { Origin: headers.Origin, "x-escode-wire": "1" } },
      { path: "/probe", headers: { ...headers, Authorization: "Bearer incorrect" } },
      { path: "/wrong", headers },
      { path: "/probe", headers: { ...headers, Origin: "https://evil.invalid" } },
      { path: "/probe", headers: { ...headers, "x-escode-wire": "2" } },
      { path: "/probe", headers: { ...headers, Host: "evil.invalid" } },
    ]) {
      yield* Effect.tryPromise(() => new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}${options.path}`, { headers: options.headers });
        socket.on("unexpected-response", (_req, response) => {
          const status = response.statusCode;
          response.resume(); socket.terminate();
          if (status === 401) resolve(); else reject(Error(`Unexpected auth status ${status}`));
        });
        socket.on("error", () => {});
        socket.on("open", () => { socket.close(); reject(Error("Invalid upgrade accepted")); });
      }));
    }
    result.authRejected = true;
    if (!live) {
      const stalled = yield* Effect.acquireRelease(
        Effect.tryPromise(() => new Promise<WebSocket>((resolve, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${port}/probe`, { headers });
          socket.once("open", () => resolve(socket)); socket.once("error", reject);
        })),
        (socket) => Effect.sync(() => socket.terminate()),
      );
      let chunks = 0;
      stalled.on("message", (data) => { if (data.toString().includes('"_tag":"Chunk"')) chunks++; });
      stalled.send(JSON.stringify({ _tag: "Request", id: "900", tag: "Output", payload: null, headers: [] }));
      yield* Effect.tryPromise(async () => {
        for (let i = 0; i < 100 && chunks === 0; i++) await delay(10);
        assert.equal(chunks, 1);
        await delay(150);
        assert.equal(chunks, 1, "Delivery advanced without ACK");
      });
      result.stalledBounded = true;
    }
    const layerSocket = Socket.layerWebSocket(`ws://127.0.0.1:${port}/probe`, {
      headers: { Authorization: `Bearer ${token}`, Origin: "escode://probe", "x-escode-wire": "1" },
    }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, (url, options) => {
      const socket = new WebSocket(url, options as WebSocket.ClientOptions);
      const send = socket.send.bind(socket);
      socket.send = ((data: WebSocket.Data, ...args: unknown[]) => {
        const text = typeof data === "string" ? data : data.toString();
        if (text.includes('"_tag":"Ack"')) result.acks++;
        return (send as (...a: unknown[]) => void)(data, ...args);
      }) as typeof socket.send;
      return socket as never;
    })));
    const layerClient = RpcClient.layerProtocolSocket({ retryTransientErrors: false, retryPolicy: Schedule.recurs(0) }).pipe(
      Layer.provide([layerSocket, RpcSerialization.layerJson]),
    );
    yield* Effect.gen(function* () {
      const client = yield* RpcClient.make(Group);
      if (live) {
        const chunks = yield* Stream.runCollect(client.Output());
        result.text = chunks.join("");
        assert(result.text.includes("ESCODE_EFFECT_OK"));
      } else {
        const chunks = yield* Stream.runCollect(client.Output().pipe(Stream.take(2)));
        assert.deepEqual(chunks, ["0", "1"]);
      }
      yield* Effect.tryPromise(async () => {
        for (let i = 0; i < 100 && finalized === 0; i++) await delay(10);
        assert(finalized > 0);
      });
    }).pipe(Effect.provide(layerClient), Effect.scoped);
    result.cancelled = !live;
    return result;
  }).pipe(Effect.scoped, Effect.provide([NodeHttpServer.layerHttpServices, RpcSerialization.layerJson, NodeServices.layer]), Effect.timeout("120 seconds"));
  try { return await Effect.runPromise(program); }
  finally { await rm(cwd, { recursive: true, force: true }); }
}
