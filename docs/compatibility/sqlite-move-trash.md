# SQLite move/Trash handoff (#123, partial implementation)

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
