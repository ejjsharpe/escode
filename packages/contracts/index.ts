import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export const wireRevision = "1";
export const maximumFrameBytes = 1024 * 1024;
export const Listing = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ path: Schema.String, directory: Schema.Boolean })),
  ignored: Schema.Array(Schema.String),
  filterError: Schema.optionalKey(Schema.String),
});
export type Listing = typeof Listing.Type;
export const DirectoryResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("available"), listing: Listing }),
  Schema.Struct({ kind: Schema.Literals(["denied", "unavailable", "overflow"]), message: Schema.String }),
]);
export type DirectoryResult = typeof DirectoryResult.Type;
export const DirectoryChange = Schema.Struct({ error: Schema.optionalKey(Schema.String), ready: Schema.optionalKey(Schema.Boolean) });
export const Directories = RpcGroup.make(Rpc.make("listDirectory", {
  payload: { root: Schema.String, path: Schema.String }, success: DirectoryResult,
}), Rpc.make("watchDirectories", {
  payload: { root: Schema.String, paths: Schema.Array(Schema.String).check(Schema.isMaxLength(10000)) },
  success: DirectoryChange, stream: true,
}));
export const Bootstrap = Schema.Struct({
  hostId: Schema.String, clientId: Schema.String, wireRevision: Schema.Literal(wireRevision),
  url: Schema.String, expires: Schema.Number,
});
export type Bootstrap = typeof Bootstrap.Type;

// Summary projection deliberately excludes composer text, transcript bodies and live request payloads.
export const ChatSummary = Schema.Struct({
  id: Schema.String, project: Schema.NullOr(Schema.String), checkout: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  createdAt: Schema.optional(Schema.Number), legacyOrder: Schema.optional(Schema.Number),
  phase: Schema.optional(Schema.Literals(["draft", "bound"])),
  initialSend: Schema.optional(Schema.Literals(["preparing", "creating", "unaccepted", "uncertain", "accepted"])),
  scratch: Schema.optional(Schema.Struct({ path: Schema.String, dev: Schema.optional(Schema.Number), ino: Schema.optional(Schema.Number) })),
  hasSent: Schema.optional(Schema.Boolean),
  removed: Schema.optional(Schema.Boolean),
  worktree: Schema.optional(Schema.Struct({ ref: Schema.String, commit: Schema.String, source: Schema.String,
    reservation: Schema.optional(Schema.Struct({ root: Schema.String, branch: Schema.String, commit: Schema.String,
      dev: Schema.optional(Schema.Number), ino: Schema.optional(Schema.Number), error: Schema.optional(Schema.NullOr(Schema.String)) })) })),
  busy: Schema.Boolean, needsInput: Schema.Boolean, unavailable: Schema.Boolean,
});
export type ChatSummary = typeof ChatSummary.Type;
export const ChatSummaries = Schema.Struct({ epoch: Schema.String, revision: Schema.Number, chats: Schema.Array(ChatSummary) });
export type ChatSummaries = typeof ChatSummaries.Type;
export const HistoryPage = Schema.Struct({
  revision: Schema.String,
  items: Schema.Array(Schema.Struct({ id: Schema.String, turnId: Schema.String, type: Schema.String, text: Schema.String, revision: Schema.optional(Schema.String) })),
  nextCursor: Schema.NullOr(Schema.String),
});
export type HistoryPage = typeof HistoryPage.Type;
export const ChatDetail = Schema.Struct({
  project: Schema.NullOr(Schema.String), chatId: Schema.String, threadId: Schema.NullOr(Schema.String),
  connected: Schema.Boolean, busy: Schema.Boolean, turnId: Schema.NullOr(Schema.String),
  settings: Schema.Unknown, items: HistoryPage.fields.items,
  requests: Schema.Array(Schema.Struct({ token: Schema.String, method: Schema.String, params: Schema.Unknown })),
  error: Schema.NullOr(Schema.String),
  history: Schema.optional(Schema.Struct({ nextCursor: Schema.NullOr(Schema.String), revision: Schema.String })),
});
export type ChatDetail = typeof ChatDetail.Type;
export const HistoryQuery = { project: Schema.NullOr(Schema.String), id: Schema.String.check(Schema.isMaxLength(100)),
  cursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))) };
export const HostQueries = Directories.merge(RpcGroup.make(Rpc.make("chatSummaries", {
  success: ChatSummaries, error: Schema.String, stream: true,
}), Rpc.make("openChat", { payload: { project: Schema.NullOr(Schema.String), id: Schema.String.check(Schema.isMaxLength(100)) }, success: ChatDetail, error: Schema.String }), Rpc.make("chatHistory", { payload: HistoryQuery, success: HistoryPage, error: Schema.String })));
