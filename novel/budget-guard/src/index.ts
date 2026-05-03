/**
 * `claude-budget-guard` — token-budget watchdog. Observes a {@link TokenMonitor}
 * and decides which response category applies under rule #7's failure-mode
 * vocabulary: `graceful-degrade` / `circuit-break-and-notify` / `normal`.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index, row 26):
 *   - The class itself:    Watchdog (hardware / OS literature; periodic-deadline
 *                          check loop). Conformance: full. Identifier matches
 *                          the pattern's canonical name per rule #8.
 *   - Thresholding logic:  Error budget — Beyer et al., *Site Reliability
 *                          Engineering*, Ch. 3, 2016 (treat token usage as the
 *                          budget you spend and burn-rate alert against it).
 *                          Conformance: full.
 *   - Decision categories: Failure-mode response labels (rule #7 / vision.md
 *                          § 7) — `graceful-degrade`, `circuit-break-and-notify`,
 *                          `loud-crash-supervisor-restart`. Conformance: full.
 *
 * v0 scope: pure decision logic + tests. The follow-up sub-tasks ship the
 * runtime envelopes — `budget-guard-flag-file` writes `.minsky/budget.flag`,
 * `budget-guard-http-api` exposes JSON on `localhost:9876`,
 * `budget-guard-maciek-impl` is the real `TokenMonitor` Strategy against the
 * Python tool. All tracked in `TASKS.md`.
 */

import { type TokenMonitor, type TokenSnapshot, consumedFraction } from "@minsky/token-monitor";

/** Failure-mode response per rule #7. `normal` is the absence of a fault. */
export type BudgetAction =
  | "normal"
  | "graceful-degrade"
  | "circuit-break-and-notify"
  | "weekly-cap-warn";

export interface BudgetThresholds {
  /** 5h-window consumed-fraction at which low-effort personas switch to Haiku. */
  readonly degradeAt: number;
  /** 5h-window consumed-fraction at which new tick claims are paused. */
  readonly circuitBreakAt: number;
  /** Weekly headroom fraction below which sleep cycles extend. */
  readonly weeklyWarnAt: number;
}

export const DEFAULT_THRESHOLDS: BudgetThresholds = {
  degradeAt: 0.7,
  circuitBreakAt: 0.85,
  weeklyWarnAt: 0.2,
};

export interface BudgetDecision {
  readonly action: BudgetAction;
  readonly snapshot: TokenSnapshot;
  readonly consumed: number;
  readonly reason: string;
  readonly decidedAt: string;
}

/**
 * Pure decision function — no I / O. Given a snapshot and thresholds, returns
 * which {@link BudgetAction} applies. Higher-severity actions take precedence
 * (status-lattice meet, same as `aggregateStatus` in observability):
 * `circuit-break-and-notify` ⊐ `graceful-degrade` ⊐ `weekly-cap-warn` ⊐ `normal`.
 */
export function decide(
  snapshot: TokenSnapshot,
  thresholds: BudgetThresholds = DEFAULT_THRESHOLDS,
): BudgetDecision {
  const consumed = consumedFraction(snapshot);
  const decidedAt = new Date().toISOString();

  if (consumed >= thresholds.circuitBreakAt) {
    return {
      action: "circuit-break-and-notify",
      snapshot,
      consumed,
      reason: `5h window ${(consumed * 100).toFixed(1)}% consumed, ≥ ${(thresholds.circuitBreakAt * 100).toFixed(0)}% circuit-break threshold`,
      decidedAt,
    };
  }
  if (consumed >= thresholds.degradeAt) {
    return {
      action: "graceful-degrade",
      snapshot,
      consumed,
      reason: `5h window ${(consumed * 100).toFixed(1)}% consumed, ≥ ${(thresholds.degradeAt * 100).toFixed(0)}% degrade threshold`,
      decidedAt,
    };
  }
  if (snapshot.weeklyHeadroomFraction <= thresholds.weeklyWarnAt) {
    return {
      action: "weekly-cap-warn",
      snapshot,
      consumed,
      reason: `weekly headroom ${(snapshot.weeklyHeadroomFraction * 100).toFixed(1)}%, ≤ ${(thresholds.weeklyWarnAt * 100).toFixed(0)}% warn threshold`,
      decidedAt,
    };
  }
  return {
    action: "normal",
    snapshot,
    consumed,
    reason: "within all thresholds",
    decidedAt,
  };
}

/**
 * The watchdog itself: a periodic check loop with a deadline. Calls
 * `monitor.snapshot()` every `pollIntervalMs`, pushes the {@link BudgetDecision}
 * to the supplied callback. The caller decides what to *do* with the decision
 * — write a flag file, fire an OTEL span, set HTTP status, etc. (sub-tasks).
 *
 * Pattern: watchdog timer (hardware / OS literature). Conformance: full.
 */
export class BudgetGuard {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly monitor: TokenMonitor,
    private readonly onDecision: (d: BudgetDecision) => void,
    private readonly thresholds: BudgetThresholds = DEFAULT_THRESHOLDS,
    private readonly pollIntervalMs: number = 60_000,
  ) {}

  /** Take one snapshot now and return the decision, also pushing to onDecision. */
  async tick(): Promise<BudgetDecision> {
    const snap = await this.monitor.snapshot();
    const decision = decide(snap, this.thresholds);
    this.onDecision(decision);
    return decision;
  }

  /** Begin the periodic poll loop. Idempotent — calling twice is a no-op. */
  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  /** Stop the periodic poll loop. Idempotent. */
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

export {
  type FlagToken,
  decisionToFlagToken,
  flagFilePath,
  writeBudgetFlag,
} from "./flag-file.js";

export {
  type BudgetJson,
  type BudgetServer,
  type DecisionGetter,
  DEFAULT_PORT,
  HonoBudgetServer,
  budgetResponse,
} from "./http-server.js";
