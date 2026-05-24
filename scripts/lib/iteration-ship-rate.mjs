// @ts-check
// <!-- scope: human-approved 2026-05-24 phase-7b-decouple-from-cross-repo-runner — minimal in-scripts port of the pure-function ship-rate logic so scripts/check-cross-repo-pr-rate.mjs no longer depends on novel/cross-repo-runner/ at runtime, clearing the last live consumer for Phase 7b deletion. -->
//
// Pure-function ship-rate computation. Ported from
// `novel/cross-repo-runner/src/iteration-ship-rate.ts` so that
// `scripts/check-cross-repo-pr-rate.mjs` no longer needs to import
// from `novel/cross-repo-runner/dist/`. Phase 7b of the Path A
// aggressive cut — clears the last production consumer of the package
// (the 2 integration tests test the package itself and will be
// deleted with it).
//
// The Python equivalent at `scripts/iteration_ship_rate.py` carries
// the same pre-registered thresholds + the bash-callable CLI. Both
// share the same numeric constants below; an edit in one MUST land in
// the other in the same PR. (Rule #9 — pinned values, deliberate diff.)
//
// Anchors:
//   - Beyer et al., SRE 2016 Ch. 6
//   - Forsgren/Humble/Kim, Accelerate 2018
//   - Munafò et al., Nature Human Behaviour 1, 0021 (2017)

/**
 * Pre-registered ship-rate target (rule #9). Match
 * `scripts/iteration_ship_rate.py` SHIP_RATE_TARGET.
 */
export const SHIP_RATE_TARGET = 0.15;

/**
 * Pre-registered ship-rate floor. Match
 * `scripts/iteration_ship_rate.py` SHIP_RATE_FLOOR.
 */
export const SHIP_RATE_FLOOR = 0.1;

/**
 * Pre-registered minimum sample size. Match
 * `scripts/iteration_ship_rate.py` MIN_SAMPLE_SIZE.
 */
export const MIN_SAMPLE_SIZE = 5;

/**
 * Default rolling window in days. Match
 * `scripts/iteration_ship_rate.py` DEFAULT_WINDOW_DAYS.
 */
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * @typedef {Object} ShipRateRecord
 * @property {string} ts
 * @property {string | null} pr_url
 */

/**
 * @typedef {"ABOVE" | "WARN" | "BELOW" | "INSUFFICIENT-DATA"} ShipRateVerdict
 */

/**
 * @typedef {Object} ShipRateResult
 * @property {number} rate
 * @property {number} n
 * @property {number} withPr
 * @property {ShipRateVerdict} verdict
 */

/**
 * @typedef {Object} ComputeShipRateOptions
 * @property {number} [windowDays]
 * @property {number} [nowMs]
 */

/**
 * Compute the iteration→PR ship-rate over a rolling window.
 * Pure: no I/O, no mutation, no clock read unless nowMs is omitted.
 *
 * @param {ReadonlyArray<ShipRateRecord>} records
 * @param {ComputeShipRateOptions} [options]
 * @returns {ShipRateResult}
 */
export function computeShipRate(records, options = {}) {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const nowMs = options.nowMs ?? Date.now();
  const cutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;

  const inWindow = records.filter((r) => isInsideWindow(r, cutoffMs));
  const n = inWindow.length;
  const withPr = inWindow.filter(hasNonEmptyPrUrl).length;

  const rate = n === 0 ? 0 : withPr / n;
  const verdict = bucketVerdict(rate, n);
  return { rate, n, withPr, verdict };
}

/**
 * @param {ShipRateRecord} record
 * @param {number} cutoffMs
 * @returns {boolean}
 */
function isInsideWindow(record, cutoffMs) {
  const tsMs = Date.parse(record.ts);
  if (Number.isNaN(tsMs)) return false;
  return tsMs >= cutoffMs;
}

/**
 * @param {ShipRateRecord} record
 * @returns {boolean}
 */
function hasNonEmptyPrUrl(record) {
  return record.pr_url !== null && record.pr_url !== undefined && record.pr_url !== "";
}

/**
 * Bucket (rate, n) into a verdict against the pre-registered thresholds.
 * Exported so each branch can be unit-tested.
 *
 * @param {number} rate
 * @param {number} n
 * @returns {ShipRateVerdict}
 */
export function bucketVerdict(rate, n) {
  if (n < MIN_SAMPLE_SIZE) return "INSUFFICIENT-DATA";
  if (rate >= SHIP_RATE_TARGET) return "ABOVE";
  if (rate < SHIP_RATE_FLOOR) return "BELOW";
  return "WARN";
}
