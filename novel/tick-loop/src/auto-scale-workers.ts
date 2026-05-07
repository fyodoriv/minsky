// <!-- scope: human-approved auto-scale-workers (operator 2026-05-07) -->

/**
 * `@minsky/tick-loop/auto-scale-workers` — pure decision function for the
 * supervisor's "should I spawn another worker?" question, evaluated
 * periodically by the root daemon process.
 *
 * Pattern conformance (rule #8):
 *   - **Strategy** (Gamma 1994) — `decideAutoScale` is the seam; the
 *     daemon tests inject synthetic state, production wires the live
 *     iteration counters in.
 *   - **Pre-registered HDD** (rule #9) — the decision rules are listed
 *     in priority order; the operator can read them and predict
 *     `decideAutoScale`'s output for any system state.
 *   - **Fail-safe defaults** (Saltzer & Schroeder 1975) — when the
 *     evidence is mixed or inputs are out of range, the decision is
 *     `hold`, not `spawn`. The default error is "fewer workers than
 *     optimal", not "more workers than the system can stably run".
 *   - **Beyer SRE 2016 Ch. 6** (visible-not-silent) — every `hold`
 *     decision returns a structured reason so the operator log can
 *     answer "why didn't another worker spawn just now?".
 *
 * The decision is intentionally narrow: given a snapshot, return spawn
 * or hold. Periodicity, rate-limiting, and the actual `nodeSpawn` call
 * are the caller's responsibility (next slice — wires this into
 * `bin/tick-loop.mjs`'s root-process tick).
 *
 * @otel-exempt pure decision; the caller emits the
 *   `tick-loop.auto-scale.decision` span with the verdict + reason.
 */

/**
 * Snapshot of the supervisor's state needed to decide whether to spawn
 * another worker. All fields are operator-observable; none require new
 * I/O surfaces beyond what the daemon already collects.
 */
export type AutoScaleState = {
  /**
   * Total worker count currently running, including the root process.
   * The root counts as worker 0; child workers are 1..N.
   * `undefined` is treated as `1` (single-process default).
   */
  readonly currentWorkers: number;
  /**
   * Operator-configured ceiling. Default 5 in the CLI wiring; the
   * decision function refuses to spawn at-or-above this number.
   * Must be ≥1.
   */
  readonly maxWorkers: number;
  /**
   * Count of currently-eligible (unclaimed, unblocked) P0/P1 tasks.
   * Read from `listEligibleTasks(taskSource).length` at the iteration
   * boundary.
   */
  readonly eligibleTaskCount: number;
  /**
   * Count of failed iterations across all workers in the rolling
   * recent-iterations window (default 10 iterations or last 5 minutes,
   * whichever is shorter — caller decides). Includes spawn-timeouts,
   * pre-pr-lint-failures, and iteration crashes. Excludes `no-task`
   * and `budget-paused` (those are normal).
   */
  readonly recentFailedIterations: number;
  /**
   * Anthropic budget-guard signal:
   *   - `"normal"` — full quota available
   *   - `"weekly-cap-warn"` — close to weekly cap (Anthropic's
   *     advisory tier, daemon still running)
   *   - `"weekly-cap-paused"` — quota exhausted, daemon paused
   *   - `"circuit-break"` — daemon's own budget guard tripped
   */
  readonly budgetState: "normal" | "weekly-cap-warn" | "weekly-cap-paused" | "circuit-break";
  /**
   * Count of `collision-prevented` outcomes from `decideTouchesCollision`
   * across all workers in the rolling recent-iterations window. A
   * sustained high number signals that the eligible task set is too
   * tightly coupled and adding more workers won't help (they'd all
   * collide on the same files).
   */
  readonly recentClaimCollisions: number;
};

/**
 * Verdict from `decideAutoScale`. `spawn` is the affirmative; `hold`
 * carries a structured reason so the operator can read why the
 * decision didn't fire (Beyer SRE 2016 Ch. 6 — silence is failure).
 */
export type AutoScaleDecision =
  | { readonly verdict: "spawn"; readonly reason: string }
  | { readonly verdict: "hold"; readonly reason: string };

/**
 * Pre-registered rule constants. Inlined here so a paired test can
 * assert each rule fires at the documented threshold (rule #9 — the
 * threshold IS the spec).
 */
export const AUTO_SCALE_RULES = Object.freeze({
  /** `recentFailedIterations >= this` → hold. */
  failedIterationCeiling: 3,
  /** `recentClaimCollisions >= this` → hold. */
  claimCollisionCeiling: 5,
});

/**
 * Decide whether the root daemon process should fork another worker
 * right now, given the current supervisor state.
 *
 * Decision rules in priority order — earlier rules short-circuit:
 *
 *   1. Invalid state (bad inputs) → hold ("invalid-state").
 *   2. `currentWorkers >= maxWorkers` → hold ("ceiling-reached").
 *   3. Budget paused / circuit-broken → hold ("budget-blocked").
 *   4. `eligibleTaskCount <= currentWorkers` → hold ("no-spare-tasks").
 *   5. `recentFailedIterations >= AUTO_SCALE_RULES.failedIterationCeiling`
 *      → hold ("system-unstable").
 *   6. `recentClaimCollisions >= AUTO_SCALE_RULES.claimCollisionCeiling`
 *      → hold ("contention-high").
 *   7. Otherwise → spawn ("conditions-favourable").
 *
 * @otel-exempt pure decision; instrumentation lives in the caller.
 */
export function decideAutoScale(state: AutoScaleState): AutoScaleDecision {
  if (!isValidState(state)) {
    return { verdict: "hold", reason: "invalid-state: input fields out of range or non-finite" };
  }
  if (state.currentWorkers >= state.maxWorkers) {
    return {
      verdict: "hold",
      reason: `ceiling-reached: ${state.currentWorkers}/${state.maxWorkers} workers`,
    };
  }
  if (state.budgetState === "weekly-cap-paused" || state.budgetState === "circuit-break") {
    return {
      verdict: "hold",
      reason: `budget-blocked: budgetState=${state.budgetState}`,
    };
  }
  if (state.eligibleTaskCount <= state.currentWorkers) {
    return {
      verdict: "hold",
      reason: `no-spare-tasks: ${state.eligibleTaskCount} eligible vs ${state.currentWorkers} workers`,
    };
  }
  if (state.recentFailedIterations >= AUTO_SCALE_RULES.failedIterationCeiling) {
    return {
      verdict: "hold",
      reason: `system-unstable: ${state.recentFailedIterations} recent failures >= ${AUTO_SCALE_RULES.failedIterationCeiling}`,
    };
  }
  if (state.recentClaimCollisions >= AUTO_SCALE_RULES.claimCollisionCeiling) {
    return {
      verdict: "hold",
      reason: `contention-high: ${state.recentClaimCollisions} recent collisions >= ${AUTO_SCALE_RULES.claimCollisionCeiling}`,
    };
  }
  return {
    verdict: "spawn",
    reason: `conditions-favourable: ${state.eligibleTaskCount} eligible, ${state.currentWorkers}/${state.maxWorkers} workers, budget=${state.budgetState}, failures=${state.recentFailedIterations}, collisions=${state.recentClaimCollisions}`,
  };
}

/**
 * Reject obviously-malformed input. The caller's tests should never
 * trigger this; production wiring should pass validated state. When
 * the gate fires, `decideAutoScale` defaults to `hold` (fail-safe per
 * Saltzer & Schroeder 1975).
 */
function isValidState(state: AutoScaleState): boolean {
  return (
    Number.isFinite(state.currentWorkers) &&
    state.currentWorkers >= 1 &&
    Number.isFinite(state.maxWorkers) &&
    state.maxWorkers >= 1 &&
    Number.isFinite(state.eligibleTaskCount) &&
    state.eligibleTaskCount >= 0 &&
    Number.isFinite(state.recentFailedIterations) &&
    state.recentFailedIterations >= 0 &&
    Number.isFinite(state.recentClaimCollisions) &&
    state.recentClaimCollisions >= 0
  );
}
