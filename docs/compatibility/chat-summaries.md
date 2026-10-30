# Host chat summaries

Delivery for [List saved chats through the host](https://github.com/ejjsharpe/escode/issues/67), under the [fresh-state amendment](https://github.com/ejjsharpe/escode/issues/61#approved-scope-amendment).

Agents and project Chats share a single renderer summary catalogue from the authenticated local Effect WebSocket RPC host. Complete validated projections carry a host-start epoch and increasing revision; each replaces the previous catalogue atomically. Reconnection resnapshots without issuing a chat command. This slice uses complete periodic projections rather than retained incremental replay: there is no snapshot/live handoff gap or partial cursor to apply. Ordering and original per-project labels remain unchanged, including chats whose project editor is closed.

The desktop creates `host-chats-v1.json` with `{ version: 1, chats }`. It never reads/imports/deletes `chats.json`. Unsupported association versions reject reads and writes without changing bytes. The existing chat/context authority uses this single store. This slice does not import legacy composers, associations, worktrees or provider history. Other unmigrated domain stores and chat command/detail IPC remain subsequent replacement work. IPC `catalogue` and `list` have been removed; selected-chat `composer` reads initialize only that client's observed composer.

Summary schemas contain identities, checkout/preparation metadata and activity booleans, without composer text, transcript items, provider settings or live request bodies. Host projection validates directory availability without opening provider history. Project activity and Agents rows consume these same summaries. Only mounted selected conversations request detail snapshots; navigation removes observers and cached detail snapshots, and late replies cannot reinsert an unobserved detail. The last summary consumer interrupts its stream and releases its socket. Provider sessions remain host-owned.

Initial bounds reuse the directory host's 1 MiB frame limit, eight authenticated connections, sixteen admitted requests per connection, and 2 MiB delivery budget. A summary projection above 512 KiB fails visibly. Stream chunks retain their byte charge until acknowledgement; a missing ACK ends that connection after fifteen seconds. Healthy acknowledged streams have no fixed lifetime. The client retries summary reads after 500 ms; mutations are never replayed. Projections run every 300 ms. These are initial implementation limits, not measured production capacity. Broad multi-client/revocation and capacity qualification remain deferred.

Verification on the [recorded local installation](effect-local-target.md):

- `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`, `bun run package`.
- `bun run --cwd apps/desktop test -- host/directories.test.ts`: authenticated transport regression, live activity, increasing epoch-scoped revisions, cancellation cleanup, oversized summary rejection, and healthy acknowledged delivery beyond fifteen seconds and 2 MiB cumulative traffic.
- `bun run --cwd apps/desktop smoke -- tests/agents.spec.ts tests/project-drafts.spec.ts tests/chat-summaries.spec.ts`: shared identity/order/activity, retained closed-project visibility, context/draft persistence, empty fresh state beside unchanged legacy bytes, payload exclusion, and detail polling release on selection and Files navigation.
- Packaged restricted-PATH execution uses `ESCODE_PACKAGED=1 bun run --cwd apps/desktop smoke -- tests/chat-summaries.spec.ts`.

The existing Agents fixture's forced-crash restart explicitly removes the abandoned foundation owner lock after observing process exit. This is fixture-owned recovery; automatic stale-lock recovery is not claimed. The new-format version rejection check confirms exact-byte retention. No live provider turn is used by these fixtures.

Keyboard focus, accessible labels and row controls are unchanged. Existing keyboard activation in the Agents fixture is reused; no new manual VoiceOver acceptance is claimed. The full cross-domain desktop suite, broad capacity benchmark, multi-client recovery and manual accessibility qualification are not claimed by this slice.
