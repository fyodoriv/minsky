/**
 * `@minsky/competitive-benchmark` — public surface.
 *
 * Slice (a) of task `self-metrics-competitive-benchmark`: the pure, cited
 * metric set + direction-aware comparison helpers. The competitor corpus
 * (slice (b)), the automated comparison runner (slice (c)), the task-
 * justification meta-rule (slice (d)), and the new-repo bootstrap priority
 * (slice (e)) are separate, later-shipped surfaces that consume this leaf.
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
