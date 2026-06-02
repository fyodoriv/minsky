# Path C deletion priorities — by consumer count

This file exists to give Phase 4 of the Path C reshape (deletion sweep 1) a
**cost-ordered** worklist instead of the ad-hoc ordering in the
package-by-package fate table. PR #784 validated that an isolated package — one
with zero external consumers — is the cheapest thing to delete (persona-spawner
took 30 min, not the predicted 1 week, precisely because its consumer count was
zero). This doc applies that lesson mechanically: it ranks every Path-C
deletion/fold candidate by how many other packages import it, so the sweep
starts with the mechanical zero-consumer wins and tackles the coupled packages
later.

It is the committed output of `scripts/path-c-consumer-count.mjs` — regenerate
it (and the table below) by running:

```bash
node scripts/path-c-consumer-count.mjs            # human-readable, cheapest-first
node scripts/path-c-consumer-count.mjs --json     # machine-readable, same data
```

## Candidate set

The candidates are the **Delete** and **Fold** rows of the fate table in
[`2026-05-22-path-c-openhands-reshape.md`](./2026-05-22-path-c-openhands-reshape.md)
§ "Package-by-package fate". **Keep** rows are not deletion targets; **Re-scope**
rows survive (their interfaces change, they are not removed). `persona-spawner`
is excluded — already deleted in PR #784, the validated learning that seeded
this audit.

## Consumer count (audited 2026-06-02)

A "consumer" is any `import`/`export … from "@minsky/<pkg>"` statement in another
package — self-header comments and the `vitest.config.ts` alias map do not count.
Counts de-duplicate per consuming file (the file is the unit of migration cost).

| Rank | Consumers | `src` LOC | Fate | Package |
|---:|---:|---:|---|---|
| 1 | 0 | 1063 | delete | `@minsky/token-monitor` |
| 2 | 0 | 1205 | fold | `@minsky/competitive-benchmark` |
| 3 | 0 | 1694 | delete | `@minsky/dashboard-web` |

**Zero-consumer candidates: 3** (pre-registered Success threshold ≥ 3 — met).

## Queued for the next deletion sweep

All three Path-C candidates that still exist have zero external consumers, so
all three are mechanical 30-min deletions in the persona-spawner mould. Queue
them cheapest-first by `src` LOC (the tie-breaker the audit already computes):

1. **`@minsky/token-monitor`** (delete) — 1063 LOC, 0 consumers. The fate table
   already routes this to the existing Claude-Code-Usage-Monitor tool (rule #1).
   Smallest, so it leads.
2. **`@minsky/competitive-benchmark`** (fold) — 1205 LOC, 0 consumers. Folds into
   `@minsky/experiment-record` per the fate table; with zero importers the fold
   is a move-and-delete, not a migration.
3. **`@minsky/dashboard-web`** (delete) — 1694 LOC, 0 consumers. Replaced by the
   `minsky watch` CLI + OpenHands' WebSocket per the fate table.

## Pivot (rule #9)

If a future re-run shows fewer than 3 zero-consumer candidates (because earlier
sweeps removed the isolated ones and only coupled packages remain), fall back to
**cheapest-first by LOC**: the audit emits `src_loc` on every row precisely so
the fallback ordering is already computed — take the smallest-LOC candidate as
the next deletion target without re-deriving anything.

## Anchors

- Validated learning `openhands-integration-shipped-2026-05-24` (substrate-first).
- PR #784 — persona-spawner deletion: predicted 1 week, actual 30 min, because
  `consumer_count == 0`.
- Beer, S., *Brain of the Firm*, 2nd ed., Wiley 1981 — Viable System Model,
  System 4: choose interventions by cost-of-change, not ideal architecture.
- Munafò et al., "A manifesto for reproducible science", *Nature Human
  Behaviour* 1, 0021, 2017 — the ≥3-zero-consumer threshold is pre-registered in
  the `path-c-deletion-prioritisation-by-consumer-count` task block.
