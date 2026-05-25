// <!-- scope: human-approved phase-11b-delete-tick-loop-multistep step 2 — ports the strategic model router out of `novel/tick-loop/src/strategic-model-router.ts` (deletion target) to `scripts/lib/`. Same algorithm, same 4-output kinds, same hysteresis semantics. -->
// Strategic model router — pure decision function that walks the
// MODEL_CATALOG from highest-quality (tier 1) to lowest (tier 4) and
// returns the first entry whose per-window floors fit the current
// RemainingFractions. Operator policy: "best model by default, downgrade
// only when forced."
//
// History: originally `novel/tick-loop/src/strategic-model-router.ts`.
// Ported to .mjs / JSDoc in phase-11b step 2 alongside
// `runany-provider-decision.mjs` (which composes this) so the bash
// runner's runany-model-audit lint stops depending on @minsky/tick-loop.
// No production runtime path consumes this either — the bash skeleton
// hard-codes openhands. This module is lint-only / audit-only.
//
// Source: parent task `claude-usage-aware-strategic-model-router` slice
// 4; recency-anchored 2026-05-10.
//
// Pattern conformance (rule #8):
//   - Pure decision delegate — Hughes 1989. Referentially transparent
//     over its inputs. No I/O, no clock, no env.
//   - Strategy seam — Gamma 1994. The picker is the seam between the
//     budget signal + the model catalog and the dispatch decision.

import { MODEL_CATALOG } from "./model-catalog.mjs";

/**
 * @typedef {import("./model-catalog.mjs").ModelCatalogEntry} ModelCatalogEntry
 * @typedef {import("@minsky/token-monitor").RemainingFractions} RemainingFractions
 */

/**
 * Hysteresis state — what the picker returned last time. Used to
 * prevent thrash when `remaining` hovers near a threshold.
 *
 * @typedef {Object} HysteresisState
 * @property {string | undefined} previousPickId The last selected entry's `id` (or `undefined` on cold-start).
 */

/**
 * Input shape for {@link pickStrategicModel}.
 *
 * @typedef {Object} PickStrategicModelInput
 * @property {RemainingFractions} remaining Continuous remaining-fractions per window.
 * @property {readonly ModelCatalogEntry[]} [catalog] Optional override; defaults to MODEL_CATALOG.
 * @property {HysteresisState} [hysteresis] Hysteresis state.
 * @property {number} [hysteresisBand] Width of hysteresis band in fractional units. Default `0.05`.
 * @property {string} [operatorPin] Operator-literal pin (env: `MINSKY_STRATEGIC_PIN_MODEL`).
 */

/**
 * Output shape — what the dispatch layer consumes.
 *
 * @typedef {Object} PickStrategicModelOutput
 * @property {string} model
 * @property {"claude" | "local"} agent
 * @property {string} reason
 * @property {"strategic-router" | "fallback" | "operator-pin" | "hysteresis"} kind
 */

/** Default hysteresis band — 5 percentage points. */
const DEFAULT_HYSTERESIS_BAND = 0.05;

/**
 * Pick the highest-quality model whose per-window floors are all met by
 * the current `remaining` fractions. Pure function.
 *
 * @otel tick-loop.strategic-model-router.pick
 *
 * @param {PickStrategicModelInput} input
 * @returns {PickStrategicModelOutput}
 */
export function pickStrategicModel(input) {
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
 * @param {ModelCatalogEntry} entry
 * @param {RemainingFractions} remaining
 * @returns {boolean}
 */
function entryFits(entry, remaining) {
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
 * @param {readonly ModelCatalogEntry[]} catalog
 * @param {string | undefined} pin
 * @returns {PickStrategicModelOutput | undefined}
 */
function tryOperatorPin(catalog, pin) {
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
 * Build the synthetic-local fallback output.
 *
 * @param {string} reason
 * @returns {PickStrategicModelOutput}
 */
function synthLocalFallback(reason) {
  return { model: "local", agent: "local", kind: "fallback", reason };
}

/**
 * No catalog entry meets all-window floors — pick the lowest-tier as
 * the always-available last resort.
 *
 * @param {readonly ModelCatalogEntry[]} sorted
 * @param {RemainingFractions} remaining
 * @returns {PickStrategicModelOutput}
 */
function fallbackLowestTier(sorted, remaining) {
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
 * Try the hysteresis path.
 *
 * @param {readonly ModelCatalogEntry[]} sorted
 * @param {ModelCatalogEntry} candidate
 * @param {RemainingFractions} remaining
 * @param {string | undefined} previousPickId
 * @param {number} band
 * @returns {PickStrategicModelOutput | undefined}
 */
function tryHysteresis(sorted, candidate, remaining, previousPickId, band) {
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
 * Distance to the nearest gating-window floor (most restrictive delta).
 *
 * @param {ModelCatalogEntry} candidate
 * @param {RemainingFractions} remaining
 * @returns {number}
 */
function computeGatingDelta(candidate, remaining) {
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
