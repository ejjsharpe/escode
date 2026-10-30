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
export const DirectoryChange = Schema.Struct({ error: Schema.optionalKey(Schema.String) });
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
