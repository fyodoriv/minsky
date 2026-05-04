/**
 * `@minsky/mape-k-loop/oscillation` — oscillation guard for the Execute
 * phase, per Ries, *The Lean Startup*, 2011 (build–measure–learn:
 * "don't re-pivot to a previously-rejected variant" — once a variant has
 * been rejected within the recent past, the loop must move on rather than
 * re-trying the same mutation).
 *
 * Pure function over a `RolloutHistory` log (shared with the sustained-gain
 * guard).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Oscillation guard per Ries 2011 + Kephart-Chess
 *                            2003 (the autonomic-manager guardrail against
 *                            cyclic state). Conformance: full.
 *   - `oscillation(...)`:    Pure decision function (Martin 2017).
 *                            Conformance: full — no I/O, lookback explicit.
 *
 * @module mape-k-loop/oscillation
 */

import type { RolloutHistory, RolloutHistoryEntry } from "./sustained-gain.js";

/** Argument bundle for `oscillation`. */
export interface OscillationArgs {
  /** Variant id the Plan phase wants to (re-)propose. */
  readonly proposedVariantId: string;
  /** Append-only rollout-history log. */
  readonly history: RolloutHistory;
  /**
   * How many iterations back to scan. Default
   * {@link DEFAULT_LOOKBACK_ITERATIONS}.
   */
  readonly lookbackIterations?: number;
}

/** Outcome of the guard — `ok: true` = safe to propose; `ok: false` = guard fired. */
export interface OscillationResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/** Default lookback per the rule-#9 risk note in `TASKS.md` (10 iterations). */
export const DEFAULT_LOOKBACK_ITERATIONS = 10;

/**
 * Returns `{ ok: false }` iff the supplied `proposedVariantId` was previously
 * `rejected` (or `abstain`-ed — both indicate "the loop did not adopt this
 * variant") within the most-recent `lookbackIterations` history entries.
 *
 * The guard treats *only* rejections / abstentions as oscillation signals —
 * a previously-rolled-out variant that's being re-proposed is *not*
 * oscillation; that's the desired sustained-gain dynamic.
 *
 * @otel mape-k-loop.oscillation
 */
export function oscillation(args: OscillationArgs): OscillationResult {
  const lookback = args.lookbackIterations ?? DEFAULT_LOOKBACK_ITERATIONS;
  const recent = takeRecent(args.history, lookback);
  const offender = findRejection(recent, args.proposedVariantId);
  if (offender !== undefined) {
    return {
      ok: false,
      reason:
        `oscillation: ${args.proposedVariantId} was ${offender.decision} at ` +
        `iteration ${offender.iteration} (within last ${lookback} iterations)`,
    };
  }
  return { ok: true };
}

// ---------- helpers (≤10 cognitive complexity each) -------------------------

/**
 * Take the most recent `lookback` entries from `history` (by iteration
 * number). Pure helper.
 *
 * @otel-exempt pure helper of `oscillation`.
 */
function takeRecent(history: RolloutHistory, lookback: number): readonly RolloutHistoryEntry[] {
  const sorted = [...history].sort((a, b) => b.iteration - a.iteration);
  return sorted.slice(0, Math.max(0, lookback));
}

/**
 * Find the first entry in `recent` whose `variantId === proposed` and whose
 * decision indicates rejection (`rejected` | `abstain`). Returns `undefined`
 * when no such entry exists.
 *
 * @otel-exempt pure helper of `oscillation`.
 */
function findRejection(
  recent: readonly RolloutHistoryEntry[],
  proposed: string,
): RolloutHistoryEntry | undefined {
  for (const entry of recent) {
    if (entry.variantId !== proposed) continue;
    if (entry.decision === "rejected" || entry.decision === "abstain") return entry;
  }
  return undefined;
}
