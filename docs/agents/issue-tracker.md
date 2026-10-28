# Issue tracker

Use GitHub Issues in **ejjsharpe/escode** through the `gh` CLI. Verify `gh repo view --json nameWithOwner` before the first write in a session; explicitly pass `--repo ejjsharpe/escode` when working outside the checkout.

For multiline bodies and comments, write a UTF-8 file and use `--body-file` to preserve the exact text.

## Wayfinding operations

- The canonical map is one issue labelled `wayfinder:map`. Its body contains Destination, Notes, Decisions so far, Not yet specified, and Out of scope.
- Tickets are native sub-issues of the map, labelled with exactly one of `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. Their bodies state questions, not implementation assignments. Map and tickets carry only `wayfinder:` labels.
- Create tickets first; then add native blocking relationships and cross-references using their real issue identities. Use `gh issue edit --add-sub-issue` and `--add-blocked-by`.
- The frontier is the map's open, unassigned children with no open blocking issue, in sub-issue order. Read the map first and load individual ticket details as needed.
- Claim a ticket by assigning it to the signed-in developer before investigating it: `gh issue edit <ticket> --add-assignee @me`.
- Resolve a ticket by posting a resolution comment, closing it, and adding a linked one-line gist to the map's Decisions so far. Keep the detailed answer on the ticket and link any research or prototype asset from it.
- Research findings live in `docs/research/` on separate `research/<topic>` branches. Push these branches, link a commit-pinned report from the resolution, and open no PR; research branches are not merged.
- Work through at most one non-research ticket per session. Human-in-the-loop tickets require the user's participation; research tickets can run in parallel.
- Refer to maps and tickets by their linked titles, not bare issue numbers. Keep open tickets out of the map body; GitHub's sub-issues and dependency relationships provide that index.
- Move newly precise questions out of Not yet specified into tickets. If a ticket proves beyond the destination, close it and link it under Out of scope rather than Decisions so far.

## Domain documents

This repository has one domain context, recorded in `GLOSSARY.md`. Create ADRs under `docs/adr/` only when a consequential, hard-to-reverse trade-off needs an explanation that the code cannot provide.
