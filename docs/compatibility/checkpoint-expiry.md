# Inactivity checkpoint expiry (#137)

Started from isolated integration `982d3c8`, preserving `0a9c981`, on
`implement/137-checkpoint-expiry`. Only the default inactivity cleanup is owned
here; #138 owns configuration/Never and #139 owns wider reclamation/capacity.

The host schedules cleanup every minute through its existing SQLite worker.
Each transaction expires at most 100 available snapshots, retaining boundary and
provider metadata with an explicit expiry reason. Opening expires eligible old
coverage before extending remaining coverage. Polling never touches activity.
User Send and captured checkpoints persist activity; observed turn/item events
also extend it. Live sessions/context transitions and pending completions protect
required state. Failed activity writes disable cleanup for that host lifetime.

Recovery evidence is deliberately conservative: any client's saved file drafts,
nonempty file-operation evidence, uncertain rewind, preparation results or
nonterminal/uncertain Send receipt protects data. Checkout approvals alone do not
protect historical files. Retained branch receipts already contain independent
checkpoint copies; cleanup never rewrites them. No provider deletion, worktree
removal, Git mutation, VACUUM or immediate disk-release promise is introduced.

Verification results and remaining qualification limits follow below.
