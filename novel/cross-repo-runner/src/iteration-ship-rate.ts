// <!-- scope: human-approved 2026-05-24 cross-repo-iteration-ship-rate-ci-gate — pure verdict-producer for the new M1 P0 ship-rate gate; thresholds pinned per rule #9 + Munafò 2017; shared by the CLI lint, the metric collector, and the optional runtime invariant per the task spec. -->
//
// Pure verdict-producer for the cross-repo runner's iteration→PR ship-rate.
// The runner appends one record per spawn to `.minsky/experiment-store/cross-repo/*.jsonl`;
// this module turns those records into a single windowed ratio + a verdict
// against pre-registered thresholds.
//
// Pattern: pure function + exported constants (rule #2 — one source of truth).
//   The CLI bin `scripts/check-cross-repo-pr-rate.mjs` does the I/O (read jsonl,
//   write JSON, set exit code); this file does only the arithmetic + the
//   verdict bucket. The same `computeShipRate` is reused by:
//     - the CLI lint (operator-push gate via pre-pr-lint `--stage=full`),
//     - the `scripts/collect-metrics.mjs` collector that fills METRICS.md,
//     - optionally the `shipRateAboveFloor` runtime invariant.
//   One pure function → three callers → one threshold (Munafò et al. 2017
//   pre-registration discipline; rule #10 deterministic).
//
// Source: TASKS.md `cross-repo-iteration-ship-rate-ci-gate` (P0 M1) — closes
//   the *measurement* loop opened by `walker-drains-one-host-forever` (#644).
//   Walker-drains made distribution fair; this metric makes the per-host
//   outcome visible. Fairness without measurement is a vanity feature.
//
// Anchors:
//   - Beyer et al., Site Reliability Engineering, O'Reilly 2016, Ch. 6 —
//     "if you can't measure it, you can't improve it"; aggregate visibility
//     for the four golden signals.
//   - Forsgren/Humble/Kim, Accelerate, IT Revolution 2018 — DORA keys are
//     ratios over a window, not per-iteration spot-checks; this is the
//     cross-repo runner's local "deployment frequency / iteration count".
//   - Munafò et al., A manifesto for reproducible science, Nature Human
//     Behaviour 1, 0021 (2017) — pre-registered thresholds pinned as
//     exported constants in code, so a tune-the-threshold PR is a
//     deliberate diff rather than a silent drift.
//
// Conformance: full — pure function over typed inputs; no I/O.

/**
 * Minimum record shape `computeShipRate` needs. The full
 * `IterationRecord` satisfies this trivially; the CLI bin reads raw
 * JSONL lines and only the two fields below are load-bearing for the
 * ship-rate computation, so accepting the narrower shape lets the bin
 * forward parsed JSON without round-tripping through a fuller type.
 */
export interface ShipRateRecord {
  /** ISO-8601 UTC timestamp. */
  readonly ts: string;
  /** PR URL (non-null + non-empty counts as `withPr`). */
  readonly pr_url: string | null;
}

/**
 * Pre-registered ship-rate target (rule #9). At or above this, the runner is
 * shipping enough PRs to justify its iteration cost. The verdict is `ABOVE`.
 *
 * Changing this requires a deliberate edit; the paired test pins the value
 * so a typo becomes a CI break, not a silent gate drift.
 */
export const SHIP_RATE_TARGET = 0.15;

/**
 * Pre-registered ship-rate floor (rule #9). Below this, the runner's
 * iteration→PR ratio is bad enough that the operator should pay attention
 * before pushing more work. The verdict is `BELOW` and the CLI bin exits
 * non-zero so `pre-pr-lint --stage=full` blocks the operator's push.
 *
 * The 0.10–0.15 band is `WARN` — log it, don't block.
 */
export const SHIP_RATE_FLOOR = 0.1;

/**
 * Pre-registered minimum sample size (rule #9). Below this many records,
 * the ratio is too noisy to verdict on — return `INSUFFICIENT-DATA` and
 * skip the gate. Five is the minimum at which a single-PR outcome moves
 * the rate by ≤0.20, which is below the FLOOR-to-TARGET band.
 */
export const MIN_SAMPLE_SIZE = 5;

/**
 * Default rolling window in days. 30 days matches the DORA reporting cadence
 * and the existing `cto-audit-metrics.mjs` shape. Overridable per call so
 * the metric collector can request a 7d window and the CI lint a 30d one.
 */
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * The verdict bucket for one windowed ship-rate measurement.
 *
 * - `ABOVE` — rate ≥ SHIP_RATE_TARGET (0.15). The runner is healthy.
 * - `WARN` — SHIP_RATE_FLOOR ≤ rate < SHIP_RATE_TARGET (0.10–0.15). Log, don't block.
 * - `BELOW` — rate < SHIP_RATE_FLOOR (0.10). Block: the CLI bin exits 1.
 * - `INSUFFICIENT-DATA` — fewer than MIN_SAMPLE_SIZE records in the window.
 *   Not a failure; the daemon just hasn't run enough iterations to verdict.
 */
export type ShipRateVerdict = "ABOVE" | "WARN" | "BELOW" | "INSUFFICIENT-DATA";

/**
 * The output of `computeShipRate`.
 */
export interface ShipRateResult {
  /** withPr / n. `0` when n === 0. */
  readonly rate: number;
  /** Total records in the window. */
  readonly n: number;
  /** Records whose `pr_url` was non-null. */
  readonly withPr: number;
  /** The verdict bucket against the pre-registered thresholds. */
  readonly verdict: ShipRateVerdict;
}

/**
 * Options for `computeShipRate`.
 */
export interface ComputeShipRateOptions {
  /** Rolling window in days (default {@link DEFAULT_WINDOW_DAYS} = 30). */
  readonly windowDays?: number;
  /** Clock for the window cutoff. Pure-function seam — caller supplies the
   *  clock so the function stays deterministic over fixtures. Defaults to
   *  `Date.now()` only when the field is omitted; the bin always passes the
   *  real clock. */
  readonly nowMs?: number;
}

/**
 * Compute the iteration→PR ship-rate over a rolling window with a
 * pre-registered verdict bucket. Pure: no I/O, no mutation, no clock read
 * unless the caller omits `nowMs`.
 *
 * @otel cross-repo-runner.compute-ship-rate
 *
 * @example
 *   const records = [
 *     { ts: "2026-05-20T00:00:00Z", verdict: "validated", pr_url: "..." },
 *     { ts: "2026-05-21T00:00:00Z", verdict: "scope-leak", pr_url: null },
 *   ] satisfies IterationRecord[];
 *   computeShipRate(records, { windowDays: 30, nowMs: 1748246400000 });
 *   // → { rate: 0.5, n: 2, withPr: 1, verdict: "INSUFFICIENT-DATA" }
 *   //   (rate is technically 0.5 — ABOVE the target — but n < MIN_SAMPLE_SIZE.)
 */
export function computeShipRate(
  records: readonly ShipRateRecord[],
  options: ComputeShipRateOptions = {},
): ShipRateResult {
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
 * Pure predicate: is the record's timestamp parseable and inside the
 * rolling window? Extracted so `computeShipRate` stays under the
 * cognitive-complexity ceiling (biome's noExcessiveCognitiveComplexity).
 */
function isInsideWindow(record: ShipRateRecord, cutoffMs: number): boolean {
  const tsMs = Date.parse(record.ts);
  if (Number.isNaN(tsMs)) return false;
  return tsMs >= cutoffMs;
}

/**
 * Pure predicate: does the record's `pr_url` field represent an opened
 * PR? Treats `null`, `undefined`, and empty-string as "no PR" — the
 * latter two are defensive against record-shape drift (the daemon
 * appends `null` today, but a future writer might serialize differently).
 */
function hasNonEmptyPrUrl(record: ShipRateRecord): boolean {
  return record.pr_url !== null && record.pr_url !== undefined && record.pr_url !== "";
}

/**
 * Bucket a (rate, n) pair into a verdict. Pure helper, exported for tests
 * so each branch can be exercised without constructing a record array.
 *
 * @otel-exempt pure-arithmetic — single comparison cascade over two
 *   numbers, no I/O, no async. The wrapping `computeShipRate` call carries
 *   the `cross-repo-runner.compute-ship-rate` span.
 */
export function bucketVerdict(rate: number, n: number): ShipRateVerdict {
  if (n < MIN_SAMPLE_SIZE) return "INSUFFICIENT-DATA";
  if (rate >= SHIP_RATE_TARGET) return "ABOVE";
  if (rate < SHIP_RATE_FLOOR) return "BELOW";
  return "WARN";
}
