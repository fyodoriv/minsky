// <!-- scope: human-approved sub-task `path-a-phase-10-delete-renderer-substrate`. Data-only barrel after Path-A phase-10 cut. The scorecard renderer + ledger reducer were deleted; only the competitors corpus + metrics catalogue remain. -->
//
// `@minsky/competitive-benchmark` — data-only public surface.
//
// Phase 10 of the Path-A aggressive cut deleted the scorecard builder
// (`scorecard.ts`), the ledger reducer (`ledger.ts`), and the public
// barrel's executable exports. What remains:
//
//   (a) the metric catalogue (`metrics.ts`) — citations + direction
//       semantics + comparison helpers.
//   (b) the competitor corpus (`competitors.ts`) — published-number
//       data + the vendor-exclusion allowlist.
//
// The static scorecard surface lives at `competitors/scorecard.md`
// (one-shot snapshot, manually re-rendered when corpus refreshes).
// The `competitor-research` skill writes to `competitors/<id>.md` and
// updates `competitors.ts` directly.
//
// See `README.md` for the corpus rationale.

export {
  COMPETITORS,
  type Competitor,
  type CompetitorKind,
  competitorById,
  EXCLUDED_VENDOR_SUBSTRINGS,
  isExcludedVendor,
  publishedValue,
  type ResultSource,
} from "./competitors.js";
export {
  compareValues,
  computeDelta,
  METRICS,
  type MetricCategory,
  type MetricDefinition,
  type MetricDirection,
  type MetricUnit,
  metricById,
} from "./metrics.js";
