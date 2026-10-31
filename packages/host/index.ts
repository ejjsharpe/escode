import { coalesceObservation } from "./observation";
import WebSocket from "ws";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Fiber, Queue, Schema, Stream, Schedule } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { RewindResult, FileInspection, CheckpointPage, BoundaryInspection, maximumFileFrameBytes, MoveResult, DraftRecord, HostQueries, LiveBatch, ChatSummaries, HistoryPage, ChatDetail, maximumFrameBytes, wireRevision, type SendCommand, type SendReceipt, type Bootstrap, type DirectoryResult, DirectoryChange } from "@escode/contracts";

const fileMethods = ["readDiff", "transferAction", "trashEntries", "readFile", "saveFile", "loadWorkspace", "persistWorkspace"];

function watchChanges(subscribe: (notify: (error?: string) => void) => () => void) {
  return Stream.callback<typeof DirectoryChange.Type>(queue => Effect.acquireRelease(
    Effect.try({ try: () => {
      let failure: string | undefined;
      const release = subscribe(error => {
        failure = error ?? failure;
        Queue.offerUnsafe(queue, failure ? { error: failure } : {});
      });
      Queue.offerUnsafe(queue, { ready: true }); // Revalidate after the watch is installed.
      return release;
    }, catch: String }).pipe(Effect.catch(error => Effect.sync(() => {
      Queue.offerUnsafe(queue, { error });
      return () => {};
    }))), release => Effect.sync(release),
  ), { bufferSize: 1, strategy: "sliding" });
}

// Guard parser/error writes too; they bypass the RPC response budget.
class BoundedWebSocket extends WebSocket {
  override emit(event: string | symbol, ...args: any[]): boolean {
    if (event === "message" && Buffer.byteLength(args[0]) > maximumFrameBytes) {
      try {
        const request = JSON.parse(String(args[0]));
        if (request?._tag !== "Request" || !fileMethods.includes(request.tag)) {
          this.terminate(); return false;
        }
      } catch { this.terminate(); return false; }
    }
    return super.emit(event, ...args);
  }
  override send(
    data: Parameters<WebSocket["send"]>[0],
    options?: Parameters<WebSocket["send"]>[1] | ((error?: Error) => void),
    callback?: (error?: Error) => void,
  ): void {
    if (this.bufferedAmount > maximumFrameBytes) { this.terminate(); return; }
    if (typeof options === "function") super.send(data, options);
    else if (options) super.send(data, options, callback);
    else super.send(data, callback);
  }
}

// One host scope; no provider or project resource belongs to a socket.
export async function startHost(options: {
  hostId: string; clientId: string; origin: string;
  list(root: string, path: string): Promise<DirectoryResult>;
  watch?(root: string, paths: readonly string[], notify: (error?: string) => void): () => void;
  gitStatus?: (root: string) => Promise<typeof import("@escode/contracts").GitStatus.Type>;
  worktreeOptions?: (root: string) => Promise<typeof import("@escode/contracts").WorktreeOptions.Type>;
  summaries?: () => Promise<ChatSummaries["chats"]>;
  chatSnapshot?: (project: string | null, id: string) => Promise<ChatDetail>;
  openChat?: (project: string | null, id: string) => Promise<ChatDetail>;
  checkpointPoints?: (project: string | null, id: string, cursor: string | null) => Promise<typeof CheckpointPage.Type>;
  rewind?: (project: string | null, id: string, boundary: string, token: string | null, commandId: string | null) => Promise<RewindResult>;
  inspectFiles?: (project: string | null, id: string, boundary: string, path: string | null, cursor: string | null) => Promise<import("@escode/contracts").FileInspection>;
  inspectBoundary?: (project: string | null, id: string, boundary: string, cursor: string | null) => Promise<typeof BoundaryInspection.Type>;
  history?: (project: string | null, id: string, cursor: string | null) => Promise<HistoryPage>;
  moveEntry?: (command: import("@escode/contracts").MoveEntry) => Promise<unknown>;
  ackFileOperation?: (root: string) => Promise<void>;
  draftAction?: (action: import("@escode/contracts").DraftAction) => Promise<unknown>;
  sendState?: (project: string | null, id: string) => Promise<{ admissionEpoch: string; expected: string }>;
  sendMessage?: (command: SendCommand) => Promise<SendReceipt>;
  sendStatus?: (commandId: string) => Promise<SendReceipt | null>;
  createEntry?: (command: typeof import("@escode/contracts").CreateCommand.Type) => Promise<typeof import("@escode/contracts").CreateReceipt.Type>;
  createState?: () => string;
  transferAction?: (action: import("@escode/contracts").TransferAction) => Promise<typeof import("@escode/contracts").TransferResult.Type>;
  trashEntries?: (root: string, paths: readonly string[]) => Promise<typeof import("@escode/contracts").TrashBatch.Type>;
  readDiff?: (root: string, path: string, area: typeof import("@escode/contracts").DiffArea.Type) => Promise<typeof import("@escode/contracts").DiffComparison.Type>;
  observeFiles?: (root: string, notify: (error?: string) => void) => () => void;
  searchFiles?: (root: string, query: string, signal: AbortSignal, history?: readonly string[]) => Promise<import("@escode/contracts").LookupResult>;
  lookupFile?: (root: string, query: string) => Promise<string>;
  readFile?: (root: string, path: string) => Promise<typeof import("@escode/contracts").FileDocument.Type>;
  saveFile?: (root: string, path: string, text: string, version: string) => Promise<typeof import("@escode/contracts").FileSaveResult.Type>;
  loadWorkspace?: () => Promise<typeof import("@escode/contracts").WorkspaceLoad.Type>;
  persistWorkspace?: (state: typeof import("@escode/contracts").WorkspaceState.Type) => Promise<void>;
  now?: () => number;
}) {
  const epoch = randomUUID();
  let revision = 0;
  const statusObservation = coalesceObservation(async (root: string) => {
    if (!options.gitStatus) throw Error("Git observations unavailable");
    return options.gitStatus(root);
  });
  const worktreeObservation = coalesceObservation(async (root: string) => {
    if (!options.worktreeOptions) throw Error("Worktree observations unavailable");
    return options.worktreeOptions(root);
  });
  const now = options.now ?? Date.now;
  const tickets = new Map<string, number>();
  let port = 0;
  let ready!: () => void;
  let failed!: (error: unknown) => void;
  const started = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
  const program = Effect.gen(function* () {
    const server = yield* NodeHttpServer.make(createServer, {
      host: "127.0.0.1", port: 0, websocket: { maxPayload: maximumFileFrameBytes, perMessageDeflate: false, WebSocket: BoundedWebSocket },
    });
    if (server.address._tag !== "InetAddressV4") throw Error("Expected loopback address");
    port = server.address.port;
    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    const rejected = new Set<number>();
    const reject = (id: number) => {
      rejected.add(id);
      return protocol.send(id, { _tag: "Defect", defect: "Invalid request or request admission exhausted; output coverage reset" }).pipe(
        Effect.ensuring(Effect.sync(() => {
          for (const requestId of pending.get(id) ?? []) {
            acknowledge(id, requestId);
            Effect.runFork(interrupt(id, requestId));
          }
          pending.delete(id); liveRequests.delete(id);
        })));
    };
    const sentBytes = new Map<number, number>();
    const unacknowledged = new Map<number, Map<string | number, { bytes: number; timer: ReturnType<typeof setTimeout> }>>();
    const acknowledge = (id: number, requestId: string | number) => {
      const entry = unacknowledged.get(id)?.get(requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      sentBytes.set(id, Math.max(0, (sentBytes.get(id) ?? 0) - entry.bytes));
      unacknowledged.get(id)?.delete(requestId);
    };
    const fileRequests = new Map<number, Set<string | number>>();
    const pending = new Map<number, Set<string | number>>();
    const liveRequests = new Map<number, Set<string | number>>();
    let interrupt: (id: number, requestId: string | number) => Effect.Effect<void> = () => Effect.void;
    const stall = (id: number, requestId: string | number) => {
      acknowledge(id, requestId);
      return protocol.send(id, { _tag: "Exit", requestId, exit: { _tag: "Failure", cause: [{ _tag: "Fail", error: "Live delivery stalled. Output coverage reset; reopen the view. Provider work and control retained." }] } })
        .pipe(Effect.andThen(Effect.sync(() => { Effect.runFork(interrupt(id, requestId)); })));
    };
    const requestEnvelope = Schema.Struct({ _tag: Schema.Literal("Request"), id: Schema.Union([Schema.String, Schema.Number]),
      tag: Schema.Literals(["observeFiles", "searchFiles", "lookupFile", "gitStatus", "worktreeOptions", "readDiff", "transferAction", "trashEntries", "createState", "createEntry", "readFile", "saveFile", "loadWorkspace", "persistWorkspace", "listDirectory", "watchDirectories", "chatSummaries", "checkpointPoints", "rewind", "inspectFiles", "inspectBoundary", "chatHistory", "openChat", "chatLive", "sendState", "sendMessage", "sendStatus", "draftAction", "moveEntry", "ackFileOperation"]), payload: Schema.Unknown,
      headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
    });
    const boundedProtocol: typeof protocol = {
      ...protocol,
      run: (receive) => {
        interrupt = (id, requestId) => receive(id, { _tag: "Interrupt", requestId });
        return protocol.run((id, data) => Effect.suspend(() => {
        if (rejected.has(id)) return Effect.void;
        if (!data || typeof data !== "object") return reject(id);
        if (data._tag === "Request") {
          const requests = pending.get(id) ?? new Set<string | number>();
          if (!Schema.is(requestEnvelope)(data) || data.isNotification || data.discard ||
              requests.size >= 16 || requests.has(data.id)) return reject(id);
          if (data.tag === "searchFiles" && Buffer.byteLength(JSON.stringify(data)) > 256 * 1024) return reject(id);
          const file = fileMethods.includes(data.tag);
          if (Buffer.byteLength(JSON.stringify(data)) > (file ? maximumFileFrameBytes : maximumFrameBytes)) return reject(id);
          if (file) { const files = fileRequests.get(id) ?? new Set(); files.add(data.id); fileRequests.set(id, files); }
          requests.add(data.id); pending.set(id, requests);
          if (data.tag === "chatLive") {
            const live = liveRequests.get(id) ?? new Set<string | number>();
            live.add(data.id); liveRequests.set(id, live);
          }
        } else if (data._tag === "Ack" || data._tag === "Interrupt") {
          if (typeof data.requestId !== "string" && typeof data.requestId !== "number") return reject(id);
          acknowledge(id, data.requestId);
        } else if (data._tag !== "Ping" && data._tag !== "Eof") return reject(id);
        return receive(id, data);
      }));
      },
      send: (id, response, transferables) => {
        if (rejected.has(id)) return Effect.void;
        const bytes = (sentBytes.get(id) ?? 0) + Buffer.byteLength(JSON.stringify(response));
        if (response._tag === "Chunk" && liveRequests.get(id)?.has(response.requestId) && bytes > 1.5 * maximumFrameBytes)
          return stall(id, response.requestId);
        if (bytes > ("requestId" in response && fileRequests.get(id)?.has(response.requestId) ? maximumFileFrameBytes : 2 * maximumFrameBytes)) return reject(id);
        if (response._tag === "Chunk") sentBytes.set(id, bytes);
        if (response._tag === "Chunk") {
          const chunks = unacknowledged.get(id) ?? new Map();
          chunks.set(response.requestId, { bytes: Buffer.byteLength(JSON.stringify(response)),
            timer: setTimeout(() => { Effect.runFork(stall(id, response.requestId)); }, 15000) });
          unacknowledged.set(id, chunks);
        }
        if (response._tag === "Exit") {
          fileRequests.get(id)?.delete(response.requestId);
          pending.get(id)?.delete(response.requestId);
          liveRequests.get(id)?.delete(response.requestId);
        }
        return protocol.send(id, response, transferables);
      },
    };
    yield* RpcServer.make(HostQueries, { concurrency: 16, onDisconnect: (id) => Effect.sync(() => { pending.delete(id); fileRequests.delete(id); liveRequests.delete(id); rejected.delete(id); sentBytes.delete(id);
      for (const chunk of unacknowledged.get(id)?.values() ?? []) clearTimeout(chunk.timer);
      unacknowledged.delete(id); }) }).pipe(
      Effect.provideService(RpcServer.Protocol, boundedProtocol),
      Effect.provide(HostQueries.toLayer({
        gitStatus: ({ root }) => Effect.tryPromise({ try: () => statusObservation(root), catch: String }),
        worktreeOptions: ({ root }) => Effect.tryPromise({ try: () => worktreeObservation(root), catch: String }),
        transferAction: ({ action }) => Effect.tryPromise({ try: async () => {
          if (!options.transferAction) throw Error("Transfers unavailable"); return options.transferAction(action);
        }, catch: String }),
        createState: () => Effect.try({ try: () => { if (!options.createState) throw Error("Files unavailable"); return options.createState(); }, catch: String }),
        createEntry: ({ command }) => Effect.tryPromise({ try: async () => {
          if (!options.createEntry) throw Error("Files unavailable"); return options.createEntry(command);
        }, catch: String }),
        readDiff: ({ root, path, area }) => Effect.tryPromise({ try: async () => {
          if (!options.readDiff) throw Error("Diffs unavailable"); return options.readDiff(root, path, area);
        }, catch: String }),
        observeFiles: ({ root }) => watchChanges(notify => {
          if (!options.observeFiles) throw Error("Lookup observation unavailable");
          return options.observeFiles(root, notify);
        }),
        searchFiles: ({ root, query, history }) => Effect.tryPromise({ try: signal => { if (!options.searchFiles) throw Error("Lookup unavailable"); return options.searchFiles(root, query, signal, history); }, catch: String }),
        lookupFile: ({ root, query }) => Effect.tryPromise({ try: async () => {
          if (!options.lookupFile) throw Error("Files unavailable"); return options.lookupFile(root, query);
        }, catch: String }),
        readFile: ({ root, path }) => Effect.tryPromise({ try: async () => {
          if (!options.readFile) throw Error("Files unavailable"); return options.readFile(root, path);
        }, catch: String }),
        trashEntries: ({ root, paths }) => Effect.tryPromise({ try: async () => {
          if (!options.trashEntries) throw Error("Native Trash unavailable; no permanent deletion attempted");
          return options.trashEntries(root, paths);
        }, catch: String }),
        saveFile: ({ root, path, text, version }) => Effect.tryPromise({ try: async () => {
          if (!options.saveFile) throw Error("Files unavailable"); return options.saveFile(root, path, text, version);
        }, catch: String }),
        loadWorkspace: () => Effect.tryPromise({ try: async () => {
          if (!options.loadWorkspace) throw Error("Recovery unavailable"); return options.loadWorkspace();
        }, catch: String }),
        persistWorkspace: ({ state }) => Effect.tryPromise({ try: async () => {
          if (!options.persistWorkspace) throw Error("Recovery unavailable"); return options.persistWorkspace(state);
        }, catch: String }),
        moveEntry: ({ command }) => Effect.tryPromise({ try: async () => {
          if (!options.moveEntry) throw Error("Move unavailable");
          return Schema.decodeUnknownSync(MoveResult)(await options.moveEntry(command));
        }, catch: String }),
        ackFileOperation: ({ root }) => Effect.tryPromise({ try: async () => {
          if (!options.ackFileOperation) throw Error("Acknowledgement unavailable");
          await options.ackFileOperation(root);
        }, catch: String }),
        draftAction: ({ action }) => Effect.tryPromise({ try: async () => {
          if (!options.draftAction) throw Error("Draft editing unavailable");
          return Schema.decodeUnknownSync(DraftRecord)({ ...await options.draftAction(action) as object, draft: "" });
        }, catch: String }),
        sendState: ({ project, id }) => Effect.tryPromise({ try: async () => {
          if (!options.sendState) throw Error("Send unavailable");
          return options.sendState(project, id);
        }, catch: String }),
        sendMessage: ({ command }) => Effect.tryPromise({ try: async () => {
          if (!options.sendMessage) throw Error("Send unavailable");
          return options.sendMessage(command);
        }, catch: String }),
        sendStatus: ({ commandId }) => Effect.tryPromise({ try: async () => {
          if (!options.sendStatus) throw Error("Send unavailable");
          return options.sendStatus(commandId);
        }, catch: String }),
        chatLive: ({ project, id }) => Stream.suspend(() => {
          let previous: ChatDetail | undefined, revision = 0;
          return Stream.fromEffectSchedule(Effect.tryPromise({ try: async () => {
            if (!options.chatSnapshot) throw Error("Live output unavailable");
            const detail = Schema.decodeUnknownSync(ChatDetail)(await options.chatSnapshot(project, id));
            if (Buffer.byteLength(JSON.stringify(detail)) > maximumFrameBytes / 2) throw Error("Live output unavailable: capacity exhausted; control retained");
            const changes: LiveBatch["changes"][number][] = [];
            for (const item of detail.items) {
              const old = previous?.items.find(value => value.id === item.id && value.turnId === item.turnId);
              if (JSON.stringify(old) === JSON.stringify(item)) continue;
              const append = !!old && old.type === item.type && old.revision === item.revision && item.text.startsWith(old.text);
              changes.push({ item: { ...item, text: append ? item.text.slice(old!.text.length) : item.text }, append });
            }
            const removed = previous?.items.filter(old => !detail.items.some(item => item.id === old.id && item.turnId === old.turnId)).map(({ id, turnId }) => ({ id, turnId })) ?? [];
            const batch = Schema.decodeUnknownSync(LiveBatch)({ epoch, revision: ++revision, detail: { ...detail, items: [] }, changes, removed });
            previous = detail;
            return batch;
          }, catch: String }), Schedule.spaced("100 millis"));
        }),
        openChat: ({ project, id }) => Effect.tryPromise({ try: async () => {
          if (!options.openChat) throw Error("Chat unavailable");
          const detail = await options.openChat(project, id);
          if (Buffer.byteLength(JSON.stringify(detail)) > maximumFrameBytes / 2) throw Error("Chat detail unavailable: capacity exhausted");
          return Schema.decodeUnknownSync(ChatDetail)(detail);
        }, catch: String }),
        checkpointPoints: ({ project, id, cursor }) => Effect.tryPromise({ try: async () => {
          if (!options.checkpointPoints) throw Error("Checkpoints unavailable");
          const result = await options.checkpointPoints(project, id, cursor);
          if (Buffer.byteLength(JSON.stringify(result)) > maximumFrameBytes / 2) throw Error("Checkpoint capacity exhausted");
          return Schema.decodeUnknownSync(CheckpointPage)(result);
        }, catch: String }),
        rewind: ({ project, id, boundary, token, commandId }) => Effect.tryPromise({ try: async () => {
          if (!options.rewind) throw Error("Rewind unavailable");
          return Schema.decodeUnknownSync(RewindResult)(await options.rewind(project, id, boundary, token, commandId));
        }, catch: String }),
        inspectFiles: ({ project, id, boundary, path, cursor }) => Effect.tryPromise({ try: async () => {
          if (!options.inspectFiles) throw Error("File inspection unavailable");
          const result = await options.inspectFiles(project, id, boundary, path, cursor);
          if (Buffer.byteLength(JSON.stringify(result)) > maximumFrameBytes / 2) throw Error("Inspection capacity exhausted");
          return Schema.decodeUnknownSync(FileInspection)(result);
        }, catch: String }),
        inspectBoundary: ({ project, id, boundary, cursor }) => Effect.tryPromise({ try: async () => {
          if (!options.inspectBoundary) throw Error("Inspection unavailable");
          const result = await options.inspectBoundary(project, id, boundary, cursor);
          if (Buffer.byteLength(JSON.stringify(result)) > maximumFrameBytes / 2) throw Error("Inspection capacity exhausted");
          return Schema.decodeUnknownSync(BoundaryInspection)(result);
        }, catch: String }),
        chatHistory: ({ project, id, cursor }) => Effect.tryPromise({ try: async () => {
          if (!options.history) throw Error("History unavailable");
          const page = await options.history(project, id, cursor);
          if (Buffer.byteLength(JSON.stringify(page)) > maximumFrameBytes / 2) throw Error("History page unavailable: capacity exhausted");
          return Schema.decodeUnknownSync(HistoryPage)(page);
        }, catch: String }),
        chatSummaries: () => Stream.fromEffectSchedule(Effect.tryPromise({ try: async () => {
          const chats = await options.summaries?.() ?? [];
          if (Buffer.byteLength(JSON.stringify(chats)) > maximumFrameBytes / 2) throw Error("Chat summary capacity exhausted");
          return Schema.decodeUnknownSync(ChatSummaries)({ epoch, revision: ++revision, chats });
        }, catch: String }), Schedule.spaced("300 millis")), listDirectory: ({ root, path }) =>
        Effect.tryPromise(() => options.list(root, path)).pipe(Effect.catch(() =>
          Effect.succeed({ kind: "unavailable" as const, message: "Directory unavailable. Refresh to retry." }))),
        watchDirectories: ({ root, paths }) => watchChanges(notify => {
          if (!options.watch) throw Error("Directory watches unavailable");
          return options.watch(root, paths, notify);
        }),
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
      return yield* httpEffect.pipe(
        Effect.as(HttpServerResponse.empty()), Effect.ensuring(Effect.sync(() => { connections--; })));
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
