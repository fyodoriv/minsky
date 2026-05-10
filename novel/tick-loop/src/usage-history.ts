/**
 * One ring-buffer entry. Captures enough to reproduce the picker's
 * decision input + the picker's output for trajectory analysis.
 */
export interface UsageHistoryEntry {
  /** ISO-8601 UTC observedAt from the snapshot. */
  readonly observedAt: string;
  /** 5h-window remaining fraction at this observation. */
  readonly fivehour: number;
  /** Weekly remaining fraction. */
  readonly weekly: number;
  /** Monthly remaining fraction. */
  readonly monthly: number;
  /** Model id the picker returned for this snapshot (for trajectory inspection). */
  readonly pickedModel: string;
}

/**
 * Default capacity — 100 entries × 30s = 50 minutes of trajectory
 * memory, which is enough to predict 5h-window exhaustion with linear
 * regression but not so long that stale entries dominate the fit.
 */
export const DEFAULT_HISTORY_CAP = 100;

/**
 * Pure: append `entry` to `history`, evicting the oldest entry FIFO
 * if the buffer is at capacity. Defensive: clamps any NaN/Infinity in
 * `entry`'s fractions to 0 so a malformed upstream snapshot doesn't
 * poison subsequent predictions.
 *
 * @otel-exempt pure helper; trivial array operation
 */
export function appendUsageHistory(args: {
  readonly history: readonly UsageHistoryEntry[];
  readonly entry: UsageHistoryEntry;
  readonly capN?: number;
}): readonly UsageHistoryEntry[] {
  const cap = args.capN ?? DEFAULT_HISTORY_CAP;
  const sanitized: UsageHistoryEntry = {
    observedAt: args.entry.observedAt,
    fivehour: clampFraction(args.entry.fivehour),
    weekly: clampFraction(args.entry.weekly),
    monthly: clampFraction(args.entry.monthly),
    pickedModel: args.entry.pickedModel,
  };
  const next = [...args.history, sanitized];
  if (next.length <= cap) return Object.freeze(next);
  return Object.freeze(next.slice(next.length - cap));
}

/**
 * Pure: linear-regression predictor over `history` for each window.
 * Returns the wall-clock ms until each window reaches `0` extrapolating
 * the current trajectory. `undefined` means "no signal" — fewer than 2
 * points OR slope is non-negative (window growing or flat).
 *
 * Algorithm: least-squares slope `m = Σ(t_i - t̄)(y_i - ȳ) / Σ(t_i - t̄)²`
 * where t_i is `observedAt` ms, y_i is the window fraction. Time-to-
 * exhaustion = `current_y / -m` ms when `m < 0`, else `undefined`.
 *
 * @otel-exempt pure helper
 */
export function predictExhaustionMs(history: readonly UsageHistoryEntry[]): {
  readonly fivehour: number | undefined;
  readonly weekly: number | undefined;
  readonly monthly: number | undefined;
} {
  if (history.length < 2) {
    return { fivehour: undefined, weekly: undefined, monthly: undefined };
  }
  return {
    fivehour: predictWindow(history, (e) => e.fivehour),
    weekly: predictWindow(history, (e) => e.weekly),
    monthly: predictWindow(history, (e) => e.monthly),
  };
}

/**
 * Pure: filter the history to only entries whose observedAt is within
 * the last `windowMs` (ms before `now`). Used by the predictor to focus
 * on recent trajectory rather than fitting across a whole 50-minute
 * buffer that may include a window-reset discontinuity.
 *
 * @otel-exempt pure helper
 */
export function recentHistory(
  history: readonly UsageHistoryEntry[],
  nowMs: number,
  windowMs: number,
): readonly UsageHistoryEntry[] {
  const cutoff = nowMs - windowMs;
  return Object.freeze(
    history.filter((e) => {
      const t = Date.parse(e.observedAt);
      return Number.isFinite(t) && t >= cutoff;
    }),
  );
}

// ---- Internal helpers -----------------------------------------------------

function clampFraction(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function predictWindow(
  history: readonly UsageHistoryEntry[],
  pickY: (entry: UsageHistoryEntry) => number,
): number | undefined {
  const points = toRegressionPoints(history, pickY);
  if (points.length < 2) return undefined;
  const slopePerMs = leastSquaresSlope(points);
  if (slopePerMs === undefined || slopePerMs >= 0) return undefined;
  // Current y is the last entry's value.
  const lastEntry = history[history.length - 1];
  if (lastEntry === undefined) return undefined;
  const currentY = pickY(lastEntry);
  if (currentY <= 0) return 0;
  // Time to reach 0 at the current slope (ms).
  const msToZero = currentY / -slopePerMs;
  if (!Number.isFinite(msToZero) || msToZero < 0) return undefined;
  return msToZero;
}

function toRegressionPoints(
  history: readonly UsageHistoryEntry[],
  pickY: (entry: UsageHistoryEntry) => number,
): readonly { readonly t: number; readonly y: number }[] {
  const out: { t: number; y: number }[] = [];
  for (const e of history) {
    const t = Date.parse(e.observedAt);
    if (!Number.isFinite(t)) continue;
    const y = pickY(e);
    if (!Number.isFinite(y)) continue;
    out.push({ t, y });
  }
  return Object.freeze(out);
}

function leastSquaresSlope(
  points: readonly { readonly t: number; readonly y: number }[],
): number | undefined {
  if (points.length < 2) return undefined;
  const n = points.length;
  let sumT = 0;
  let sumY = 0;
  for (const p of points) {
    sumT += p.t;
    sumY += p.y;
  }
  const meanT = sumT / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    const dt = p.t - meanT;
    num += dt * (p.y - meanY);
    den += dt * dt;
  }
  if (den === 0) return undefined;
  return num / den;
}
