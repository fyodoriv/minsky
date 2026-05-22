/**
 * `@minsky/competitive-benchmark` — public surface.
 *
 * Slices (a) + (b) + (c) of task `self-metrics-competitive-benchmark`:
 *   (a) the pure, cited metric set with direction-aware comparison helpers,
 *   (b) the competitor corpus with its pluggable result-source adapter seam,
 *   (c) the ledger reducer + scorecard builder that join the two into the
 *       load-bearing `competitive-scorecard.json` artefact.
 *
 * Slice (d) (the task-justification meta-rule via `**Competitive-goal**:`
 * field + lint) and slice (e) (new-repo bootstrap priority) are separate,
 * later-shipped surfaces that consume this leaf.
 *
 * See `README.md` for the catalogue rationale and chaos verification.
 */

export {
  type MetricCategory,
  type MetricDefinition,
  type MetricDirection,
  type MetricUnit,
  METRICS,
  compareValues,
  computeDelta,
  metricById,
} from "./metrics.js";
export {
  type Competitor,
  type CompetitorKind,
  type ResultSource,
  COMPETITORS,
  EXCLUDED_VENDOR_SUBSTRINGS,
  competitorById,
  isExcludedVendor,
  publishedValue,
} from "./competitors.js";
export {
  type IterationRecord,
  type MinskyReadings,
  computeMinskyReadings,
  readingsToMetricValues,
} from "./ledger.js";
export {
  type AcceptanceState,
  type BuildScorecardInput,
  type Scorecard,
  type ScorecardCell,
  buildScorecard,
} from "./scorecard.js";
