// <!-- scope: human-approved 2026-05-22 M1.10 — slice (c) of `self-metrics-competitive-benchmark`. Pure `buildScorecard()` joining the slice-(a) metric catalogue × the slice-(b) competitor corpus × the slice-(c) Minsky readings into the load-bearing `competitive-scorecard.json` artefact. -->
//
// Pattern: pure-function-with-I/O-at-edge (Martin 2017, *Clean
//   Architecture*) — `buildScorecard` is referentially transparent
//   over its inputs; the CLI shim that reads/writes JSON owns the
//   boundary. Adapter (the slice-(b) `Competitor.resultSource`
//   discriminated union) + Strategy (each `ResultSource.kind` branch
//   produces a metric value differently).
// Source: docs/plans/self-metrics-competitive-benchmark.md slice (c);
//   MILESTONES.md M1.10 ("≥4 competitors × ≥5 metrics").
// Anchor: rule #4 (vision.md § 4 — visible: the scorecard JSON is a
//   load-bearing artefact); rule #9 (vision.md § 9 — pre-registered
//   HDD: the M1.10 acceptance object is computed from the corpus
//   alone, not the Minsky side, so the shape check stays honest);
//   Helland 2007 *CIDR* (visible-not-silent: missing values render as
//   "no data" cells, never as zeros).
// Conformance: full — pure deterministic join; paired tests cover the
//   M1.10 shape ratio, the live-delta count, and the gap-rationale
//   field.

import {
  type Competitor,
  COMPETITORS,
  publishedValue,
} from "./competitors.js";
import {
  type MetricDefinition,
  METRICS,
  computeDelta,
} from "./metrics.js";

/**
 * One cell in the scorecard grid: one Minsky vs one competitor on one
 * metric. The grid is metric-by-competitor with a "Minsky" column
 * pre-joined so the dashboard can render it row-by-row.
 */
export interface ScorecardCell {
  /** `MetricDefinition.id` */
  readonly metricId: string;
  /** `Competitor.id` */
  readonly competitorId: string;
  /** Minsky's raw value for this metric. NaN when not yet measured. */
  readonly minskyValue: number;
  /** Competitor's raw value for this metric. undefined when not reported. */
  readonly competitorValue: number | undefined;
  /**
   * Direction-normalised delta (positive = Minsky ahead). undefined
   * when either side lacks data (renders as "no data" in the CLI).
   */
  readonly delta: number | undefined;
}

/**
 * The two-part M1.10 acceptance:
 *
 *   shape (corpus side)  — `meetsM110 === true` when the corpus
 *     carries ≥4 competitors with ≥5 shared metrics' published values
 *     OR the metric catalogue has ≥5 entries Minsky can measure.
 *   live (Minsky side)   — `liveDeltaCount > 0` when Minsky has
 *     produced at least one non-NaN measurement that has a competitor
 *     counterpart in the corpus.
 *
 * Exit-0 only when both hold. Today's known state: the corpus
 * predominantly carries `swe-bench-verified-resolve-rate`; that's a
 * shape gap the slice-(c) PR makes visible (gap rationale field).
 */
export interface AcceptanceState {
  /**
   * Corpus side: `true` when the corpus declares ≥4 competitors × ≥5
   * metrics that share a metric id with the catalogue, regardless of
   * whether Minsky has measured them.
   */
  readonly meetsM110: boolean;
  /**
   * Minsky side: count of cells where BOTH Minsky and the competitor
   * have a real value, i.e. a delta is computable. Zero on cold start.
   */
  readonly liveDeltaCount: number;
  /** Distinct competitors with at least one shared-metric value. */
  readonly competitorsWithData: number;
  /** Distinct metrics with at least one cross-competitor value. */
  readonly metricsWithComparison: number;
  /**
   * Human-readable rationale when `meetsM110 === false`. Empty when
   * the shape gate is met.
   */
  readonly gap: string;
}

/**
 * The full scorecard artefact written to `.minsky/competitive-scorecard.json`.
 */
export interface Scorecard {
  /** ISO-8601 timestamp from the builder's input `now`. */
  readonly generatedAt: string;
  /** Total number of cells in the grid (metrics × competitors). */
  readonly cellCount: number;
  /** Number of cells where a delta was computable. */
  readonly comparisonCount: number;
  /** The grid, metric-major. */
  readonly cells: readonly ScorecardCell[];
  /** Metric catalogue ids (for downstream renderers). */
  readonly metrics: readonly { readonly id: string; readonly label: string }[];
  /** Competitor corpus ids (for downstream renderers). */
  readonly competitors: readonly {
    readonly id: string;
    readonly label: string;
    readonly kind: string;
  }[];
  /** Two-part M1.10 acceptance. */
  readonly acceptance: AcceptanceState;
}

/**
 * Inputs to the pure builder. The CLI shim owns the I/O that produces
 * `minskyValues` (reads `.minsky/orchestrate.jsonl` → reducer) and
 * `now` (current ISO string).
 */
export interface BuildScorecardInput {
  /** Map keyed by `MetricDefinition.id`. Missing keys → NaN. */
  readonly minskyValues: Readonly<Record<string, number>>;
  /** ISO-8601 timestamp. Test fixtures inject a stable string. */
  readonly now: string;
}

/**
 * The M1.10 shape gate as defined in docs/plans/
 * self-metrics-competitive-benchmark.md:
 *
 *   meets when (competitorsWithData ≥ 4) AND (metricsWithComparison ≥ 5)
 *
 * "with data" means the corpus carries a published value (or live
 * harness descriptor) for that metric. Today this is met by the
 * SWE-bench corpus only when there are ≥5 metric definitions and ≥4
 * competitors — but the cross-product matters: a single metric across
 * 5 competitors is NOT met (one metric != five metrics).
 */
const SHAPE_GATE_MIN_COMPETITORS = 4;
const SHAPE_GATE_MIN_METRICS = 5;

function competitorReportsMetric(
  competitor: Competitor,
  metric: MetricDefinition,
): boolean {
  const src = competitor.resultSource;
  if (src.kind === "published") {
    return Object.hasOwn(src.values, metric.id);
  }
  // local-harness: by contract the slice-(c) runner can produce a
  // value when invoked; from the scorecard's perspective the corpus
  // "carries" the metric only when the harness is wired up (M1.10 will
  // gate on it when the wiring lands — for now treat as no data).
  return false;
}

/**
 * Pure builder. Joins the metric catalogue × competitor corpus ×
 * Minsky readings into the load-bearing scorecard artefact.
 *
 * - Cells: every (metric, competitor) pair gets one row, even if both
 *   sides are missing — the grid is fixed-shape for stable diffs.
 * - Deltas: computed only when BOTH sides have a real value.
 * - Acceptance: corpus shape (does the data EXIST for the comparison?)
 *   AND Minsky live-delta count (have we MEASURED anything yet?).
 *
 * @example
 *   const sc = buildScorecard({
 *     minskyValues: { "autonomous-merge-rate": 0.85 },
 *     now: "2026-05-22T07:00:00Z",
 *   });
 *   sc.acceptance.meetsM110 // false — corpus only has SWE-bench today
 *   sc.acceptance.gap       // explains the shape gap
 */
export function buildScorecard(input: BuildScorecardInput): Scorecard {
  const cells: ScorecardCell[] = [];
  let comparisonCount = 0;
  const competitorsWithDataSet = new Set<string>();
  const metricsWithComparisonSet = new Set<string>();
  let liveDeltaCount = 0;

  for (const metric of METRICS) {
    for (const competitor of COMPETITORS) {
      const minskyValue = input.minskyValues[metric.id] ?? Number.NaN;
      const competitorValue = publishedValue(competitor, metric.id);
      const corpusHas = competitorReportsMetric(competitor, metric);

      let delta: number | undefined;
      if (
        typeof competitorValue === "number" &&
        Number.isFinite(competitorValue) &&
        Number.isFinite(minskyValue)
      ) {
        delta = computeDelta(metric, minskyValue, competitorValue);
        comparisonCount += 1;
        liveDeltaCount += 1;
      }

      if (corpusHas) {
        competitorsWithDataSet.add(competitor.id);
        metricsWithComparisonSet.add(metric.id);
      }

      cells.push({
        metricId: metric.id,
        competitorId: competitor.id,
        minskyValue,
        competitorValue,
        delta,
      });
    }
  }

  const competitorsWithData = competitorsWithDataSet.size;
  const metricsWithComparison = metricsWithComparisonSet.size;
  const meetsM110 =
    competitorsWithData >= SHAPE_GATE_MIN_COMPETITORS &&
    metricsWithComparison >= SHAPE_GATE_MIN_METRICS;
  const gap = meetsM110
    ? ""
    : `M1.10 shape gap — corpus has ${competitorsWithData} competitor(s) × ${metricsWithComparison} metric(s) with published values; need ≥${SHAPE_GATE_MIN_COMPETITORS} × ≥${SHAPE_GATE_MIN_METRICS}.`;

  return {
    generatedAt: input.now,
    cellCount: cells.length,
    comparisonCount,
    cells,
    metrics: METRICS.map((m) => ({ id: m.id, label: m.label })),
    competitors: COMPETITORS.map((c) => ({
      id: c.id,
      label: c.label,
      kind: c.kind,
    })),
    acceptance: {
      meetsM110,
      liveDeltaCount,
      competitorsWithData,
      metricsWithComparison,
      gap,
    },
  };
}
