import { Effect, Cause, Result, Exit, Layer, Schedule, Schema, Scope, Semaphore, Stream, Fiber } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { Bootstrap, ChatDetail, HostQueries, type SendCommand, type HistoryPage, type ChatSummaries, type DirectoryResult } from "@escode/contracts";
export { createChatClient } from "./chat";

export function createHostClient(bootstrap: () => Promise<unknown>) {
  const queries = Semaphore.makeUnsafe(4);
  // Bulk rescans cannot occupy the permits or admission reserved for ordinary queries.
  const listings = Semaphore.makeUnsafe(4);
  let queued = 0, queuedListings = 0;
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
  function domainFailure(cause: Cause.Cause<unknown>) {
    const failure = Cause.findError(cause);
    return Result.isSuccess(failure) && typeof failure.success === "string" ? failure.success : undefined;
  }
  async function runQuery<A>(current: Promise<Client>, query: Effect.Effect<A, unknown>, signal?: AbortSignal): Promise<A> {
    const result = await Effect.runPromise(Effect.exit(query), { signal });
    if (Exit.isSuccess(result)) return result.value;
    if (signal?.aborted) throw Error("Query cancelled");
    const domain = domainFailure(result.cause);
    if (domain !== undefined) throw Error(domain);
    if (session?.client === current) await close();
    const failure = Cause.squash(result.cause);
    throw Cause.isUnknownError(failure) ? failure.cause : failure;
  }
  async function chatQuery<A>(request: (client: Client) => Effect.Effect<A, unknown>, waitsForConsent = false): Promise<A> {
    if (queued >= 16) throw Error("Chat query admission exhausted. Retry explicitly.");
    queued++;
    try {
      const current = connect();
      const query = queries.withPermit(Effect.gen(function* () {
        const client = yield* Effect.tryPromise(() => current);
        return yield* request(client);
      }));
      // Native confirmation waits for the user; expiring it cannot cancel admitted filesystem work.
      return await runQuery(current, waitsForConsent ? query : query.pipe(Effect.timeout("35 seconds")));
    } finally { queued--; }
  }
  return {
    gitStatus: (root: string) => chatQuery(client => client.gitStatus({ root })),
    worktreeOptions: (root: string) => chatQuery(client => client.worktreeOptions({ root })),
    createState: () => chatQuery(client => client.createState()),
    createEntry: (command: typeof import("@escode/contracts").CreateCommand.Type) => chatQuery(client => client.createEntry({ command })),
    transferAction: (action: import("@escode/contracts").TransferAction) => chatQuery(client => client.transferAction({ action }), true),
    trashEntries: (root: string, paths: readonly string[]) => chatQuery(client => client.trashEntries({ root, paths }), true),
    readDiff: (root: string, path: string, area: typeof import("@escode/contracts").DiffArea.Type) => chatQuery(client => client.readDiff({ root, path, area })),
    observeFiles(root: string, notify: (error?: string, ready?: boolean) => void) {
      const controller = new AbortController();
      const current = connect();
      const effect = Effect.gen(function* () {
        const client = yield* Effect.tryPromise(() => current);
        yield* client.observeFiles({ root }).pipe(Stream.runForEach(change => Effect.sync(() => {
          if (!controller.signal.aborted) notify(change.error, change.ready);
        })));
      });
      void runQuery(current, effect, controller.signal).catch(error => {
        if (!controller.signal.aborted) notify(String(error));
      });
      return () => controller.abort();
    },
    searchFiles(root: string, query: string, apply: (result: import("@escode/contracts").LookupResult) => void, error: (message: string) => void, history?: readonly string[]) {
      const controller = new AbortController();
      const current = connect();
      void current.then(client => runQuery(current, client.searchFiles({ root, query, history }), controller.signal)).then(result => { if (!controller.signal.aborted) apply(result); }, failure => { if (!controller.signal.aborted) error(String(failure)); });
      return () => controller.abort();
    },
    lookupFile: (root: string, query: string) => chatQuery(client => client.lookupFile({ root, query })),
    readFile: (root: string, path: string) => chatQuery(client => client.readFile({ root, path })),
    saveFile: (root: string, path: string, text: string, version: string) => chatQuery(client => client.saveFile({ root, path, text, version })),
    loadWorkspace: () => chatQuery(client => client.loadWorkspace()),
    persistWorkspace: (state: typeof import("@escode/contracts").WorkspaceState.Type) => chatQuery(client => client.persistWorkspace({ state })),
    moveEntry: (command: import("@escode/contracts").MoveEntry) => chatQuery(client => client.moveEntry({ command })),
    ackFileOperation: (root: string) => chatQuery(client => client.ackFileOperation({ root })),
    draftAction: (action: import("@escode/contracts").DraftAction) => chatQuery(client => client.draftAction({ action })),
    sendState: (project: string | null, id: string) => chatQuery(client => client.sendState({ project, id })),
    sendMessage: (command: SendCommand) => chatQuery(client => client.sendMessage({ command })),
    sendStatus: (commandId: string) => chatQuery(client => client.sendStatus({ commandId })),
    openChat: (project: string | null, id: string) => chatQuery(client => client.openChat({ project, id })),
    chatLive(project: string | null, id: string, apply: (detail: typeof ChatDetail.Type) => void, error: (message: string) => void, reconcile?: () => Promise<string | undefined>) {
      let active = true;
      const controller = new AbortController();
      let epoch: string | undefined, revision = 0;
      let items: typeof ChatDetail.Type.items = [];
      const attempt = () => Effect.gen(function* () {
        epoch = undefined; revision = 0; items = [];
        const client = yield* Effect.tryPromise(connect);
        const warning = reconcile ? yield* Effect.tryPromise(reconcile) : undefined;
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
          const domainError = Exit.isFailure(result) && domainFailure(result.cause) !== undefined;
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
    checkpointPoints: (project: string | null, id: string, cursor: string | null) => chatQuery(client => client.checkpointPoints({ project, id, cursor })),
    inspectBoundary: (project: string | null, id: string, boundary: string, cursor: string | null) => chatQuery(client => client.inspectBoundary({ project, id, boundary, cursor })),
    chatHistory: (project: string | null, id: string, cursor: string | null): Promise<HistoryPage> =>
      chatQuery(client => client.chatHistory({ project, id, cursor })),
    async listDirectory(root: string, path: string): Promise<DirectoryResult> {
      if (queuedListings >= 10000) throw Error("Directory query admission exhausted. Refresh to retry.");
      queuedListings++;
      const current = connect();
      try {
        return await runQuery(current, listings.withPermit(Effect.gen(function* () {
          const client = yield* Effect.tryPromise(() => current);
          return yield* client.listDirectory({ root, path });
        })).pipe(Effect.timeout("10 seconds")));
      } finally { queuedListings--; }
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
      void runQuery(current, effect, controller.signal).catch(async (error) => {
        if (disposed) return;
        if (!disposed) notify(String(error));
      });
      return () => { disposed = true; controller.abort(); };
    },
    chatSummaries(apply: (value: ChatSummaries) => void, error: (message: string) => void) {
      let active = true;
      const attempt = Effect.gen(function* () {
        const current = connect();
        yield* Effect.tryPromise(signal => runQuery(current, Effect.gen(function* () {
          const client = yield* Effect.tryPromise(() => current);
          yield* client.chatSummaries().pipe(Stream.runForEach(value => Effect.sync(() => { if (active) apply(value); })));
        }), signal)).pipe(Effect.catch(() => Effect.sync(() => {
          if (active) error("Chat summaries unavailable. Reconnecting…");
        })));
      }).pipe(Effect.catch(() => Effect.void), Effect.andThen(Effect.sleep("500 millis")));
      const fiber = Effect.runFork(Effect.forever(attempt));
      return () => { active = false; void Effect.runPromise(Fiber.interrupt(fiber)); };
    },
    close,
  };
}
