/**
 * `@minsky/mape-k-loop/sustained-gain` — sustained-gain guard for the Execute
 * phase, per Kohavi, Tang, Xu, *Trustworthy Online Controlled Experiments*,
 * Cambridge UP 2020, Ch. 3 (a winner is only honoured if its score holds for
 * a configured window — default 7 days).
 *
 * Pure function over a `RolloutHistory` log. The Execute phase invokes this
 * guard *after* picking the highest-scoring variant; if the guard fails, the
 * decision flips from `rollout` to `abstain`.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Sustained-gain window guard per Kohavi-Tang-Xu
 *                            2020. Conformance: full for the
 *                            ≥`windowDays`-with-consistent-winner contract.
 *   - `sustainedGain(...)`:  Pure decision function (Martin 2017).
 *                            Conformance: full — no I/O, clock injected.
 *
 * @module mape-k-loop/sustained-gain
 */

/**
 * One row in the rollout-history log. The log is append-only (Helland 2007 —
 * the Knowledge phase substrate); each row records one Execute-phase decision.
 */
export interface RolloutHistoryEntry {
  /** 1-based monotonically-increasing iteration number. */
  readonly iteration: number;
  /** ISO-8601 timestamp of the decision. */
  readonly ts: string;
  /** Variant id the decision is about. */
  readonly variantId: string;
  /** What Execute decided. `rejected` is reserved for guard refusals. */
  readonly decision: "rollout" | "abstain" | "rejected";
  /** Variant score at the time of the decision (where applicable). */
  readonly score?: number;
}

/** The append-only rollout-history log. */
export type RolloutHistory = readonly RolloutHistoryEntry[];

/** Argument bundle for `sustainedGain`. */
export interface SustainedGainArgs {
  /** Variant id whose sustained-gain we're checking. */
  readonly winnerVariantId: string;
  /** Append-only rollout-history log. */
  readonly history: RolloutHistory;
  /** Reference clock (injected for deterministic tests). */
  readonly now: Date;
  /** Sustained-gain window in days. Default {@link DEFAULT_WINDOW_DAYS}. */
  readonly windowDays?: number;
  /**
   * Minimum score that counts as "winning". Entries scoring below this are
   * treated as a swap (the winner was unseated). Defaults to
   * {@link DEFAULT_SCORE_THRESHOLD}.
   */
  readonly scoreThreshold?: number;
}

/** Outcome of the guard — `ok: true` = window honoured; `ok: false` = guard fired. */
export interface SustainedGainResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/** Default window per Kohavi-Tang-Xu 2020 Ch. 3. */
export const DEFAULT_WINDOW_DAYS = 7;

/** Default score threshold (`> 0` — any positive score counts as winning). */
export const DEFAULT_SCORE_THRESHOLD = 0;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns `{ ok: true }` iff the supplied `winnerVariantId` has been the
 * (above-threshold) winner of every history entry whose timestamp falls in
 * `[now - windowDays, now]`, AND the earliest such entry is at least
 * `windowDays` old. New variants (no in-window history) → `{ ok: false }`
 * (per Kohavi-Tang-Xu 2020: insufficient evidence is not a sustained gain).
 *
 * @otel mape-k-loop.sustained-gain
 */
export function sustainedGain(args: SustainedGainArgs): SustainedGainResult {
  const windowDays = args.windowDays ?? DEFAULT_WINDOW_DAYS;
  const scoreThreshold = args.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const cutoffMs = args.now.getTime() - windowDays * MS_PER_DAY;
  const inWindow = collectInWindow(args.history, cutoffMs);
  if (inWindow.length === 0) {
    return {
      ok: false,
      reason: `sustained-gain: no rollout history within last ${windowDays}d for any variant`,
    };
  }
  const earliestMs = Math.min(...inWindow.map((e) => Date.parse(e.ts)));
  const spanMs = args.now.getTime() - earliestMs;
  if (spanMs < windowDays * MS_PER_DAY) {
    return {
      ok: false,
      reason:
        `sustained-gain: window only spans ${(spanMs / MS_PER_DAY).toFixed(2)}d ` +
        `(< required ${windowDays}d) — insufficient evidence for ${args.winnerVariantId}`,
    };
  }
  const swap = findFirstSwap(inWindow, args.winnerVariantId, scoreThreshold);
  if (swap !== undefined) {
    return {
      ok: false,
      reason:
        `sustained-gain: winner swapped at iteration ${swap.iteration} ` +
        `(saw ${swap.variantId}; expected ${args.winnerVariantId})`,
    };
  }
  return { ok: true };
}

// ---------- helpers (≤10 cognitive complexity each) -------------------------

/**
 * Filter `history` to entries whose `ts` is at-or-after `cutoffMs` AND whose
 * decision counts toward the gain (i.e., `rollout` or `abstain` — `rejected`
 * is a guard-refusal artefact, not a measurement). Malformed timestamps are
 * silently dropped — graceful-degrade per rule #7.
 *
 * @otel-exempt pure helper of `sustainedGain`.
 */
function collectInWindow(
  history: RolloutHistory,
  cutoffMs: number,
): readonly RolloutHistoryEntry[] {
  const out: RolloutHistoryEntry[] = [];
  for (const entry of history) {
    if (entry.decision === "rejected") continue;
    const tsMs = Date.parse(entry.ts);
    if (!Number.isFinite(tsMs)) continue;
    if (tsMs >= cutoffMs) out.push(entry);
  }
  return out;
}

/**
 * Walk `inWindow` in iteration order and return the first entry that
 * disagrees with `winnerVariantId` (different variant, OR same variant but
 * score below threshold). Returns `undefined` if the winner held throughout.
 *
 * @otel-exempt pure helper of `sustainedGain`.
 */
function findFirstSwap(
  inWindow: readonly RolloutHistoryEntry[],
  winnerVariantId: string,
  scoreThreshold: number,
): RolloutHistoryEntry | undefined {
  const sorted = [...inWindow].sort((a, b) => a.iteration - b.iteration);
  for (const entry of sorted) {
    if (entry.variantId !== winnerVariantId) return entry;
    if (typeof entry.score === "number" && entry.score <= scoreThreshold) return entry;
  }
  return undefined;
}
