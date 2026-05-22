// <!-- scope: human-approved 2026-05-22 M1.10 — slice (c) of `self-metrics-competitive-benchmark`. The ledger reducer computes Minsky's own values for the metric ids in `./metrics.ts` from the host's `.minsky/orchestrate.jsonl` append-only ledger. -->
//
// Pure leaf — no I/O. Takes a parsed iteration-record array (as
// produced by `scripts/benchmark-run.mjs`'s line-by-line `JSON.parse`)
// and returns a `MinskyReadings` object keyed by `MetricDefinition.id`.
// The scorecard module joins these with the published competitor
// corpus to produce per-cell deltas via `computeDelta`.
//
// Pattern: pure-function-with-I/O-at-edge (Martin 2017, *Clean
//   Architecture* — the reducer is referentially transparent over the
//   record array; the CLI shim that reads `.minsky/orchestrate.jsonl`
//   owns the I/O boundary).
// Source: docs/plans/self-metrics-competitive-benchmark.md slice (c);
//   rule #4 (vision.md § 4 — visible: each computed metric is a real
//   number from the ledger, not a guess).
// Anchor: rule #9 (vision.md § 9 — pre-registered HDD; each metric's
//   formula matches its `MetricDefinition.description` in
//   `./metrics.ts`); Forsgren/Humble/Kim 2018 *Accelerate* (DORA — the
//   four-key formulas this implements).
// Conformance: full — pure deterministic reducer; paired tests cover
//   empty ledger, mixed verdicts, and the unit-correctness invariant.

/**
 * One iteration record as it lives in `.minsky/orchestrate.jsonl`. The
 * append-only log has historically grown fields; the reducer reads only
 * the subset needed for M1.10 metrics and tolerates the rest being absent.
 *
 * Fields used:
 *   - `verdict` — `pr-open` (success) | `no-change` (skipped) |
 *     `spawn-failed` / `scope-leak` / other (failures).
 *   - `pr` — the GitHub PR URL produced (success path).
 *   - `prState` — `merged` (autonomous merge) | `open` | `closed`.
 *   - `humanEdits` — boolean; the human edited the PR post-open.
 *   - `ciFirstPushGreen` — boolean; CI passed on the first push.
 *   - `durationSec` — wall-clock from iteration start to PR open.
 *   - `costUsd` — token-cost approximation in US dollars.
 */
export interface IterationRecord {
  readonly verdict?: string;
  readonly pr?: string;
  readonly prState?: "merged" | "open" | "closed";
  readonly humanEdits?: boolean;
  readonly ciFirstPushGreen?: boolean;
  readonly durationSec?: number;
  readonly costUsd?: number;
}

/**
 * Minsky's own value for each metric id, derived from the iteration
 * ledger. Keys match `MetricDefinition.id`s in `./metrics.ts`. A
 * `Number.NaN` value means "no data yet" (matches Helland 2007 —
 * visible-not-silent; the scorecard will show a "no data" cell rather
 * than mask it as zero).
 */
export interface MinskyReadings {
  readonly autonomousMergeRate: number;
  readonly meanAutonomousMergeLatencySeconds: number;
  readonly costPerMergedPrUsd: number;
  readonly gatePassRate: number;
  readonly humanInterventionRate: number;
  /**
   * Sample sizes for transparency. The scorecard renders these in the
   * `notes` column so the reviewer sees `n=2 iterations` rather than
   * trusting a single-iteration ratio.
   */
  readonly samples: {
    readonly totalIterations: number;
    readonly mergedPrs: number;
    readonly openedPrs: number;
  };
}

/**
 * Verdicts that count as "successful iteration" (not a failure-class
 * intervention). The reducer keeps this set narrow so a new verdict
 * type doesn't silently get classified as success.
 */
const NON_FAILURE_VERDICTS: ReadonlySet<string> = new Set([
  "pr-open",
  "no-change",
  "empty-queue",
  "dry-run-only",
]);

/** Mutable running totals threaded through the reducer's fold. */
interface RunningTotals {
  openedPrs: number;
  mergedPrs: number;
  mergedLatencySumSec: number;
  mergedCostSumUsd: number;
  ciFirstPushGreenCount: number;
  humanEditsCount: number;
  failureVerdictCount: number;
}

/** Fold one `pr-open` record into the running totals. */
function foldPrOpen(r: IterationRecord, t: RunningTotals): void {
  t.openedPrs += 1;
  if (r.prState === "merged") {
    t.mergedPrs += 1;
    if (typeof r.durationSec === "number") t.mergedLatencySumSec += r.durationSec;
    if (typeof r.costUsd === "number") t.mergedCostSumUsd += r.costUsd;
  }
  if (r.ciFirstPushGreen === true) t.ciFirstPushGreenCount += 1;
  if (r.humanEdits === true) t.humanEditsCount += 1;
}

/** Whether a verdict counts as a failure that requires human intervention. */
function isFailureVerdict(verdict: string | undefined): boolean {
  if (typeof verdict !== "string") return false;
  return !NON_FAILURE_VERDICTS.has(verdict);
}

/** NaN when the denominator is zero (visible-not-silent — Helland 2007). */
function safeDiv(num: number, den: number): number {
  return den === 0 ? Number.NaN : num / den;
}

/**
 * Compute Minsky's metric values from an array of iteration records.
 *
 * Pure function over an immutable array; returns NaN for any metric
 * whose denominator is zero (no iterations, no merged PRs, etc.).
 *
 * Formulas (anchor to `MetricDefinition.description` in `./metrics.ts`):
 *
 *   autonomous-merge-rate           = mergedPrs / openedPrs
 *   mean-autonomous-merge-latency   = sum(durationSec | merged) / mergedPrs
 *   cost-per-merged-pr              = sum(costUsd | merged) / mergedPrs
 *   gate-pass-rate                  = ciFirstPushGreen / openedPrs
 *   human-intervention-rate         = (humanEdits + non-pr-open verdicts) / iterations
 *
 * @otel-exempt pure reducer — single-pass fold over an immutable array;
 *   no I/O, no side effects. The CLI shim's `benchmark-run` span owns
 *   the observability for the read-then-reduce-then-write pipeline.
 */
export function computeMinskyReadings(records: readonly IterationRecord[]): MinskyReadings {
  const t: RunningTotals = {
    openedPrs: 0,
    mergedPrs: 0,
    mergedLatencySumSec: 0,
    mergedCostSumUsd: 0,
    ciFirstPushGreenCount: 0,
    humanEditsCount: 0,
    failureVerdictCount: 0,
  };

  for (const r of records) {
    if (r.verdict === "pr-open" && typeof r.pr === "string") {
      foldPrOpen(r, t);
    } else if (isFailureVerdict(r.verdict)) {
      t.failureVerdictCount += 1;
    }
  }

  const totalIterations = records.length;
  return {
    autonomousMergeRate: safeDiv(t.mergedPrs, t.openedPrs),
    meanAutonomousMergeLatencySeconds: safeDiv(t.mergedLatencySumSec, t.mergedPrs),
    costPerMergedPrUsd: safeDiv(t.mergedCostSumUsd, t.mergedPrs),
    gatePassRate: safeDiv(t.ciFirstPushGreenCount, t.openedPrs),
    humanInterventionRate: safeDiv(t.humanEditsCount + t.failureVerdictCount, totalIterations),
    samples: {
      totalIterations,
      mergedPrs: t.mergedPrs,
      openedPrs: t.openedPrs,
    },
  };
}

/**
 * Bridge from the reducer's typed shape to the loosely-keyed
 * `Record<string, number>` the scorecard module consumes. Keys here
 * match `MetricDefinition.id` exactly so the scorecard can index them.
 *
 * Values stay `Number.NaN` for missing metrics — the scorecard's join
 * step skips NaN values and renders them as `"no data"`.
 *
 * @otel-exempt pure object-shape conversion — no I/O, no side effects.
 *   Wrapping a span around an object literal would be pure noise.
 */
export function readingsToMetricValues(readings: MinskyReadings): Record<string, number> {
  return {
    "autonomous-merge-rate": readings.autonomousMergeRate,
    "mean-autonomous-merge-latency": readings.meanAutonomousMergeLatencySeconds,
    "cost-per-merged-pr": readings.costPerMergedPrUsd,
    "gate-pass-rate": readings.gatePassRate,
    "human-intervention-rate": readings.humanInterventionRate,
    // SWE-bench Verified is the only metric Minsky CAN'T self-report
    // from the iteration ledger — that's a benchmark-run number, not a
    // live-iteration number. Left out of this bridge (the scorecard
    // will skip it on Minsky's side; the corpus carries competitor
    // values for it independently).
  };
}
