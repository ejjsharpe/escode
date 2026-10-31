import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export const wireRevision = "1";
export const maximumFileFrameBytes = 32 * 1024 * 1024;
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
export const TitleAction = Schema.Struct({ project: Schema.NullOr(Schema.String), id: Schema.String,
  title: Schema.optionalKey(Schema.String) });
export type TitleAction = typeof TitleAction.Type;
export const ChatSummary = Schema.Struct({
  id: Schema.String, project: Schema.NullOr(Schema.String), checkout: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  title: Schema.optional(Schema.String),
  archived: Schema.optional(Schema.Boolean),
  latestUserMessageAt: Schema.optional(Schema.Number),
  latestUserMessageCreatedAt: Schema.optional(Schema.Number),
  updatedAt: Schema.optional(Schema.Number),
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
export const HistoryItem = Schema.Struct({ id: Schema.String, turnId: Schema.String, type: Schema.String, text: Schema.String, revision: Schema.optional(Schema.String) });
export const HistoryPage = Schema.Struct({
  revision: Schema.String,
  items: Schema.Array(HistoryItem),
  nextCursor: Schema.NullOr(Schema.String),
});
export type HistoryPage = typeof HistoryPage.Type;
export const CheckpointPoint = Schema.Struct({
  id: Schema.String, kind: Schema.Literals(["before-message", "after-turn"]), createdAt: Schema.Number,
  threadId: Schema.NullOr(Schema.String), turnId: Schema.NullOr(Schema.String),
  availability: Schema.Literals(["available", "unavailable"]), reason: Schema.NullOr(Schema.String),
});
export const CheckpointPage = Schema.Struct({ points: Schema.Array(CheckpointPoint).check(Schema.isMaxLength(20)), nextCursor: Schema.NullOr(Schema.String) });
export type CheckpointPage = typeof CheckpointPage.Type;
export const FileInspection = Schema.Struct({
  availability: Schema.Literals(["available", "unavailable"]), message: Schema.String,
  paths: Schema.Array(Schema.String).check(Schema.isMaxLength(20)), nextCursor: Schema.NullOr(Schema.String),
  before: Schema.NullOr(Schema.String.check(Schema.isMaxLength(131072))), after: Schema.NullOr(Schema.String.check(Schema.isMaxLength(131072))),
  beforeMode: Schema.NullOr(Schema.Number), afterMode: Schema.NullOr(Schema.Number),
});
export type FileInspection = typeof FileInspection.Type;
export const BoundaryInspection = Schema.Struct({ page: HistoryPage, availability: Schema.Literals(["available", "unavailable"]), message: Schema.String });
export type BoundaryInspection = typeof BoundaryInspection.Type;
export const ChatDetail = Schema.Struct({
  project: Schema.NullOr(Schema.String), chatId: Schema.String, threadId: Schema.NullOr(Schema.String),
  controlTarget: Schema.optional(Schema.String), preparing: Schema.optional(Schema.Boolean), connected: Schema.Boolean, busy: Schema.Boolean, turnId: Schema.NullOr(Schema.String),
  settings: Schema.Unknown, items: HistoryPage.fields.items,
  requests: Schema.Array(Schema.Struct({ token: Schema.String, method: Schema.String, params: Schema.Unknown })),
  error: Schema.NullOr(Schema.String), contextError: Schema.optional(Schema.NullOr(Schema.String)),
  history: Schema.optional(Schema.Struct({ nextCursor: Schema.NullOr(Schema.String), revision: Schema.String })),
});
export type ChatDetail = typeof ChatDetail.Type;
export const LiveBatch = Schema.Struct({
  epoch: Schema.String, revision: Schema.Number,
  detail: ChatDetail,
  changes: Schema.Array(Schema.Struct({ item: HistoryItem, append: Schema.Boolean })),
  removed: Schema.Array(Schema.Struct({ id: Schema.String, turnId: Schema.String })),
});
export type LiveBatch = typeof LiveBatch.Type;
export const HistoryQuery = { project: Schema.NullOr(Schema.String), id: Schema.String.check(Schema.isMaxLength(100)),
  cursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))) };
export const SendCommand = Schema.Struct({
  commandId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  admissionEpoch: Schema.String, project: Schema.NullOr(Schema.String), id: Schema.String,
  control: Schema.optional(Schema.Struct({ operation: Schema.Literals(["stop", "answer"]), emergency: Schema.optional(Schema.Boolean), target: Schema.String, token: Schema.String, answer: Schema.Unknown })),
  expected: Schema.String, text: Schema.String.check(Schema.isMaxLength(100000)),
});
export type SendCommand = typeof SendCommand.Type;
export const SendReceipt = Schema.Struct({ reason: Schema.optionalKey(Schema.Literal("emergency-stop-available")), hostId: Schema.String, clientId: Schema.String, command: SendCommand,
  status: Schema.Literals(["admitted", "dispatching", "accepted", "uncertain", "rejected"]),
  message: Schema.String,
});
export type SendReceipt = typeof SendReceipt.Type;
export const SendState = Schema.Struct({ admissionEpoch: Schema.String, expected: Schema.String });

export const DraftRecord = Schema.Struct({
  id: ChatSummary.fields.id, project: ChatSummary.fields.project, checkout: ChatSummary.fields.checkout,
  threadId: ChatSummary.fields.threadId, phase: ChatSummary.fields.phase,
  createdAt: ChatSummary.fields.createdAt, legacyOrder: ChatSummary.fields.legacyOrder,
  worktree: ChatSummary.fields.worktree, scratch: ChatSummary.fields.scratch,
  initialSend: ChatSummary.fields.initialSend, hasSent: ChatSummary.fields.hasSent,
  draft: Schema.Literal(""),
});
export const DraftAction = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("archive"), project: Schema.NullOr(Schema.String), id: Schema.String, expected: Schema.String, archived: Schema.Boolean }),
  Schema.Struct({ operation: Schema.Literal("createDraft"), project: Schema.NullOr(Schema.String), checkout: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ operation: Schema.Literal("context"), project: Schema.NullOr(Schema.String),
    id: Schema.String, expected: Schema.String, target: Schema.NullOr(Schema.String) }),
  Schema.Struct({ operation: Schema.Literal("execution"), project: Schema.String,
    id: Schema.String, expected: Schema.String, mode: Schema.Literals(["new", "reuse"]), value: Schema.String, commit: Schema.String }),
]);
export type DraftAction = typeof DraftAction.Type;


export const FileDocument = Schema.Struct({ text: Schema.String, version: Schema.String });
export const FileSaveResult = Schema.Struct({ kind: Schema.Literals(["saved", "conflict"]), disk: FileDocument,
  persistencePending: Schema.optionalKey(Schema.Boolean), message: Schema.optionalKey(Schema.String) });
export const maximumRecentFiles = 200;
export const maximumRecentUnits = 32768;
export const WorkspaceState = Schema.Struct({
  sidebarWidth: Schema.optionalKey(Schema.Number.check(Schema.isBetween({ minimum: 190, maximum: 380 }))),
  projects: Schema.Array(Schema.Struct({ project: Schema.String, root: Schema.String })),
  savedProjects: Schema.optionalKey(Schema.Array(Schema.Struct({ project: Schema.String, root: Schema.String }))),
  projectUse: Schema.optionalKey(Schema.Array(Schema.Struct({ project: Schema.String, checkout: Schema.optionalKey(Schema.String) }))),
  recentFiles: Schema.optionalKey(Schema.Array(Schema.Struct({ root: Schema.String.check(Schema.isMaxLength(4096)), path: Schema.String.check(Schema.isMaxLength(4096)) })).check(Schema.isMaxLength(maximumRecentFiles))),
  agentsChat: Schema.optionalKey(Schema.String), selected: Schema.String,
  views: Schema.Record(Schema.String, Schema.Struct({
    files: Schema.optionalKey(Schema.Struct({ expanded: Schema.Array(Schema.String), selected: Schema.Array(Schema.String),
      focus: Schema.String, scroll: Schema.Number, scrollAnchor: Schema.optional(Schema.Struct({ path: Schema.String, offset: Schema.Number })), hideIgnored: Schema.optionalKey(Schema.Boolean) })),
    mode: Schema.optionalKey(Schema.String), checkout: Schema.optionalKey(Schema.String), roots: Schema.optionalKey(Schema.Array(Schema.String)),
    fileViews: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(["file", "staged", "unstaged", "untracked", "conflict"]))),
    editorPositions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String,
      Schema.Struct({ line: Schema.Number, column: Schema.Number, top: Schema.Number, left: Schema.Number })))),
    preview: Schema.optionalKey(Schema.String),
    openFiles: Schema.optionalKey(Schema.Array(Schema.String)),
    path: Schema.optionalKey(Schema.String), directory: Schema.optionalKey(Schema.String), chat: Schema.optionalKey(Schema.String),
    change: Schema.optionalKey(Schema.Struct({ path: Schema.String, area: Schema.Literals(["staged", "unstaged", "untracked"]) })),
  })),
  drafts: Schema.Array(Schema.Struct({ root: Schema.String, path: Schema.String, text: Schema.String, disk: FileDocument })),
});
export const WorkspaceLoad = Schema.Struct({ acknowledgementRoots: Schema.optionalKey(Schema.Array(Schema.String)), state: WorkspaceState, errors: Schema.Array(Schema.String),
  restored: Schema.Array(Schema.Struct({ project: Schema.String, root: Schema.String, branch: Schema.String,
    changes: Schema.Array(Schema.Struct({ path: Schema.String, area: Schema.Literals(["staged", "unstaged", "untracked"]) })),
    gitError: Schema.optionalKey(Schema.String), approvalRequired: Schema.optionalKey(Schema.Boolean) })) });
export const CreateCommand = Schema.Struct({ commandId: Schema.String, admissionEpoch: Schema.String, root: Schema.String, parent: Schema.String, name: Schema.String, kind: Schema.Literals(["file", "folder"]) });
export const CreateReceipt = Schema.Struct({ command: CreateCommand, status: Schema.Literals(["dispatching", "accepted", "rejected", "uncertain"]), message: Schema.String, path: Schema.String });
export const TrashBatch = Schema.Struct({
  results: Schema.Array(Schema.Struct({ source: Schema.String, applied: Schema.Boolean, message: Schema.String,
    persistencePending: Schema.optionalKey(Schema.Boolean),
    intent: Schema.optionalKey(Schema.Struct({ root: Schema.String, checkoutIdentity: Schema.String,
      source: Schema.String, destination: Schema.String, kind: Schema.Literals(["move", "trash", "save", "copy"]),
      identity: Schema.String, completed: Schema.optionalKey(Schema.Boolean), temporary: Schema.optionalKey(Schema.String),
      copies: Schema.optionalKey(WorkspaceState.fields.drafts), saveText: Schema.optionalKey(Schema.String),
      savedDisk: Schema.optionalKey(FileDocument),
    })),
    conflict: Schema.optionalKey(Schema.Struct({ path: Schema.String, disk: FileDocument })),
  })),
  saves: Schema.Array(Schema.Struct({ path: Schema.String, disk: FileDocument })),
  requiresAck: Schema.Boolean, message: Schema.String,
});
const TransferPaths = Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(10000));
export const TransferAction = Schema.Union([
  Schema.Struct({ root: Schema.String, operation: Schema.Literal("drag-capture"), paths: TransferPaths }),
  Schema.Struct({ root: Schema.String, operation: Schema.Literal("clipboard-capture"), kind: Schema.Literals(["copy", "cut"]), paths: TransferPaths }),
  Schema.Struct({ root: Schema.String, operation: Schema.Literal("transfer"), commandId: Schema.String, admissionEpoch: Schema.String, kind: Schema.Literals(["paste", "duplicate", "drag-move", "drag-copy", "import"]), parent: Schema.String, paths: Schema.Array(Schema.String).check(Schema.isMaxLength(10000)) }),
]);
export type TransferAction = typeof TransferAction.Type;
export const TransferResult = Schema.Union([Schema.String, Schema.Struct({
  results: TrashBatch.fields.results, open: Schema.Array(Schema.String),
  requiresAck: Schema.Boolean, message: Schema.String, uncertain: Schema.optionalKey(Schema.Boolean),
})]);
export const DiffComparison = Schema.Struct({ original: Schema.String, modified: Schema.String });
export const DiffArea = Schema.Literals(["staged", "unstaged", "untracked"]);
export const LookupResult = Schema.Struct({
  results: Schema.Array(Schema.Struct({ path: Schema.String.check(Schema.isMaxLength(4096)), score: Schema.Number, recent: Schema.optionalKey(Schema.Boolean), positions: Schema.Array(Schema.Number).check(Schema.isMaxLength(256)) })).check(Schema.isMaxLength(100)),
  partial: Schema.Boolean, message: Schema.String.check(Schema.isMaxLength(2048)),
});
export type LookupResult = typeof LookupResult.Type;
export const Files = RpcGroup.make(
  Rpc.make("observeFiles", { payload: { root: Schema.String.check(Schema.isMaxLength(4096)) }, success: DirectoryChange, stream: true }),
  Rpc.make("readDiff", { payload: { root: Schema.String, path: Schema.String, area: DiffArea }, success: DiffComparison, error: Schema.String }),
  Rpc.make("transferAction", { payload: { action: TransferAction }, success: TransferResult, error: Schema.String }),
  Rpc.make("createEntry", { payload: { command: CreateCommand }, success: CreateReceipt, error: Schema.String }),
  Rpc.make("createState", { success: Schema.String, error: Schema.String }),
  Rpc.make("trashEntries", { payload: { root: Schema.String, paths: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(10000)) }, success: TrashBatch, error: Schema.String }),
  Rpc.make("searchFiles", { payload: { root: Schema.String.check(Schema.isMaxLength(4096)), query: Schema.String.check(Schema.isMaxLength(256)), history: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMaxLength(4096))).check(Schema.isMaxLength(maximumRecentFiles))) }, success: LookupResult, error: Schema.String }),
  Rpc.make("lookupFile", { payload: { root: Schema.String.check(Schema.isMaxLength(4096)), query: Schema.String.check(Schema.isMaxLength(4096)) }, success: Schema.String, error: Schema.String }),
  Rpc.make("readFile", { payload: { root: Schema.String, path: Schema.String }, success: FileDocument, error: Schema.String }),
  Rpc.make("saveFile", { payload: { root: Schema.String, path: Schema.String, text: Schema.String, version: Schema.String }, success: FileSaveResult, error: Schema.String }),
  Rpc.make("clientChatStorage", { payload: { state: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) }, success: Schema.Record(Schema.String, Schema.String), error: Schema.String }),
  Rpc.make("loadWorkspace", { success: WorkspaceLoad, error: Schema.String }),
  Rpc.make("persistWorkspace", { payload: { state: WorkspaceState }, success: Schema.Void, error: Schema.String }),
);

export const MoveEntry = Schema.Struct({
  root: Schema.String, action: Schema.Literals(["move", "rename"]),
  source: Schema.String, target: Schema.String,
});
export type MoveEntry = typeof MoveEntry.Type;
export const MoveResult = Schema.Struct({
  applied: Schema.Boolean, message: Schema.String, persistencePending: Schema.optionalKey(Schema.Boolean),
  intent: Schema.optionalKey(Schema.Struct({ root: Schema.String, checkoutIdentity: Schema.String,
    source: Schema.String, destination: Schema.String, kind: Schema.Literal("move"), identity: Schema.String,
    completed: Schema.optionalKey(Schema.Boolean),
  })),
});
export const GitStatus = Schema.Struct({
  project: Schema.String, root: Schema.String, branch: Schema.String,
  changes: Schema.Array(Schema.Struct({ path: Schema.String, area: Schema.Literals(["staged", "unstaged", "untracked"]) })),
  gitError: Schema.optionalKey(Schema.String),
});
export const WorktreeOptions = Schema.Struct({
  bases: Schema.Array(Schema.Struct({ ref: Schema.String, commit: Schema.String })),
  defaultRef: Schema.String, checkouts: Schema.Array(Schema.String),
});
export const GitQueries = RpcGroup.make(
  Rpc.make("gitStatus", { payload: { root: Schema.String }, success: GitStatus, error: Schema.String }),
  Rpc.make("worktreeOptions", { payload: { root: Schema.String }, success: WorktreeOptions, error: Schema.String }),
);

export const RewindResult = Schema.Struct({ status: Schema.Literals(["ready", "applied", "unavailable", "uncertain"]), token: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))), message: Schema.String });
export type RewindResult = typeof RewindResult.Type;
export type HistoricalAction = "rewind" | "restore" | "branch" | "summarized";
export const PermissionChoices = Schema.Struct({ choice: Schema.NullOr(Schema.String), blocked: Schema.Boolean, message: Schema.String });
export type PermissionChoices = typeof PermissionChoices.Type;
export const ModelChoices = Schema.Struct({ models: Schema.Array(Schema.Struct({ model: Schema.String, name: Schema.String, efforts: Schema.Array(Schema.String), defaultEffort: Schema.String })), choice: Schema.NullOr(Schema.Struct({ model: Schema.String, effort: Schema.String })) });
export type ModelChoices = typeof ModelChoices.Type;
export const HostQueries = Directories.merge(Files).merge(GitQueries).merge(RpcGroup.make(Rpc.make("chatPermissions", { payload: { project: Schema.NullOr(Schema.String), id: Schema.String, choice: Schema.optionalKey(Schema.Literals(["supervised", "edits", "full"])) }, success: PermissionChoices, error: Schema.String }), Rpc.make("chatModels", { payload: { project: Schema.NullOr(Schema.String), id: Schema.String, model: Schema.optionalKey(Schema.String), effort: Schema.optionalKey(Schema.String) }, success: ModelChoices, error: Schema.String }))).merge(RpcGroup.make(Rpc.make("checkpointRetention", { payload: { days: Schema.optionalKey(Schema.NullOr(Schema.Number)) }, success: Schema.NullOr(Schema.Number), error: Schema.String }), Rpc.make("moveEntry", { payload: { command: MoveEntry }, success: MoveResult, error: Schema.String }), Rpc.make("ackFileOperation", { payload: { root: Schema.String }, success: Schema.Void, error: Schema.String }), Rpc.make("titleAction", { payload: { action: TitleAction }, success: Schema.Void, error: Schema.String }), Rpc.make("draftAction", { payload: { action: DraftAction }, success: DraftRecord, error: Schema.String }), Rpc.make("sendState", { payload: { project: Schema.NullOr(Schema.String), id: Schema.String }, success: SendState, error: Schema.String }), Rpc.make("sendMessage", { payload: { command: SendCommand }, success: SendReceipt, error: Schema.String }), Rpc.make("sendStatus", { payload: { commandId: Schema.String }, success: Schema.NullOr(SendReceipt), error: Schema.String }), Rpc.make("chatSummaries", {
  success: ChatSummaries, error: Schema.String, stream: true,
}), Rpc.make("chatLive", { payload: { project: Schema.NullOr(Schema.String), id: Schema.String.check(Schema.isMaxLength(100)) }, success: LiveBatch, error: Schema.String, stream: true }), Rpc.make("openChat", { payload: { project: Schema.NullOr(Schema.String), id: Schema.String.check(Schema.isMaxLength(100)) }, success: ChatDetail, error: Schema.String }), Rpc.make("checkpointPoints", { payload: HistoryQuery, success: CheckpointPage, error: Schema.String }),
  Rpc.make("rewind", { payload: { restoreFiles: Schema.optional(Schema.Boolean), project: Schema.NullOr(Schema.String), id: Schema.String, boundary: Schema.String.check(Schema.isMaxLength(100)), token: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))), commandId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))) }, success: RewindResult, error: Schema.String }),
  Rpc.make("branchHistory", { payload: { summarized: Schema.optional(Schema.Boolean), project: Schema.NullOr(Schema.String), id: Schema.String, boundary: Schema.String.check(Schema.isMaxLength(100)), token: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))), commandId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))) }, success: RewindResult, error: Schema.String }),
  Rpc.make("inspectFiles", { payload: { ...HistoryQuery, boundary: Schema.String.check(Schema.isMaxLength(100)), path: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))) }, success: FileInspection, error: Schema.String }),
  Rpc.make("inspectBoundary", { payload: { ...HistoryQuery, boundary: Schema.String.check(Schema.isMaxLength(100)) }, success: BoundaryInspection, error: Schema.String }),
  Rpc.make("chatHistory", { payload: HistoryQuery, success: HistoryPage, error: Schema.String })));

// Host and renderer memory may mutate validated contract values.
export type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export type WorkspaceState = typeof WorkspaceState.Type;
