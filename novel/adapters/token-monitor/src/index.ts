/**
 * TokenMonitor adapter — interface over the user-facing token-usage tracker.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index, row 25):
 *   - This module:           Adapter (structural) + Strategy (behavioral) per
 *                            Gamma, Helm, Johnson, Vlissides, *Design Patterns*,
 *                            1994. Conformance: full.
 *   - The shape itself:      Health-status snapshot — Avizienis et al.,
 *                            "Basic Concepts and Taxonomy of Dependable and
 *                            Secure Computing", *IEEE TDSC* 2004 (instantaneous
 *                            view of resource state). Conformance: full.
 *
 * v0 ships the interface + an in-memory `StubTokenMonitor` for tests + the
 * real {@link MaciekTokenMonitor} Strategy at `./maciek.ts` that derives
 * the snapshot directly from `~/.claude/projects/<cwd>/<session>.jsonl`
 * (the same data Maciek's `claude-monitor` reads).
 *
 * Anchors:
 *   - "Watchdog" terminology — hardware / OS watchdog timer literature.
 *   - "Error budget" framing — Beyer et al., *Site Reliability Engineering*,
 *     Ch. 3, 2016 (tokens treated as the error budget you spend).
 */

/**
 * Snapshot of the current token-budget state. All values are *observed*, not
 * computed — the rolling 5h window and weekly cap are tier-dependent (Max5,
 * Max20, …) and not published by Anthropic, so adapters never hardcode them
 * (see ARCHITECTURE.md § "Token economy").
 */
export interface TokenSnapshot {
  /** Tokens remaining in the current 5h rolling window. */
  readonly tokensRemainingInWindow: number;
  /** Total tokens the current 5h window started with (the observed peak). */
  readonly windowSizeTokens: number;
  /** Seconds until the current 5h window resets. */
  readonly secondsUntilWindowReset: number;
  /** Weekly headroom remaining as a fraction in `[0, 1]`. */
  readonly weeklyHeadroomFraction: number;
  /** ISO-8601 UTC timestamp at which this snapshot was taken. */
  readonly observedAt: string;
  /**
   * Monthly headroom remaining as a fraction in `[0, 1]` (slice 1 of
   * `claude-usage-aware-strategic-model-router`). When the adapter
   * doesn't track monthly cumulative spend (e.g., Maciek v0), this is
   * `1.0` indicating "headroom assumed full, monthly cap not gating".
   * Strategic picker treats `null` as "unknown — be conservative" once
   * adapters opt into nullable; `1.0` as "full — use best-tier model".
   */
  readonly monthlyHeadroomFraction: number;
  /** Seconds until the current weekly window resets (Monday 00:00 UTC). */
  readonly secondsUntilWeekReset: number;
  /** Seconds until the current monthly window resets (1st-of-month 00:00 UTC). */
  readonly secondsUntilMonthReset: number;
}

/**
 * Continuous remaining-fraction surface per window. Slice 1 of
 * `claude-usage-aware-strategic-model-router` — the strategic picker
 * walks the {@link MODEL_CATALOG} and compares each tier's per-window
 * floors against this struct to pick the highest-quality model that
 * fits all three budgets.
 *
 * All values in `[0, 1]`. `1.0` = full headroom; `0` = exhausted.
 * Computed via {@link remainingFractions}.
 */
export interface RemainingFractions {
  /** 5h-window remaining fraction (derived from `tokensRemainingInWindow / windowSizeTokens`). */
  readonly fivehour: number;
  /** Weekly remaining fraction (the raw `weeklyHeadroomFraction`). */
  readonly weekly: number;
  /** Monthly remaining fraction (the raw `monthlyHeadroomFraction`). */
  readonly monthly: number;
  /** ISO-8601 UTC timestamp from the source snapshot — propagated for staleness checks. */
  readonly observedAt: string;
}

/**
 * Extract the continuous remaining-fraction triple from a {@link TokenSnapshot}.
 * Pure function — no I/O, no clock. Clamps each fraction to `[0, 1]`.
 *
 * Slice 1 of `claude-usage-aware-strategic-model-router`: this is the
 * input shape `pickStrategicModel` consumes. Keeps the picker decoupled
 * from `TokenSnapshot`'s broader (legacy-shaped) surface.
 *
 * @otel-exempt pure arithmetic helper
 */
export function remainingFractions(snapshot: TokenSnapshot): RemainingFractions {
  const fivehour =
    snapshot.windowSizeTokens <= 0
      ? 0
      : clamp01(snapshot.tokensRemainingInWindow / snapshot.windowSizeTokens);
  return {
    fivehour,
    weekly: clamp01(snapshot.weeklyHeadroomFraction),
    monthly: clamp01(snapshot.monthlyHeadroomFraction),
    observedAt: snapshot.observedAt,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Strategy-pattern interface for any tool that can produce a {@link TokenSnapshot}.
 * The default v1 implementation will wrap Maciek's `claude-monitor` Python tool
 * (`novel/adapters/token-monitor/src/maciek.ts`, planned).
 */
export interface TokenMonitor {
  /** Returns the current snapshot. Cheap — must be safe to call once per second. */
  snapshot(): Promise<TokenSnapshot>;
}

/**
 * In-memory `TokenMonitor` for tests. Returns whatever was last fed via {@link set}.
 * Pattern: test double / fake (Meszaros, *xUnit Test Patterns*, 2007). Conformance: full.
 */
export class StubTokenMonitor implements TokenMonitor {
  private current: TokenSnapshot;

  constructor(initial?: Partial<TokenSnapshot>) {
    this.current = { ...defaultSnapshot(), ...initial };
  }

  /**
   * Programs the next snapshot.
   *
   * @otel-exempt test double — production callers never invoke this; spans here would be noise
   */
  set(next: Partial<TokenSnapshot>): void {
    this.current = { ...this.current, ...next };
  }

  /**
   * @otel-exempt test double — returns programmed value with no I/O; covered by the caller's span
   */
  async snapshot(): Promise<TokenSnapshot> {
    return this.current;
  }
}

function defaultSnapshot(): TokenSnapshot {
  return {
    tokensRemainingInWindow: 1_000_000,
    windowSizeTokens: 1_000_000,
    secondsUntilWindowReset: 5 * 60 * 60,
    weeklyHeadroomFraction: 1.0,
    observedAt: new Date().toISOString(),
    // Slice 1 of `claude-usage-aware-strategic-model-router`: monthly
    // window defaults to "full headroom" so the strategic picker can
    // route to the highest-quality model when no monthly data is
    // available (cold-start, fresh install). Maciek adapter overrides
    // these once it parses real monthly cumulative spend.
    monthlyHeadroomFraction: 1.0,
    secondsUntilWeekReset: 7 * 24 * 60 * 60,
    secondsUntilMonthReset: 30 * 24 * 60 * 60,
  };
}

/**
 * Helper: fraction of the 5h window currently consumed (`0` = fresh, `1` = exhausted).
 * The threshold logic in `@minsky/budget-guard` uses this against the
 * configurable 70 % / 85 % cut-offs documented in `ARCHITECTURE.md` §
 * "Token economy".
 *
 * @otel-exempt pure arithmetic helper; spans here would dominate the work; caller's span suffices
 */
export function consumedFraction(s: TokenSnapshot): number {
  if (s.windowSizeTokens <= 0) return 0;
  const consumed = s.windowSizeTokens - s.tokensRemainingInWindow;
  const fraction = consumed / s.windowSizeTokens;
  if (fraction < 0) return 0;
  if (fraction > 1) return 1;
  return fraction;
}

export {
  MaciekTokenMonitor,
  PLAN_CAPS,
  type MaciekTokenMonitorOpts,
  type PlanName,
} from "./maciek.js";
