<!-- scope: human-approved closes-research-replace-or-relocate-dashboard-web (P2; task block removed in the same commit per rule #17). -->

# `dashboard-web` package — Replace or Relocate?

**Decision (2026-05-28)**: **REPLACE** with `minsky watch` (the CLI
TUI dashboard). The package was officially deprecated 2026-05 per
the `runany-retro-tui-dashboard` task; this note codifies the
verdict and records the migration cost so the deprecation arc has
a re-evaluable artifact.

## What this file is

A re-evaluable replace-or-relocate research note per rule #1.
Closes the P2 follow-up that was filed BEFORE the package
deprecation was finalised. The replacement is no longer a
hypothetical — it's `minsky watch`, already documented in
`docs/DEPRECATED.md` § 4.

## Verdict: REPLACE-BY-`minsky watch`

The web dashboard's value proposition (glanceable success-metric
view) is fully covered by `minsky watch` with zero HTTP server, no
browser, no port management. The migration is documented as the
canonical replacement path in `docs/DEPRECATED.md`. New features
land in `minsky watch`; the web package stays for compatibility
until the last task referencing it is closed.

## Replacement candidates evaluated

### `minsky watch` (CLI TUI dashboard) — CHOSEN

- **Verdict**: ADOPTED.
- **Why**: Same 14 success-metric tiles + recent-activity feed, no
  HTTP server, no browser, no port management. Zero dependencies
  beyond Node. Operators see the same information without the
  multi-process setup.

### Grafana / Apache Superset / Metabase / Retool

- **Verdict**: REJECTED (already in README rule-1 comment).
- **Why**: Each ships a heavyweight runtime (JVM / Python+JS bundle
  / multi-MB SPA) that violated the ≤300-LOC pivot cap pinned in
  the original `dashboard-web-v0` task brief. Today these are also
  rejected for the new replacement (`minsky watch`) on the same
  grounds — the TUI's zero-dependency posture is the value.

### Datasette over a SQLite span store

- **Verdict**: REJECTED.
- **Why**: Datasette is excellent for ad-hoc SQL queries over
  read-only SQLite; it doesn't render fixed-shape metric tiles.
  Could be a COMPANION (operator's debugging surface for the span
  store) but not a dashboard replacement.

### Plain `gh` + shell aliases

- **Verdict**: REJECTED.
- **Why**: The glance value is the single-screen view — every
  metric in 2 seconds. `gh` + shell scatters the surface across
  N commands; composability is the wrong axis for an "is the
  organism alive?" glance.

## Migration cost (already shipped)

- `minsky watch` ships the same `SUCCESS_METRICS` tile shape (no
  refactor needed on the metric source).
- The recent-activity feed maps 1-1 to `getActivity` in the TUI.
- Operators run `minsky watch` instead of `pnpm minsky:ui` /
  `bin/minsky ui` — `docs/DEPRECATED.md` § 4 documents the
  replacement.

## Re-evaluation criteria

Re-check this decision when ANY of:

1. The last task referencing the web dashboard closes. Trigger:
   delete the web package outright; remove the deprecation note
   from `docs/DEPRECATED.md`.
2. The TUI dashboard hits a fundamental ceiling (e.g. needs a
   feature only an HTTP surface can deliver — embedding in
   Slack, embedding in a Notion page). Trigger: re-evaluate a
   web surface; today no such requirement exists.
3. agentbrew (or another sibling tool) needs a parallel
   dashboard surface. Trigger: extract the reusable `minsky
   watch` kernel; the web package stays deprecated.

## Anchor

- Card & Mackinlay, *Readings in Information Visualization*, 1999
  glanceable display + calm-tech surface pattern.
- Rule #1 (`vision.md`): don't reinvent the wheel — re-check
  quarterly per the `review-q*` cadence task.
- `docs/DEPRECATED.md` § 4: the canonical deprecation declaration
  and replacement (`minsky watch`).
- `runany-retro-tui-dashboard` task: the parent that drove the
  deprecation.
