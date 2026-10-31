# SQLite move/Trash handoff (#123)

## Completion follow-up

The isolated `implement/123-recovery-delivery` worktree started at integration `e1fc441`, merged partial `10b56b0`, and then merged integration `d7fd558` (#125). Baseline `0a9c981` remains an ancestor. No issue closure, PR, or integration-branch merge was performed.

Completed move/Trash facts now publish transactionally to separate obligations for every saved workspace client, including the originating client. Another client's acknowledgement cannot clear them. Recovery and late snapshot persistence reconcile independent move text and baselines. Another client's Trash preserves its drafts at the original missing paths. Save and copy behavior remain separately owned; no other client's loaded save baseline is replaced by this publication.

Authenticated workspace load delivers outstanding acknowledgement roots. Renderer initialization persists the recovered workspace and awaits authenticated acknowledgements before mounting the editor. Failure is disclosed with edits retained. Multi-root acknowledgements retain facts for other roots. This directly fixes the previous permanently blocked restart path.

Executed follow-up evidence:

- Red/green regressions for restart acknowledgement delivery and independent-client move reconciliation.
- Authenticated load/persist/ack regressions for independent client move and Trash text/baseline retention.
- Actual native move and macOS Trash SIGKILL windows after mutation, committed outcome and acknowledgement. Mutation-only Trash remains uncertain with drafts retained; it is never inferred successful from absence.
- Partial move and Trash subprocess batches: one successful native effect, followed by a missing-source failure, then SIGKILL. These are bounded partial-batch cases, not every inter-item timing.
- Packaged Electron: all 11 existing operation/recovery scenarios passed, including authenticated preservation Save/Discard/Cancel, per-item failure and conflict choices. The strengthened interrupted-move recovery test additionally passes a visible folder rename after two restarts, retaining editor text and exact disk bytes. An initial locator failure was corrected to target the folder row.
- Typecheck, lint, build and macOS package passed; final merged-tree results follow below.

Qualification limits: no human VoiceOver/Finder review, power-loss, physical disk exhaustion or capacity/latency qualification. No live remote-client notification transport is added: other-client renderer convergence uses workspace load/reconnect; late snapshots are protected on persistence. Broader simultaneous multi-client notification/revocation qualification remains deferred by #117. Native Trash race and external-writer limits are unchanged. SQLite WAL NORMAL does not guarantee the latest acknowledged metadata after an OS crash or power loss.

The earlier partial implementation record below is historical; its originating-client-only and missing-renderer-handoff limitations are superseded by this follow-up.

## Original partial implementation

This branch preserves the #122 direct SQLite replacement and adds client-owned completed operation facts in the same host database. Facts survive per-item journal clearance and restart until explicit renderer acknowledgement. Each replacement uses SQLite revision checking and the existing 16 MiB admission bound. Recovery validates stored facts and never repeats filesystem mutations. A completed current intent protects the result-to-fact-write crash window. Failed fact persistence reports a pending recovery handoff instead of claiming durable completion.

The change reaches the SQLite recovery worker request validation, typed storage requests, operation journal, operation coordinator and real recovery fixtures. No UI, public transport contract, glossary concept, import, JSON persistence or dependency is added.

## Executed evidence

- The new restart/late-snapshot batch regression failed before implementation: both moved descendant paths reverted to their original paths.
- The 49-case file-operation, SQLite recovery and journal suite passed after implementation.
- The expanded nine-case SQLite recovery suite passed, including authenticated move admission/outcome failures against real SQLite abort triggers and a real Git checkout. Failed admission left exact disk bytes intact; failed result persistence retained available descendant text and the loaded baseline.
- Two additional subprocess cases perform the actual native move, then SIGKILL after mutation or committed outcome before workspace handoff. Reopen retains identities, original baselines and edited text, reconciles the move and preserves later external bytes without replay.
- Typecheck, lint, build and macOS package passed. Packaged UI execution and human/native accessibility checks were not performed.
- Full serial regression result is recorded below after completion.

## Unmet acceptance and limits

This is not complete #123 acceptance. Completed facts and acknowledgements are scoped to their originating client. Another client's saved workspace is not yet reconciled from those facts. Therefore acceptance criteria 2 and 4 remain unmet for cross-client moves/Trash, despite isolated acknowledgement ownership.

The new hard-crash cases cover move only, not actual native Trash mutation/result/acknowledgement crash windows or partial-batch subprocess crashes. Existing real operation tests cover Trash and partial outcomes, but do not establish that additional crash qualification. Authentication is exercised for move failure; exhaustive authenticated Trash preservation choices remain unqualified. Criteria 1, 3 and 5 have focused regression coverage, not a claim of complete workflow qualification.

No physical full-disk, power-loss, production capacity or latency claim is made. WAL NORMAL retains its accepted OS/power-loss limit. Existing native and external-writer race guarantees are unchanged.

Started at integration 2fc88c1 in the clean isolated worktree t3-18ae04ab; accepted baseline 0a9c981 remains an ancestor. Integration was merged before reporting and was still 2fc88c1. No issue write, closure, PR or integration-branch merge was performed.

## Final integration checks

Merged integration e1fc441 (durable preparation), resolving the worker request-dispatch conflict by retaining preparation observation and adding fileFacts to the recovery-kind allowlist. On that merged tree, all 52 focused operation/journal/SQLite recovery tests and all five durable Send tests pass. Typecheck, lint, build and macOS package pass.

The broad serial suite overlapped the integration merge and reported durable-Send and worktree-preparation failures. It is not a clean final full-suite result; durable Send passes on the subsequent isolated rerun. Complete broad regression qualification remains outstanding.

A further integration gap is explicit: after restart, durable facts retain a handoff gate until an explicit client acknowledgement. The existing load-workspace route does not deliver a new acknowledgement obligation to the renderer. Automatic restart handoff delivery must be integrated before this branch is suitable for acceptance; otherwise a recovered client can remain blocked from subsequent file operations. The direct coordinator test explicitly acknowledges and therefore does not establish this UI behavior.
