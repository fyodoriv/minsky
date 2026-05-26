<!-- pattern: see vision.md § "Pattern conformance index" row 82 (`METRICS.md` + generator + freshness lint) — this doc is the operator-facing explanation of the discipline that row enforces. -->

# Metrics discipline

> The contract every Minsky-managed repo signs by carrying a `METRICS.md` at its root. The 10 entries in `METRICS.md` are not a dashboard — they are an audit surface. The discipline is what keeps that surface trustworthy.

`METRICS.md` is the canonical observability surface every Minsky-managed repo (this one + every host the cross-repo runner governs) ships at its root. It exists because dashboards rot in private, and rotting numbers steer the loop in the wrong direction faster than missing numbers do (Ries 2011, Ch. 7 — wrong data is worse than no data). The discipline below makes "trustworthy" mechanically checkable rather than an opinion.

The substrate is one source of truth (`SUCCESS_METRICS` in `novel/dashboard-web/src/metrics.ts` — rule #2), one pure builder (`scripts/generate-metrics-md.mjs`), one daily snapshot (`.minsky/metric-snapshots/<date>.json`), one operator binding (`bin/minsky metrics render`), one CI gate (`scripts/check-metric-freshness.mjs`), and one daemon wire-in that fires the pipeline once per UTC day. The rest of this doc explains how those parts compose and what invariants the gate enforces.

## Why a static file, not a dashboard

A dashboard is a query against live OTEL. `METRICS.md` is a daily *projection* of that query — committed to the repo, visible in `git log`, diff-able across days. The projection is the audit surface: if the value drifts, `git blame METRICS.md` answers "since when, and what shipped that day". Card & Mackinlay 1999's glanceable-display threshold (≤10 metrics, fixed shape, no chrome) is what keeps the surface scannable in the seconds an operator has between iterations.

The dashboard at `novel/dashboard-web/` is the live cross-section. `METRICS.md` is the daily snapshot. They share `SUCCESS_METRICS` as their canonical input — neither one is the source.

## The pipeline

```text
SUCCESS_METRICS (rule #2 source of truth)        novel/dashboard-web/src/metrics.ts
        │
        ▼
   per-day snapshot                              .minsky/metric-snapshots/<date>.json   (#186)
        │
        ▼
   pure builder ──────► runMetricsRender         scripts/generate-metrics-md.mjs
        │                                        scripts/metrics-render.mjs
        ▼
   METRICS.md   (committed)                      ./METRICS.md
        │
        ▼
   freshness lint (CI gate)                      scripts/check-metric-freshness.mjs
                                                 .github/workflows/ci.yml — `metric-freshness` job
        │
        ▼
   daily refresh (supervisor)                    novel/tick-loop/src/metrics-render-cli-wiring.ts
                                                 fires `bin/minsky metrics render --date <today>` once per UTC date
```

Each stage has one job. The pure builder (`buildMetricsMd`) takes `metrics` + `observations` + `nowMs` and returns the markdown — no I/O, no clock, no env. The orchestrator (`runMetricsRender`) projects today's snapshot onto the metric ids and calls the builder. The CLI binding (`scripts/metrics-render.mjs`) is the only filesystem surface. The daemon wire-in fires the binding once per UTC date via a file-backed mtime probe on `METRICS.md`. The freshness lint reads the rendered markdown back and rejects what the pipeline shouldn't have produced.

## The four invariants

The freshness lint (`scripts/check-metric-freshness.mjs`) is the deterministic CI gate (rule #10 — same input, same output, no LLM in the chain). It rejects exactly four things:

1. **Unannotated value** — a `**Value:**` line that is not `(stub)` and has no `_Updated: <iso-utc>` timestamp. There is no such thing as a fresh-but-undated observation. The renderer always writes the timestamp; the lint catches manual edits that strip it.
2. **Stale observation** — `nowMs - updatedMs > freshnessBudgetMs`. Per-metric budgets are declared on `SuccessMetric.freshnessBudgetMs` in source (rule-#9 pre-registration: the budget is fixed *before* the observation, never tuned post-hoc when an entry happens to fail). Daily-cadence metrics use 1d (`mttr`, `wrist-dwell`, `dep-interface-coverage`, `token-budget-honoring`); weekly cadences use 7d (`loop-uptime`, `tokens-per-story`, `spec-alignment`, `self-improvement-velocity`, `task-throughput`); lifetime inventory uses 30d (`extraction-count`).
3. **Missing budget annotation** — a section without `_Budget: <N>(d|h)`. A render without a budget cannot be staleness-checked, so this is treated as a render bug, not a stub.
4. **Drift against `SUCCESS_METRICS`** — when CI invokes the lint with `--expected loop-uptime,tokens-per-story,…` (the canonical 10), the lint also fails on a missing expected id, an unexpected rendered id, or a duplicate id. The drift check is what makes `SUCCESS_METRICS` the single source of truth in practice, not just intent.

`(stub)` sections are accepted unconditionally — they are the explicit "no observation yet" signal (Helland 2007 — visible-not-silent). A silent zero would pretend to be data; an explicit `(stub) — … (wired in <follow-up>)` cannot. Reading `METRICS.md` and seeing nine real values plus one `(stub)` is *correct system state*, not a partial render.

## The no-vanity guard

A monotonic counter — anything that always goes up — is a vanity metric (Ries 2011): it incentivises activity rather than outcomes, and it cannot fail to "improve". The pipeline's policy is that monotonic-by-design metrics carry an explicit `monotonic: "ok"` opt-in on `SuccessMetric`; the renderer surfaces that opt-in as `_monotonic: ok_` in the rendered section header. The only metric currently flagged is `extraction-count` (lifetime inventory of forks — by design, never decreases). Adding a second monotonic metric requires editing `SUCCESS_METRICS` and acknowledging the opt-in in the same commit; the discipline is the friction.

The lint's structural half (the `_monotonic: ok_` annotation per section) is in place today. The cross-render half (rejecting "value increased N days in a row without the opt-in") will land alongside snapshot-history retention; the structural opt-in is the load-bearing contract that signals intent now and gates the cross-render check later.

## Operator commands

Three commands cover the everyday surface:

- `bin/minsky metrics render` — regenerate `METRICS.md` from today's snapshot. Idempotent: against a snapshot whose ids do not align with `SUCCESS_METRICS`, the output is byte-identical to the genesis (all stubs); against a snapshot with a `SUCCESS_METRICS`-keyed entry, the matching section flips to a real value with a fresh `_Updated:` line. `bin/minsky metrics render --date 2026-05-05` re-renders against an older snapshot for replay.
- `node scripts/check-metric-freshness.mjs --expected loop-uptime,tokens-per-story,…` — what CI runs in the `metric-freshness` job in `.github/workflows/ci.yml`. Fails with a per-section reason on the four invariants above.
- `cat METRICS.md` — the audit surface. Each section is one heading, one `_Updated: … · Budget: … · Source: …_` line (or `_Budget: …_` for stubs), one `**Value:** …` line, one ``Formula: `…` `` line. The 10 sections fit on one operator screen.

## Daily refresh

The supervisor (`bin/tick-loop.mjs`) wires `metricsRenderSeam` under the same `MINSKY_CHANGELOG_ENABLE` umbrella as the snapshot + changelog legs. Once per UTC date, after a successful daemon iteration, the seam spawns `bin/minsky metrics render --date <today>` and writes `METRICS.md`. The mtime of the resulting file is the gate: if its UTC date matches today, the render is skipped on subsequent iterations (cheap probe — no parsing). A snapshot-capture failure (e.g. `gh` rate-limit) does NOT suppress today's render — yesterday's snapshot still produces a usable `METRICS.md` rather than no `METRICS.md` (Helland 2007 again — degrade visibly, never silently).

## Pivots

The discipline has three pre-registered pivot signals (rule #9 — when do we abandon the *approach*, not just the change):

- **Glanceable-display pivot.** If mean operator-glance time on `METRICS.md` exceeds 10 s for the 10-metric list (Card & Mackinlay 1999 threshold), restructure to a table render — the static file stays, only the layout changes. Don't retire the file.
- **Freshness-lint scope pivot.** If the lint produces ≥3 false positives in its first month from legitimately-stale-but-known stubs, tighten its scope to "non-stub sections only" rather than retire the gate. Stubs are visible-not-silent by contract; the gate's job is real values, not annotations.
- **Mtime-probe pivot.** If file-mtime gating false-skips on filesystems with non-monotonic mtimes (some tmpfs configs) or false-fires on supervisor-induced touches, tighten `getLastRenderedDate` to read the embedded `_Updated:` timestamp from the rendered markdown rather than the file's mtime. Don't retire the per-day cadence.

## See also

- [`vision.md` § "Pattern conformance index" row 82](../vision.md#pattern-conformance-index) — the canonical pattern entry; this doc is its operator-facing explanation.
- [`vision.md` § "Success criteria"](../vision.md) — the 10 metrics this discipline projects, in their canonical order.
- [`novel/dashboard-web/src/metrics.ts`](../novel/dashboard-web/src/metrics.ts) — `SUCCESS_METRICS` (rule #2 source of truth).
- [`scripts/generate-metrics-md.mjs`](../scripts/generate-metrics-md.mjs) — pure builder.
- [`scripts/metrics-render.mjs`](../scripts/metrics-render.mjs) — operator binding (`bin/minsky metrics render`).
- [`scripts/check-metric-freshness.mjs`](../scripts/check-metric-freshness.mjs) — the CI gate.
- [`novel/tick-loop/src/metrics-render-cli-wiring.ts`](../novel/tick-loop/src/metrics-render-cli-wiring.ts) — the daemon's daily-refresh wire-in.
- [`docs/host-transformation-checklist.md`](host-transformation-checklist.md) — the broader checklist a host repo signs onto when it adopts Minsky principles; metrics discipline is one of its enforcers.
