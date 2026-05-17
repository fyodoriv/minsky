## What

Slice (a) of P0 `self-metrics-competitive-benchmark`: a new zero-dependency
`@minsky/competitive-benchmark` leaf package that ships **only the pure,
cited metric set** for agentic-software-engineering performance plus the
direction-aware comparison helpers (`compareValues` / `computeDelta` /
`metricById`).

- `novel/competitive-benchmark/src/metrics.ts` — 11 metrics across 3 cited
  families: DORA four keys (Forsgren/Humble/Kim 2018), 6 agentic outcomes
  (autonomous-merge rate/latency, cost-per-merged-PR, gate-pass rate,
  regression/escape rate, human-intervention rate), and the SWE-bench
  Verified public-benchmark hook (Jimenez et al. 2024).
- No vendor names in logic — the competitor corpus is a deliberate
  slice-(b) adapter seam so *a competitor is data, not code*.
- Wired in: `tsconfig.json` project ref, `vitest.config.ts` alias,
  `vision.md` pattern-conformance row #83, and the
  `scripts/check-threat-model-section.mjs` ratchet (README added +
  paired-test counts bumped in the same PR — visible, not silent).

## Why needed

Today minsky has **no measured notion** of how it compares to competitor
agentic-SWE systems, so direction is vibes-driven. The parent task makes
"beat competitors" the gravitational center every task is justified against;
that requires a single, stable, cited definition of *what* we measure before
the scorecard runner (c), the dashboard panel (c), and the
`check-competitive-goal.mjs` meta-rule lint (d) can consume it. Three
divergent inline copies of "the metrics" is the failure this leaf prevents.
Shipping the pure substrate first is the smallest gate-green increment that
unblocks slices b–e.

## Slice scope

This is slice 1 of 5. It ships **only** the cited metric substrate. The
competitor corpus (b), the scheduled `$0` scorecard job + dashboard panel
(c), the `**Competitive-goal**` TASKS.md meta-rule lint (d), and the
new-repo bootstrap-baseline priority (e) are filed under the same parent
task and ship as separate gate-green PRs that consume this leaf.

## Test plan

- `pnpm vitest run novel/competitive-benchmark/src/metrics.test.ts` → green
  (catalogue invariants: unique kebab-case ids, ≥5 metrics across all 3
  families, direction-aware compare/delta on both polarities, `undefined`
  for unknown id).
- `pnpm typecheck` → exit 0 (closed `MetricDirection`/`MetricCategory`
  unions, `readonly` catalogue).
- `metrics.test.ts` asserts `METRICS.length === 11` (DORA 4, agentic 6,
  public-benchmark 1) and category coverage across all 3 families.

## Optimization (per-iteration discipline gate)

`optimization: none-this-iteration: slice (a) introduces a brand-new
zero-dependency pure-data leaf — there is no pre-existing substrate
(brief/cached-prompt/gate/log-line/round-trip) on this path to shrink. The
first optimizable surface is the slice-(c) scorecard runner; the leaf is
already minimal (zero internal + zero external deps).`

## Security & privacy

§ 13 reviewed. No new security surface: the package is pure data + pure
functions with **no I/O, no auth, no secrets, no sandbox, no PII**, and
**zero added dependencies** (the `pnpm-lock.yaml` delta is only the empty
workspace-package entry — no new supply-chain surface). The only mutable
boundary is the closed type unions, enforced at compile time by `tsc`.

## Hypothesis self-grade

- **Predicted**: a single zero-dependency cited metric catalogue, consumed by the scorecard runner + dashboard + meta-rule lint, eliminates the risk of three divergent definitions of "what we measure" and makes the competitive scorecard (slices c–e) buildable on a stable substrate; the leaf ships ≥5 metrics across all 3 families and `METRICS.length === 11`.
- **Observed**: `pnpm vitest run novel/competitive-benchmark/src/metrics.test.ts` green (15 tests); `pnpm typecheck` exit 0; `METRICS.length === 11` (4 DORA + 6 agentic + 1 public-benchmark) asserted by the test; pre-pr-lint stack green.
- **Match**: yes
- **Lesson**: the pure-leaf shape held — no metric required live I/O to be *defined*, so the slice-c runner can consume this catalogue verbatim rather than carrying an inline copy.
