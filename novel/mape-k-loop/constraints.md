# `constraints.md` — append-only knowledge log

Per Helland, "Life beyond Distributed Transactions", *CIDR* 2007: this file
is the immutable log substrate for the MAPE-K Knowledge phase
(Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer*
36(1) 2003). Every tick of the loop appends one section under a
`## <ISO-8601 date>` heading recording the top constraint, the Execute
decision, the winner (if any), and the human-readable reason.

This file is **append-only**. Entries are never edited or deleted in
place; if a previous entry was wrong, a follow-up entry on a later date
records the correction (Helland 2007 — derived data through reissue, not
mutation). The supervisor's `constraints-md-size-cap` check fires when
this file grows past 200 entries; that's the operator's signal to
archive older sections to a dated file (`constraints-2026Q2.md`) rather
than rewriting the live log.

## 2026-05-03

- **Top constraint**: `(seed entry — no live tick yet)`
- **Decision**: no-op
- **Winner**: `(none rolled out)`
- **Reason**: initial seed for `mape-k-knowledge-and-integration` sub-task 4 of 4 of `mape-k-loop-v0`. The CLI wrapper that drives this log lives in user-story 003's integration test (`user-stories/003-mape-k-improves-prompts.test.ts`).
## 2026-05-09

- **Top constraint**: `(none — no rule violations this tick)`
- **Decision**: no-op
- **Winner**: `(none rolled out)`
- **Reason**: analyze: no top constraint detected this tick
