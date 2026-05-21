// <!-- scope: human-approved operator-machine-budget-autoscale slice 1 (operator 2026-05-17) -->

/**
 * `@minsky/tick-loop/machine-budget-autoscaler` — pure controller for the
 * operator directive 2026-05-17 / vision.md rule #15: "match the operator's
 * machine-utilisation budget — no more, no less".
 *
 * The operator declares a single number — the fraction of their machine
 * Minsky may use (default 70 %, raised to ≤80 % only under the explicit,
 * weekly-gated swarm switch). This module turns that number, plus live
 * effective-throughput feedback, into a *worker target*: the concurrency
 * the supervisor should converge toward.
 *
 * Two pure functions, no I/O — slice 1 of N. A later slice wires
 * `computeWorkerTarget` into `bin/tick-loop.mjs` (replacing the fixed
 * `--spawn-additional-workers` constant) and adds the OS-throttle
 * detector + `scripts/check-machine-budget.mjs` rule-#10 gate.
 *
 * Pattern conformance (rule #8):
 *   - **Strategy** (Gamma 1994) — `computeWorkerTarget` is the seam; the
 *     daemon injects live counters, tests inject synthetic snapshots.
 *   - **Pre-registered HDD** (rule #9) — every decision branch is keyed
 *     by a frozen constant in `MACHINE_BUDGET_RULES`; the operator can
 *     read the constant and predict the controller's output for any
 *     machine state. The three pre-registered behaviours — ramp-up,
 *     knee-hold, gridlock-backoff — each have a paired test.
 *   - **Fail-safe defaults** (Saltzer & Schroeder 1975) — out-of-range
 *     or non-finite input holds at the last known target (never ramps
 *     into an unknown state); a missing/garbage budget falls back to
 *     the conservative 70 % default, never to "unbounded".
 *   - **Little's Law / queueing theory** — past the saturation knee,
 *     extra concurrency only adds contention (the empirical 20→0
 *     gridlock on a 10-core box). The controller never trusts a nominal
 *     worker count; it ratchets toward the budget while *effective*
 *     throughput rises and backs off on the gridlock signature
 *     (active model subprocesses collapsing toward 0 with load runaway).
 *
 * @otel-exempt pure controller; the caller (bin wiring, later slice)
 *   emits the `tick-loop.machine-budget.target` span with the verdict.
 */

/**
 * Operator-budget resolution result. `pct` is the effective, clamped
 * budget the autoscaler should target; `swarm` records whether the
 * weekly-gated swarm switch lifted the cap; `clamped` is true when the
 * raw env value was out of range or above the policy ceiling and had to
 * be corrected (the caller logs this — visible-not-silent, rule #6).
 */
export type ResolvedBudget = {
  /** Effective machine-utilisation budget, integer percent in [1, 80]. */
  readonly pct: number;
  /** True when `MINSKY_SWARM_MODE` lifted the cap from 70 to ≤80. */
  readonly swarm: boolean;
  /** Raw `MINSKY_MACHINE_BUDGET_PCT` string (or undefined). */
  readonly raw: string | undefined;
  /** True when the raw value was corrected (out of range / over cap). */
  readonly clamped: boolean;
};

/**
 * Pre-registered budget-policy constants (rule #9 — the constant IS the
 * spec; a paired test asserts each boundary).
 */
export const MACHINE_BUDGET_POLICY = Object.freeze({
  /** Default machine-utilisation budget when the env is unset/garbage. */
  defaultBudgetPct: 70,
  /**
   * Hard ceiling under the weekly-gated swarm switch. The operator's
   * stated maximum (directive 2026-05-17 — "allow workers ~80 % during
   * swarm"). Non-swarm requests above `defaultBudgetPct` are clamped
   * back to it: exceeding the default requires the explicit switch.
   */
  swarmMaxBudgetPct: 80,
});

/**
 * Resolve the operator's machine-utilisation budget from the
 * environment.
 *
 *   - Unset / non-finite / ≤0 / >100 → `defaultBudgetPct` (fail-safe;
 *     a garbage budget never means "unbounded").
 *   - `MINSKY_SWARM_MODE` ∈ {"1","true"} → swarm; the request may rise
 *     up to `swarmMaxBudgetPct` (clamped there if higher).
 *   - Not swarm and request > `defaultBudgetPct` → clamped down to
 *     `defaultBudgetPct` (exceeding the default needs the swarm switch).
 *
 * Composes `MINSKY_SWARM_MODE` from
 * [[native-agent-teams-with-tiered-adapter]] (the swarm tier is what
 * lifts the budget; this resolver is the single enforcement point).
 *
 * @otel-exempt pure resolver; the caller logs the resolved value.
 */
export function resolveMachineBudgetPct(
  env: Readonly<Record<string, string | undefined>>,
): ResolvedBudget {
  const raw = env["MINSKY_MACHINE_BUDGET_PCT"];
  const swarm = env["MINSKY_SWARM_MODE"] === "1" || env["MINSKY_SWARM_MODE"] === "true";
  const ceiling = swarm
    ? MACHINE_BUDGET_POLICY.swarmMaxBudgetPct
    : MACHINE_BUDGET_POLICY.defaultBudgetPct;

  const parsed = raw === undefined || raw === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    // Fail-safe: garbage budget → conservative default, flagged clamped
    // only when the operator actually supplied something we rejected.
    return {
      pct: Math.min(MACHINE_BUDGET_POLICY.defaultBudgetPct, ceiling),
      swarm,
      raw,
      clamped: raw !== undefined && raw !== "",
    };
  }

  const requested = Math.round(parsed);
  const pct = Math.min(requested, ceiling);
  return { pct, swarm, raw, clamped: pct !== requested };
}

/**
 * Live machine snapshot the controller turns into a worker target. All
 * fields are operator-observable; none require new I/O surfaces beyond
 * what the daemon already collects.
 */
export type MachineBudgetState = {
  /** Resolved budget percent in [1, 80] (from `resolveMachineBudgetPct`). */
  readonly budgetPct: number;
  /** Logical CPU count (`os.cpus().length`). Must be ≥1. */
  readonly cores: number;
  /**
   * Count of *active* model subprocesses recently (Opus/Sonnet/local
   * `claude --print`/aider children actually running). This is the
   * effective-utilisation proxy — a nominal worker that is stuck
   * waiting does NOT count, which is exactly why a fixed worker
   * constant cannot track the knee.
   */
  readonly recentActiveSubprocs: number;
  /** PRs produced in the recent rolling window (effective throughput). */
  readonly recentPrRate: number;
  /** 1-minute load average (`os.loadavg()[0]`). Must be ≥0. */
  readonly loadAvg: number;
  /**
   * History of recent worker targets, newest last. `[]` (or all
   * non-finite) → cold start. The controller reads the last two valid
   * entries to detect "we just ramped and it wasn't absorbed".
   */
  readonly lastTargets: readonly number[];
};

/** Controller verdict. `target` is always ≥1; `reason` is structured. */
export type WorkerTargetDecision = {
  /** Worker count the supervisor should converge toward (≥1). */
  readonly target: number;
  /** Structured reason, prefixed with the action tag. */
  readonly reason: string;
};

/**
 * Pre-registered controller constants. Each is anchored to the live
 * empirical evidence in the task block (10-core box: 4≈ok, 10
 * saturates usefully at load ~37, 14 stalls, 20 gridlocks to zero at
 * load ~61). A paired test asserts each boundary (rule #9).
 */
export const MACHINE_BUDGET_RULES = Object.freeze({
  /**
   * `loadAvg > cores * this` is the load-runaway half of the gridlock
   * signature. Evidence: useful at load ~3.7×cores, gridlocked at
   * ~6.1×cores → the runaway line sits at 5×.
   */
  gridlockLoadMultiplier: 5,
  /**
   * `recentActiveSubprocs < prevTarget * this` is the
   * active-collapse half of the gridlock signature (20 nominal
   * workers, ~0 actually running model subprocesses).
   */
  gridlockActiveFraction: 0.25,
  /** On gridlock, multiply the previous target by this (hard backoff). */
  gridlockBackoffFactor: 0.5,
  /**
   * `recentActiveSubprocs ≥ prevTarget * this` ⇒ the box is absorbing
   * the current concurrency usefully → safe to ramp by one.
   */
  healthyActiveFraction: 0.6,
  /** Additive ramp step when conditions are favourable. */
  rampStep: 1,
  /**
   * Absolute hard ceiling = `floor(budgetPct/100 * cores * this)`. The
   * 1.4 oversubscribe factor lets the controller ramp past the naive
   * proportional figure to find the empirical knee while still capping
   * a 10-core box at 14 even at budget 100 — never the 20 that
   * gridlocked. Budget-modulated: budget 70 → ceil ~9, budget 80 → ~11.
   */
  maxOversubscribeFactor: 1.4,
});

/**
 * Compute the worker target for the current machine state.
 *
 * Decision rules in priority order — earlier rules short-circuit:
 *
 *   1. Invalid state → hold at the last valid target (fail-safe).
 *   2. Cold start (no valid history) → naive proportional target
 *      `round(budgetPct/100 * cores)`, clamped to the hard ceiling.
 *   3. Gridlock-backoff — load runaway AND active subprocs collapsed →
 *      `floor(prevTarget * gridlockBackoffFactor)`.
 *   4. Knee step-back — we just ramped (history rose) but the last
 *      ramp was not absorbed (active subprocs below the healthy
 *      fraction) → `prevTarget - 1` (the knee is just below here).
 *   5. Knee-hold — already at/above the budget-derived hard ceiling →
 *      hold (the budget itself defines the knee).
 *   6. Ramp-up — concurrency is being absorbed, load is sane, and
 *      there is ceiling headroom → `prevTarget + rampStep`.
 *   7. Otherwise → hold at the previous target.
 *
 * @otel-exempt pure controller; instrumentation lives in the caller.
 */
export function computeWorkerTarget(state: MachineBudgetState): WorkerTargetDecision {
  const validHistory = state.lastTargets.filter((t) => Number.isFinite(t) && t >= 1);
  const prevTarget = validHistory.at(-1);

  if (!isValidState(state)) return invalidStateHold(prevTarget);

  const hardCeiling = Math.max(
    1,
    Math.floor((state.budgetPct / 100) * state.cores * MACHINE_BUDGET_RULES.maxOversubscribeFactor),
  );

  if (prevTarget === undefined) return coldStart(state, hardCeiling);

  // Rule chain in priority order; each rule returns its decision or
  // `null` to defer to the next. The final `holdRule` never returns
  // null, so the chain is total (Saltzer & Schroeder fail-safe).
  return (
    gridlockRule(state, prevTarget) ??
    kneeStepBackRule(state, prevTarget, validHistory) ??
    kneeHoldRule(state, prevTarget, hardCeiling) ??
    rampUpRule(state, prevTarget, hardCeiling) ??
    holdRule(state, prevTarget)
  );
}

/** Rule 1 — invalid input → hold at the last valid target (fail-safe). */
function invalidStateHold(prevTarget: number | undefined): WorkerTargetDecision {
  const fallback = Math.max(1, prevTarget !== undefined ? Math.floor(prevTarget) : 1);
  return {
    target: fallback,
    reason: `invalid-state-hold: input out of range or non-finite; holding at ${fallback}`,
  };
}

/** Rule 2 — no valid history → naive proportional target. */
function coldStart(state: MachineBudgetState, hardCeiling: number): WorkerTargetDecision {
  const cold = Math.min(
    hardCeiling,
    Math.max(1, Math.round((state.budgetPct / 100) * state.cores)),
  );
  return {
    target: cold,
    reason: `cold-start: budget=${state.budgetPct}% cores=${state.cores} → target=${cold} (ceiling=${hardCeiling})`,
  };
}

/** Rule 3 — load runaway AND active subprocs collapsed → hard backoff. */
function gridlockRule(state: MachineBudgetState, prevTarget: number): WorkerTargetDecision | null {
  const loadRunaway = state.loadAvg > state.cores * MACHINE_BUDGET_RULES.gridlockLoadMultiplier;
  const activeCollapsed =
    state.recentActiveSubprocs < prevTarget * MACHINE_BUDGET_RULES.gridlockActiveFraction;
  if (!loadRunaway || !activeCollapsed) return null;
  const backoff = Math.max(1, Math.floor(prevTarget * MACHINE_BUDGET_RULES.gridlockBackoffFactor));
  return {
    target: backoff,
    reason: `gridlock-backoff: loadAvg=${state.loadAvg} > ${state.cores}×${MACHINE_BUDGET_RULES.gridlockLoadMultiplier} and activeSubprocs=${state.recentActiveSubprocs} < ${prevTarget}×${MACHINE_BUDGET_RULES.gridlockActiveFraction} → ${prevTarget}→${backoff}`,
  };
}

/** Rule 4 — we just ramped but it was not absorbed → step back one. */
function kneeStepBackRule(
  state: MachineBudgetState,
  prevTarget: number,
  validHistory: readonly number[],
): WorkerTargetDecision | null {
  const justRamped =
    validHistory.length >= 2 && (validHistory.at(-1) as number) > (validHistory.at(-2) as number);
  if (!justRamped || isAbsorbed(state, prevTarget)) return null;
  const stepBack = Math.max(1, prevTarget - 1);
  return {
    target: stepBack,
    reason: `knee-step-back: ramped to ${prevTarget} but activeSubprocs=${state.recentActiveSubprocs} < ${prevTarget}×${MACHINE_BUDGET_RULES.healthyActiveFraction} (not absorbed) → ${stepBack}`,
  };
}

/** Rule 5 — already at/above the budget-derived ceiling → hold there. */
function kneeHoldRule(
  state: MachineBudgetState,
  prevTarget: number,
  hardCeiling: number,
): WorkerTargetDecision | null {
  if (prevTarget < hardCeiling) return null;
  return {
    target: hardCeiling,
    reason: `knee-hold: prevTarget=${prevTarget} ≥ budget-ceiling=${hardCeiling} (budget=${state.budgetPct}% cores=${state.cores}) — holding at the budget knee`,
  };
}

/** Rule 6 — concurrency absorbed, load sane, ceiling headroom → ramp. */
function rampUpRule(
  state: MachineBudgetState,
  prevTarget: number,
  hardCeiling: number,
): WorkerTargetDecision | null {
  const loadRunaway = state.loadAvg > state.cores * MACHINE_BUDGET_RULES.gridlockLoadMultiplier;
  if (!isAbsorbed(state, prevTarget) || loadRunaway) return null;
  const ramped = Math.min(hardCeiling, prevTarget + MACHINE_BUDGET_RULES.rampStep);
  return {
    target: ramped,
    reason: `ramp-up: activeSubprocs=${state.recentActiveSubprocs} ≥ ${prevTarget}×${MACHINE_BUDGET_RULES.healthyActiveFraction}, load sane, headroom → ${prevTarget}→${ramped} (ceiling=${hardCeiling}, prRate=${state.recentPrRate})`,
  };
}

/** Rule 7 — no trigger fired → hold at the previous target (total). */
function holdRule(state: MachineBudgetState, prevTarget: number): WorkerTargetDecision {
  return {
    target: prevTarget,
    reason: `hold: activeSubprocs=${state.recentActiveSubprocs} vs prevTarget=${prevTarget}, loadAvg=${state.loadAvg} — no ramp/backoff trigger, holding`,
  };
}

/**
 * The box is absorbing the current concurrency usefully — active model
 * subprocesses are tracking the worker target (not a stuck nominal
 * count). Shared by the step-back and ramp-up rules.
 */
function isAbsorbed(state: MachineBudgetState, prevTarget: number): boolean {
  return state.recentActiveSubprocs >= prevTarget * MACHINE_BUDGET_RULES.healthyActiveFraction;
}

/**
 * Reject obviously-malformed input. Production wiring should pass
 * validated state; when the gate fires the controller holds at the
 * last target (fail-safe per Saltzer & Schroeder 1975).
 */
function isValidState(state: MachineBudgetState): boolean {
  return (
    Number.isFinite(state.budgetPct) &&
    state.budgetPct >= 1 &&
    state.budgetPct <= 100 &&
    Number.isFinite(state.cores) &&
    state.cores >= 1 &&
    Number.isFinite(state.recentActiveSubprocs) &&
    state.recentActiveSubprocs >= 0 &&
    Number.isFinite(state.recentPrRate) &&
    state.recentPrRate >= 0 &&
    Number.isFinite(state.loadAvg) &&
    state.loadAvg >= 0
  );
}
