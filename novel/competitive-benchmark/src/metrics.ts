/**
 * `@minsky/competitive-benchmark` — the pure, cited metric set for
 * agentic-software-engineering performance (task `self-metrics-competitive-benchmark`
 * slice (a)).
 *
 * This module is **data + pure functions only**: the metric catalogue plus
 * the direction-aware comparison/delta helpers that the automated comparison
 * (`scripts/benchmark-run.mjs`, slice (c)) will consume. No I/O, no vendor
 * names in logic — the competitor corpus (slice (b)) is a separate adapter
 * seam so a competitor is *data, not code*.
 *
 * Pattern conformance (per vision.md § 8 / Pattern conformance index):
 *   - Metric catalogue:   Goal-Question-Metric — Basili, Caldiera, Rombach,
 *                          "The Goal-Question-Metric Approach",
 *                          *Encyclopedia of Software Engineering*, 1994
 *                          (every metric is derived from the competitive
 *                          goal, not chosen post-hoc). Conformance: full.
 *   - DORA four keys:     Forsgren, Humble, Kim, *Accelerate*, 2018
 *                          (outcome metrics, not vanity counts).
 *                          Conformance: full.
 *   - SWE-bench hook:     Jimenez, Yang, Wettig, Yao, Pei, Press,
 *                          Narasimhan, "SWE-bench: Can Language Models
 *                          Resolve Real-World GitHub Issues?", *ICLR* 2024
 *                          (public head-to-head resolve-rate). Conformance:
 *                          full (the metric definition; the score *source*
 *                          is the slice-(b) corpus adapter).
 *   - Direction-aware
 *     comparison:         status/score lattice — a total order per metric
 *                          where "better" is the metric's own direction
 *                          (Avizienis et al., *IEEE TDSC* 2004 — worst/best
 *                          aggregation over an ordered domain).
 *                          Conformance: full.
 *
 * Why a pure leaf (Martin, *Clean Architecture*, 2017 — acyclic dependency
 * principle): the scorecard runner, the dashboard panel, and the
 * `check-competitive-goal.mjs` lint all consume this catalogue. Keeping it a
 * zero-dependency leaf with no I/O means every consumer shares one
 * definition of "what minsky measures itself and its competitors on".
 */

/**
 * Whether a higher or a lower raw value is the better outcome for a metric.
 * The comparison/delta helpers normalise on this so callers never special-case
 * a metric's polarity.
 */
export type MetricDirection = "higher-is-better" | "lower-is-better";

/**
 * The three families the scorecard ranks on. `dora` = DORA four keys
 * (Forsgren/Humble/Kim 2018); `agentic` = autonomous-coding-specific
 * outcomes; `public-benchmark` = a reproducible public head-to-head hook.
 */
export type MetricCategory = "dora" | "agentic" | "public-benchmark";

/**
 * Unit of the raw value. `ratio` is a 0..1 fraction; `usd` is US dollars;
 * `seconds` is wall-clock; `count-per-day` is a frequency.
 */
export type MetricUnit = "count-per-day" | "seconds" | "ratio" | "usd";

/**
 * One metric in the competitive scorecard. Pure data — the value *source*
 * (minsky's OTEL/ledger stream, a competitor's published number) is the
 * slice-(c)/slice-(b) concern, deliberately absent here.
 */
export interface MetricDefinition {
  /** Stable kebab-case key used in `competitive-scorecard.json` and the lint. */
  readonly id: string;
  /** Human-readable label for the dashboard panel. */
  readonly label: string;
  /** Which scorecard family this metric belongs to. */
  readonly category: MetricCategory;
  /** Unit of {@link MetricDefinition.id}'s raw value. */
  readonly unit: MetricUnit;
  /** Whether higher or lower raw values are better. */
  readonly direction: MetricDirection;
  /** Primary-source citation justifying the metric (rule #5/#9 anchor). */
  readonly anchor: string;
  /** What the metric measures and why it steers the competitive goal. */
  readonly description: string;
}

/**
 * The cited metric set. ≥5 shared metrics is the slice-(c) success bar;
 * this catalogue ships 11 across all three families so the scorecard never
 * has fewer than five comparable axes against any competitor whose corpus
 * (slice (b)) reports a subset.
 *
 * Ordering is informational (DORA → agentic → public-benchmark); consumers
 * key by `id`, never by index.
 */
export const METRICS: readonly MetricDefinition[] = [
  // --- DORA four keys (Forsgren/Humble/Kim 2018) ---------------------------
  {
    id: "deploy-frequency",
    label: "Deployment frequency",
    category: "dora",
    unit: "count-per-day",
    direction: "higher-is-better",
    anchor: "Forsgren, Humble, Kim, Accelerate, 2018 (DORA key 1)",
    description:
      "Merged-PR/deploy events per day — how often the system ships change autonomously.",
  },
  {
    id: "lead-time-for-changes",
    label: "Lead time for changes",
    category: "dora",
    unit: "seconds",
    direction: "lower-is-better",
    anchor: "Forsgren, Humble, Kim, Accelerate, 2018 (DORA key 2)",
    description: "Wall-clock from task-pick to merged change — speed of the build-measure loop.",
  },
  {
    id: "change-fail-rate",
    label: "Change failure rate",
    category: "dora",
    unit: "ratio",
    direction: "lower-is-better",
    anchor: "Forsgren, Humble, Kim, Accelerate, 2018 (DORA key 3)",
    description: "Fraction of merged changes that cause a regression or require a hotfix.",
  },
  {
    id: "mttr",
    label: "Mean time to restore",
    category: "dora",
    unit: "seconds",
    direction: "lower-is-better",
    anchor: "Forsgren, Humble, Kim, Accelerate, 2018 (DORA key 4)",
    description: "Wall-clock from regression detected to regression resolved.",
  },
  // --- Agentic-task outcomes ----------------------------------------------
  {
    id: "autonomous-merge-rate",
    label: "Autonomous merge rate",
    category: "agentic",
    unit: "ratio",
    direction: "higher-is-better",
    anchor: "Doerr, Measure What Matters, 2018 (outcome KR, not activity)",
    description: "Fraction of picked tasks that reach a merged PR with no human intervention.",
  },
  {
    id: "mean-autonomous-merge-latency",
    label: "Mean autonomous-merge latency",
    category: "agentic",
    unit: "seconds",
    direction: "lower-is-better",
    anchor: "Ries, The Lean Startup, 2011 (cycle-time of build-measure-learn)",
    description: "Mean wall-clock from task-pick to autonomous merge, over merged tasks only.",
  },
  {
    id: "cost-per-merged-pr",
    label: "Cost per merged PR",
    category: "agentic",
    unit: "usd",
    direction: "lower-is-better",
    anchor: "Doerr, Measure What Matters, 2018 (efficiency KR)",
    description: "Total model + infra spend divided by merged-PR count — economic efficiency.",
  },
  {
    id: "gate-pass-rate",
    label: "Gate pass rate",
    category: "agentic",
    unit: "ratio",
    direction: "higher-is-better",
    anchor: "Forsgren, Humble, Kim, Accelerate, 2018 (deployment-pipeline reliability)",
    description: "Fraction of first PR submissions that pass the full verify gate without a retry.",
  },
  {
    id: "regression-escape-rate",
    label: "Regression escape rate",
    category: "agentic",
    unit: "ratio",
    direction: "lower-is-better",
    anchor: "Basili, Caldiera, Rombach, GQM, 1994 (defect-escape metric)",
    description: "Fraction of merged PRs whose regression is caught only after merge.",
  },
  {
    id: "human-intervention-rate",
    label: "Human intervention rate",
    category: "agentic",
    unit: "ratio",
    direction: "lower-is-better",
    anchor: "Doerr, Measure What Matters, 2018 (autonomy KR)",
    description: "Fraction of tasks that required a human edit, unblock, or manual merge.",
  },
  // --- Public benchmark hook (Jimenez et al. 2024) ------------------------
  {
    id: "swe-bench-verified-resolve-rate",
    label: "SWE-bench Verified resolve rate",
    category: "public-benchmark",
    unit: "ratio",
    direction: "higher-is-better",
    anchor: "Jimenez et al., SWE-bench, ICLR 2024 (Verified split resolve-rate)",
    description:
      "Fraction of SWE-bench Verified instances resolved — the public head-to-head axis.",
  },
];

/**
 * Look up a metric definition by its stable `id`.
 *
 * @otel-exempt pure function — no I/O, no side effects; a wrapping span over
 *   an array find would be empty noise. The scorecard runner that calls this
 *   inside its already-traced `benchmark-run` span owns the observability.
 */
export function metricById(id: string): MetricDefinition | undefined {
  return METRICS.find((m) => m.id === id);
}

/**
 * Direction-aware comparison of two raw values for one metric. Returns `1`
 * when `a` is the better outcome, `-1` when `b` is, `0` when they tie —
 * always in "higher rank = better", regardless of the metric's polarity.
 *
 * @otel-exempt pure function — total order over two numbers; no I/O, no
 *   side effects. Traced by the caller's `benchmark-run` span.
 */
export function compareValues(metric: MetricDefinition, a: number, b: number): -1 | 0 | 1 {
  if (a === b) return 0;
  const aIsBetter = metric.direction === "higher-is-better" ? a > b : a < b;
  return aIsBetter ? 1 : -1;
}

/**
 * Direction-normalised delta between minsky's value and a competitor's for
 * one metric. A **positive** result always means minsky is ahead; a
 * **negative** result always means behind — the sign is meaningful without
 * the caller knowing the metric's polarity.
 *
 * @otel-exempt pure function — single subtraction with a sign flip; no I/O,
 *   no side effects. Traced by the caller's `benchmark-run` span.
 */
export function computeDelta(
  metric: MetricDefinition,
  minskyValue: number,
  competitorValue: number,
): number {
  const raw = minskyValue - competitorValue;
  return metric.direction === "higher-is-better" ? raw : -raw;
}
