/**
 * `@minsky/tick-loop/strategic-model-router` — slice 4 of
 * `claude-usage-aware-strategic-model-router`.
 *
 * Pure decision function that walks {@link MODEL_CATALOG} from
 * highest-quality (tier 1) to lowest (tier 4) and returns the first
 * entry whose per-window floors fit the current
 * {@link RemainingFractions}. Operator policy: *"best model by default,
 * downgrade only when forced."*
 *
 * Pattern conformance (rule #8):
 *   - **Pure decision delegate** — Hughes 1989. Referentially
 *     transparent over its inputs (catalog, remaining, hysteresis state).
 *     No I/O, no clock, no env. Conformance: full.
 *   - **Strategy seam** — Gamma 1994. The picker is the seam between
 *     the budget signal + the model catalog and the dispatch decision.
 *     `LlmProviderSpawnStrategy` (slice 5 wiring) consumes the result.
 *     Conformance: full.
 *
 * Failure modes & chaos verification (rule #7):
 *
 * | # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | Empty catalog | `catalog.length === 0` | rule-#7 graceful-degrade — return `{ kind: "fallback", model: "local", agent: "local", reason: "empty-catalog: no candidates" }`. The dispatch layer treats `local` as the always-available last resort. | paired test |
 * | 2 | All floors above current remaining | `remaining.fivehour < min(catalog.fivehourFloor)` | return the LOWEST-tier entry whose floors are all `0` (the `local` row in the default catalog). When no row qualifies (custom catalog without a zero-floor row), return `kind: "fallback"` with reason `no-tier-qualifies`. | paired tests |
 * | 3 | Hysteresis preserves stale pick | previous-pick was `claude-sonnet-4-6`, current remaining briefly crosses the opus floor by ≤5pp | return previous pick with `reason: "hysteresis: within ±5pp of opus floor, sticking with sonnet"`. Prevents thrash when remaining hovers near a threshold. | paired tests |
 * | 4 | NaN remaining fraction | malformed snapshot upstream | `remainingFractions(...)` already clamps NaN to 0 (slice 1 invariant); picker sees `0` and returns the lowest-tier — graceful-degrade. | upstream test pins this |
 * | 5 | Operator pin overrides catalog | `operatorPin: "claude-haiku-4-5"` even when remaining warrants opus | return operator pin with `kind: "operator-pin"`; bypass the catalog walk entirely (still validates the pin is in the catalog). | paired test |
 *
 * Steady-state hypothesis (rule #9):
 *   - on `remaining.fivehour ≥ 0.99` → tier-1 (opus)
 *   - on `remaining.fivehour ∈ [0.5, 0.99)` → tier-1 (opus)
 *   - on `remaining.fivehour ∈ [0.3, 0.5)` → tier-2 (sonnet)
 *   - on `remaining.fivehour ∈ [0.1, 0.3)` → tier-3 (haiku)
 *   - on `remaining.fivehour < 0.1` → tier-4 (local)
 *   - same gating for weekly and monthly; ALL three windows must pass
 *     for a row to be selected (the most restrictive window wins).
 *
 * @module tick-loop/strategic-model-router
 */

import type { RemainingFractions } from "@minsky/token-monitor";

import { MODEL_CATALOG, type ModelCatalogEntry } from "./model-catalog.js";

/**
 * Hysteresis state — what the picker returned last time. Used to
 * prevent thrash when `remaining` hovers near a threshold.
 *
 * The picker is pure (no internal state); the wiring layer (slice 5)
 * passes in the previous pick. Slice 6 persists the previous pick to
 * `.minsky/state.json` so the hysteresis survives daemon restart.
 */
export interface HysteresisState {
  /** The last selected entry's `id` (or `undefined` on cold-start). */
  readonly previousPickId: string | undefined;
}

/**
 * Input shape for {@link pickStrategicModel}.
 */
export interface PickStrategicModelInput {
  /** Continuous remaining-fractions per window (slice 1 helper output). */
  readonly remaining: RemainingFractions;
  /** Optional override; defaults to {@link MODEL_CATALOG}. */
  readonly catalog?: readonly ModelCatalogEntry[];
  /** Hysteresis state — pass `{ previousPickId: undefined }` on cold-start. */
  readonly hysteresis?: HysteresisState;
  /**
   * Width of the hysteresis band in fractional units. When the previous
   * pick is still selectable AND the candidate would be different but
   * within `band` of the candidate's floor, stick with the previous
   * pick. Default `0.05` (5pp).
   */
  readonly hysteresisBand?: number;
  /**
   * Operator-literal pin (env: `MINSKY_STRATEGIC_PIN_MODEL`, slice 8 wire-in).
   * When set AND the pin matches a catalog entry, bypass the walk and
   * return that entry. Hard override; the picker is advisory.
   */
  readonly operatorPin?: string;
}

/**
 * Output shape — what the dispatch layer (slice 5 wiring) consumes.
 */
export interface PickStrategicModelOutput {
  readonly model: string;
  readonly agent: "claude" | "local";
  readonly reason: string;
  readonly kind: "strategic-router" | "fallback" | "operator-pin" | "hysteresis";
}

/**
 * Default hysteresis band — 5 percentage points.
 */
const DEFAULT_HYSTERESIS_BAND = 0.05;

/**
 * Pick the highest-quality model whose per-window floors are all met by
 * the current `remaining` fractions. Pure function.
 *
 * Algorithm:
 *  1. If `operatorPin` is set AND maps to a catalog entry, return it
 *     (`kind: "operator-pin"`).
 *  2. Walk `catalog` ascending by `qualityTier`.
 *  3. For each entry, check `remaining.fivehour ≥ entry.fivehourFloor`
 *     AND `remaining.weekly ≥ entry.weeklyFloor` AND
 *     `remaining.monthly ≥ entry.monthlyFloor`. The most restrictive
 *     window blocks the row.
 *  4. Hysteresis: if the previous pick is still selectable AND the
 *     candidate would be better, but the candidate's gating-window
 *     remaining is within `hysteresisBand` of the candidate's floor,
 *     stick with the previous pick (`kind: "hysteresis"`).
 *  5. Return the first selectable entry (`kind: "strategic-router"`).
 *  6. Fallback: empty catalog OR no entry qualifies → return the
 *     lowest-tier all-zero-floor entry (or a synthetic `local` fallback
 *     when the catalog has none).
 *
 * @otel tick-loop.strategic-model-router.pick
 */
export function pickStrategicModel(input: PickStrategicModelInput): PickStrategicModelOutput {
  const catalog = input.catalog ?? MODEL_CATALOG;
  const band = input.hysteresisBand ?? DEFAULT_HYSTERESIS_BAND;
  const remaining = input.remaining;
  const previousPickId = input.hysteresis?.previousPickId;

  // Step 1 — operator pin
  const pinResult = tryOperatorPin(catalog, input.operatorPin);
  if (pinResult !== undefined) return pinResult;

  // Step 6 (early) — empty catalog
  if (catalog.length === 0) {
    return synthLocalFallback("empty-catalog: no candidates available; defaulting to local");
  }

  // Step 2-3 — walk catalog ascending
  const sorted = [...catalog].sort((a, b) => a.qualityTier - b.qualityTier);
  const candidate = sorted.find((e) => entryFits(e, remaining));

  if (candidate === undefined) {
    return fallbackLowestTier(sorted, remaining);
  }

  // Step 4 — hysteresis check
  const hyst = tryHysteresis(sorted, candidate, remaining, previousPickId, band);
  if (hyst !== undefined) return hyst;

  // Step 5 — return the candidate
  return {
    model: candidate.id,
    agent: candidate.agent,
    kind: "strategic-router",
    reason: `strategic-router: tier-${candidate.qualityTier} ${candidate.id} qualifies (remaining: 5h=${remaining.fivehour.toFixed(2)} ≥ ${candidate.fivehourFloor}, weekly=${remaining.weekly.toFixed(2)} ≥ ${candidate.weeklyFloor}, monthly=${remaining.monthly.toFixed(2)} ≥ ${candidate.monthlyFloor})`,
  };
}

/**
 * Pure: does the entry's per-window floors fit the current remaining?
 *
 * (Internal helper — no JSDoc tag required.)
 */
function entryFits(entry: ModelCatalogEntry, remaining: RemainingFractions): boolean {
  return (
    remaining.fivehour >= entry.fivehourFloor &&
    remaining.weekly >= entry.weeklyFloor &&
    remaining.monthly >= entry.monthlyFloor
  );
}

/**
 * Try the operator-pin path. Returns the operator-pin output when the
 * pin matches a catalog entry; `undefined` otherwise.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function tryOperatorPin(
  catalog: readonly ModelCatalogEntry[],
  pin: string | undefined,
): PickStrategicModelOutput | undefined {
  if (pin === undefined || pin.length === 0) return undefined;
  const pinned = catalog.find((e) => e.id === pin);
  if (pinned === undefined) return undefined;
  return {
    model: pinned.id,
    agent: pinned.agent,
    kind: "operator-pin",
    reason: `operator-pin: MINSKY_STRATEGIC_PIN_MODEL=${pinned.id} bypasses catalog walk`,
  };
}

/**
 * Build the synthetic-local fallback output. Used when the catalog is
 * empty or no entry exists at all.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function synthLocalFallback(reason: string): PickStrategicModelOutput {
  return { model: "local", agent: "local", kind: "fallback", reason };
}

/**
 * No catalog entry meets all-window floors — pick the lowest-tier
 * (highest qualityTier number) entry as the always-available last
 * resort.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function fallbackLowestTier(
  sorted: readonly ModelCatalogEntry[],
  remaining: RemainingFractions,
): PickStrategicModelOutput {
  const lowest = sorted[sorted.length - 1];
  if (lowest === undefined) {
    return synthLocalFallback(
      "no-tier-qualifies: catalog walk found no row meeting all-window floors",
    );
  }
  return {
    model: lowest.id,
    agent: lowest.agent,
    kind: "fallback",
    reason: `no-tier-qualifies: lowest-tier=${lowest.id} returned (remaining.fivehour=${remaining.fivehour.toFixed(2)}, remaining.weekly=${remaining.weekly.toFixed(2)}, remaining.monthly=${remaining.monthly.toFixed(2)})`,
  };
}

/**
 * Try the hysteresis path. Returns the previous pick when:
 *   - previous pick is in the catalog AND still selectable AND
 *   - candidate would be different AND
 *   - candidate's most-restrictive remaining-window is within `band`
 *     of its floor (the "barely qualifies" zone).
 *
 * Returns `undefined` when hysteresis doesn't apply.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function tryHysteresis(
  sorted: readonly ModelCatalogEntry[],
  candidate: ModelCatalogEntry,
  remaining: RemainingFractions,
  previousPickId: string | undefined,
  band: number,
): PickStrategicModelOutput | undefined {
  if (previousPickId === undefined || previousPickId === candidate.id) return undefined;
  const previous = sorted.find((e) => e.id === previousPickId);
  if (previous === undefined || !entryFits(previous, remaining)) return undefined;
  const gatingDelta = computeGatingDelta(candidate, remaining);
  if (gatingDelta >= band) return undefined;
  return {
    model: previous.id,
    agent: previous.agent,
    kind: "hysteresis",
    reason: `hysteresis: candidate=${candidate.id} would qualify but gating-window delta ${gatingDelta.toFixed(3)} < band ${band} — sticking with previous=${previous.id}`,
  };
}

/**
 * Distance to the nearest gating-window floor (the most restrictive
 * delta). When all floors are 0 (e.g., the local row), returns the
 * smallest remaining fraction so hysteresis still has something to
 * compare against.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function computeGatingDelta(candidate: ModelCatalogEntry, remaining: RemainingFractions): number {
  const allZeroFloors =
    candidate.fivehourFloor === 0 && candidate.weeklyFloor === 0 && candidate.monthlyFloor === 0;
  if (allZeroFloors) {
    return Math.min(remaining.fivehour, remaining.weekly, remaining.monthly);
  }
  return Math.min(
    remaining.fivehour - candidate.fivehourFloor,
    remaining.weekly - candidate.weeklyFloor,
    remaining.monthly - candidate.monthlyFloor,
  );
}
