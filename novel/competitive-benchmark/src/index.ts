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
