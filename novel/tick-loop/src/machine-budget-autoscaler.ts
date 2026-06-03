// <!-- pattern: not-applicable — the architectural pattern (closed-loop
//   effective-throughput controller: PID-shaped ratchet + saturation-knee
//   detector + gridlock circuit-breaker) is named and anchored in this
//   package's README § "machine-budget-autoscaler" rather than in vision.md,
//   following the novel/human-loop/src precedent (operator-machine-budget-autoscale
//   part (b)); vision.md is operator/MAPE-K-owned and not edited from a task. -->
/**
 * `machine-budget-autoscaler` — the pure controller half of
 * {@link https://github.com/fyodoriv/minsky | minsky}'s
 * `operator-machine-budget-autoscale` (vision.md rule #15 operationalised):
 * minsky reads ONE operator-defined machine-utilisation budget and
 * auto-scales worker concurrency to *match* it — never under-shooting
 * (idle hardware) nor over-shooting (gridlock).
 *
 * Two concerns, both pure (no I/O — the launchd / config / env reads and the
 * cross-repo task emission live at the edge in
 * [`novel/tick-loop/bin/tick-loop.mjs`](../bin/tick-loop.mjs)):
 *
 *   1. {@link resolveMachineBudgetPct} — collapse the budget-input layers
 *      (env override → config field → swarm window → policy default) into a
 *      single clamped percentage, honouring the operator's swarm ceiling.
 *   2. {@link computeWorkerTarget} — a closed-loop controller that ratchets
 *      the worker count toward the budget while *effective* throughput
 *      (active model subprocesses + PR production) rises, holds at the
 *      detected saturation knee, and backs off hard on the gridlock
 *      signature (active subprocs collapsing toward 0 while load runs away).
 *      It never trusts a nominal worker count — only the observed effective
 *      throughput, per Little's Law (throughput is capacity-bounded; past
 *      saturation, concurrency only adds contention).
 *
 * Why a closed loop and not a constant: empirically (the founding operator
 * directive) a fixed `--spawn-additional-workers` count either idles the box
 * (budget unused) or gridlocks it (20 workers → 0 useful work at runaway
 * load). A hand-tuned constant cannot track the per-host saturation knee; the
 * controller finds it.
 *
 * Pattern conformance, failure modes, threat model, and the rule-#9
 * hypothesis live in this package's README.
 */

/**
 * The operator's machine-budget policy constants. These are the contract the
 * deterministic gate `scripts/check-machine-budget.mjs` pins — a refactor
 * that drops or drifts `defaultBudgetPct` / `swarmMaxBudgetPct` fails the
 * lint, because the budget would silently stop being the contract.
 *
 * - `defaultBudgetPct: 70` — vision.md rule #15 default (founding operator
 *   directive).
 * - `swarmMaxBudgetPct: 80` — the explicit ceiling a weekly-gated swarm
 *   window may raise the budget to; never exceeded even when asked.
 * - `floorBudgetPct: 1` — a budget can be driven low (idle the box) but never
 *   to 0 (a 0% budget would mean "never run", which is `minsky daemon stop`,
 *   not a budget).
 */
export const MACHINE_BUDGET_POLICY = Object.freeze({
  defaultBudgetPct: 70,
  swarmMaxBudgetPct: 80,
  floorBudgetPct: 1,
});

/**
 * Inputs to {@link resolveMachineBudgetPct}. Every layer is optional; the
 * resolver applies the documented precedence and falls back to the policy
 * default. Strings come straight off `process.env` / the JSON config, so they
 * are parsed + validated here (NaN / out-of-range → ignored, next layer wins).
 */
export interface BudgetInputs {
  /** `MINSKY_MACHINE_BUDGET_PCT` env override (highest precedence). */
  envPct?: string | number;
  /** Persistent per-machine `~/.minsky/config.json` `machineBudgetPct` field. */
  configPct?: number;
  /** True only under the explicit weekly-gated `MINSKY_SWARM_MODE` switch. */
  swarmMode?: boolean;
}

/**
 * The autoscaler's observed state for one control step. All fields are
 * measured, not nominal — the controller deliberately ignores the worker
 * count it last *requested* and reads back what the box actually did.
 */
export interface AutoscalerState {
  /** The resolved budget percentage this step is driving toward. */
  budgetPct: number;
  /** Logical CPU count of the host (`os.cpus().length`). */
  cores: number;
  /** Active model subprocesses observed over the recent window (effective work). */
  recentActiveSubprocs: number;
  /** PRs produced over the recent window (the other half of effective throughput). */
  recentPrRate: number;
  /** 1-minute load average (`os.loadavg()[0]`). */
  loadAvg: number;
  /**
   * Recent worker targets the controller previously emitted, oldest→newest.
   * Used to detect a ramp that stopped paying off (knee) and to bound the
   * per-step step size (no doubling — ramp by ≤1 toward the budget).
   */
  lastTargets: number[];
  /**
   * The local-LLM server's single-inference concurrency cap, set ONLY when
   * the daemon is routing local-only and the backend serialises inference
   * (the default for `mlx_lm.server` and stock LM Studio — one request in
   * flight at a time). When present, the controller bounds the worker target
   * to `min(maxWorkersForBudget(...), cap)` in EVERY regime so it never ramps
   * past the point where N local-routed workers would serialise behind one
   * inference queue and divide effective throughput by N (Little's Law:
   * past the server's concurrency, more workers add only contention).
   *
   * Default semantics live at the edge (the launchd/config read), not here:
   * `1` for mlx/LM-Studio, operator-overridable upward for a concurrent
   * backend (vLLM/sglang). `undefined` ⇒ the cap is inactive (cloud routing
   * or a concurrent backend) and the controller free-runs to the budget
   * ceiling exactly as before.
   */
  localServerConcurrencyCap?: number;
}

/** Why the controller chose the target it did — surfaced to the daemon log. */
export type AutoscaleReason = "ramp-up" | "knee-hold" | "gridlock-backoff" | "at-budget";

/** The controller's decision for one step. */
export interface WorkerTargetDecision {
  /** The worker concurrency to run next step. Always ≥1. */
  target: number;
  /** Which control regime produced {@link target}. */
  reason: AutoscaleReason;
}

/**
 * The load-average multiple of `cores` at or above which the box is treated as
 * saturated regardless of subprocess count. `loadAvg ≥ cores × this` with
 * effective throughput collapsing is the gridlock signature. Anchored to the
 * empirical 10-core observation (useful work at load ~37, gridlock at load
 * ~61 → ~6× cores), with headroom set conservatively at 4×.
 */
export const GRIDLOCK_LOAD_MULTIPLE = 4;

/**
 * Resolve the single machine-budget percentage from the layered inputs.
 *
 * Precedence (highest first): env override → config field → policy default.
 * The swarm window raises the *effective ceiling* from 100 to
 * {@link MACHINE_BUDGET_POLICY.swarmMaxBudgetPct} only when `swarmMode` is
 * set; outside swarm mode the budget is still clamped to `[floor, 100]` but a
 * value above the swarm ceiling is honoured (the operator asked for it
 * explicitly), whereas inside swarm mode anything above the ceiling is capped
 * — the swarm switch is a *bound*, not a target. The default (70) is returned
 * when no layer supplies a valid value.
 *
 * @otel machine-budget.resolve-budget
 * @param inputs the layered budget inputs (env / config / swarm flag)
 * @returns a clamped budget percentage in `[floorBudgetPct, 100]`
 */
export function resolveMachineBudgetPct(inputs: BudgetInputs = {}): number {
  const ceiling = inputs.swarmMode ? MACHINE_BUDGET_POLICY.swarmMaxBudgetPct : 100;
  const fromEnv = parsePct(inputs.envPct);
  const fromConfig = parsePct(inputs.configPct);
  const chosen = fromEnv ?? fromConfig ?? MACHINE_BUDGET_POLICY.defaultBudgetPct;
  return clamp(chosen, MACHINE_BUDGET_POLICY.floorBudgetPct, ceiling);
}

/**
 * Compute the next worker-concurrency target from the observed state.
 *
 * The controller has three regimes (rule #9 pre-registered, each with a paired
 * test suite the gate pins):
 *
 *   - **ramp-up** — utilisation below budget AND effective throughput still
 *     rising ⇒ increase the target by 1 (a single step — no doubling, to
 *     avoid overshoot oscillation per the Pivot clause).
 *   - **knee-hold** — utilisation at/near budget, OR a prior ramp stopped
 *     raising effective throughput (the saturation knee) ⇒ hold the current
 *     target.
 *   - **gridlock-backoff** — the gridlock signature (load ≥ `cores ×
 *     {@link GRIDLOCK_LOAD_MULTIPLE}` AND active subprocs collapsing toward 0)
 *     ⇒ halve the target immediately (circuit-break) regardless of nominal
 *     count.
 *
 * The target is bounded to `[1, maxForBudget(cores, budgetPct)]` — the budget
 * sets the ceiling (e.g. 70% of 10 cores ≈ 7 concurrent workers as the upper
 * bound the ramp may reach). When {@link AutoscalerState.localServerConcurrencyCap}
 * is set (local-only routing against a single-inference backend) the ceiling
 * is lowered further to `min(maxForBudget(...), cap)`, so the controller never
 * ramps past the local server's concurrency in ANY regime — ramp-up holds at
 * the cap, knee-hold/at-budget never read a higher prior target through, and
 * gridlock-backoff still halves but within the capped ceiling.
 *
 * @otel machine-budget.compute-worker-target
 * @param state the observed autoscaler state for this control step
 * @returns the next worker target plus the regime that produced it
 */
export function computeWorkerTarget(state: AutoscalerState): WorkerTargetDecision {
  const max = boundWorkerCeiling(state);
  const current = state.lastTargets.at(-1) ?? 1;

  // Gridlock circuit-breaker takes precedence over everything — a box that
  // has collapsed must shed load NOW, not after the next ramp decision.
  if (isGridlocked(state)) {
    return { target: clamp(Math.floor(current / 2), 1, max), reason: "gridlock-backoff" };
  }

  const utilisation = utilisationPct(state.loadAvg, state.cores);
  const belowBudget = utilisation < state.budgetPct;

  // Knee detection: a prior ramp that did not raise effective throughput means
  // we've hit the saturation knee — hold even if utilisation reads below
  // budget (load can read low while work is starved).
  if (belowBudget && current < max && effectiveThroughputRising(state)) {
    return { target: clamp(current + 1, 1, max), reason: "ramp-up" };
  }
  if (current >= max || !belowBudget) {
    return { target: clamp(current, 1, max), reason: "at-budget" };
  }
  return { target: clamp(current, 1, max), reason: "knee-hold" };
}

/**
 * The upper bound on concurrent workers a given budget permits on a box: the
 * budget fraction of the core count, floored, at least 1. (70% of 10 cores → 7.)
 *
 * @otel-exempt pure-function — arithmetic helper; caller's span covers it.
 * @param cores logical CPU count
 * @param budgetPct resolved budget percentage
 * @returns the worker-count ceiling for this budget, ≥1
 */
export function maxWorkersForBudget(cores: number, budgetPct: number): number {
  const ceiling = Math.floor((cores * budgetPct) / 100);
  return Math.max(1, ceiling);
}

/**
 * The effective worker-count ceiling for one control step: the budget ceiling
 * from {@link maxWorkersForBudget}, lowered to the local-server concurrency cap
 * when one is set on the state. The cap is itself floored at 1 (a cap of 0 or a
 * negative is treated as 1 — "never run" is `minsky daemon stop`, not a cap),
 * so the result is always ≥1. With no cap (cloud routing or a concurrent
 * backend) the budget ceiling is returned unchanged.
 *
 * @otel-exempt pure-function — arithmetic helper; caller's span covers it.
 * @param state the observed autoscaler state for this control step
 * @returns the worker-count ceiling honouring both the budget and the cap, ≥1
 */
export function boundWorkerCeiling(state: AutoscalerState): number {
  const budgetMax = maxWorkersForBudget(state.cores, state.budgetPct);
  const cap = state.localServerConcurrencyCap;
  if (cap === undefined || !Number.isFinite(cap)) return budgetMax;
  return Math.min(budgetMax, Math.max(1, Math.floor(cap)));
}

/**
 * Observed CPU utilisation as a percentage of capacity (`loadAvg / cores`).
 *
 * @otel-exempt pure-function — arithmetic helper; caller's span covers it.
 * @param loadAvg 1-minute load average
 * @param cores logical CPU count
 * @returns utilisation percentage (may exceed 100 when over-saturated)
 */
function utilisationPct(loadAvg: number, cores: number): number {
  if (cores <= 0) return 0;
  return (loadAvg / cores) * 100;
}

/**
 * Has effective throughput risen across the recent control window? "Effective"
 * = active model subprocesses doing real work + PRs produced, never the
 * nominal worker count. With no history (cold start) the answer is "yes" so
 * the ramp can begin.
 *
 * @otel-exempt pure-function — internal predicate; caller's span covers it.
 * @param state the observed autoscaler state
 * @returns true when adding workers is still paying off
 */
function effectiveThroughputRising(state: AutoscalerState): boolean {
  const effective = state.recentActiveSubprocs + state.recentPrRate;
  const lastTarget = state.lastTargets.at(-1) ?? 0;
  // The ramp is paying off when observed effective work is at least keeping
  // pace with the workers we asked for (a target we asked for but that
  // produced no active subprocs is the saturation knee — stop ramping).
  return effective >= lastTarget;
}

/**
 * The gridlock signature: the box is over-saturated by load AND effective work
 * has collapsed toward zero. Either alone is not gridlock (high load with high
 * useful throughput is the *goal*; low subprocs at low load is just idle).
 *
 * @otel-exempt pure-function — internal predicate; caller's span covers it.
 * @param state the observed autoscaler state
 * @returns true when the controller must circuit-break and shed workers
 */
function isGridlocked(state: AutoscalerState): boolean {
  const overSaturated = state.loadAvg >= state.cores * GRIDLOCK_LOAD_MULTIPLE;
  const workCollapsed = state.recentActiveSubprocs <= 1 && state.recentPrRate <= 0;
  return overSaturated && workCollapsed;
}

/**
 * Parse + validate a percentage from an env/config value. Returns `null` for
 * anything that isn't a finite number in `[0, 100]` so the next precedence
 * layer wins (fail-safe default — a garbage env var never poisons the budget).
 *
 * @otel-exempt pure-function — parser helper; caller's span covers it.
 * @param value the raw env/config value (string | number | undefined)
 * @returns a validated percentage, or `null` when invalid/absent
 */
function parsePct(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

/**
 * Clamp `n` to `[lo, hi]`.
 *
 * @otel-exempt pure-function — arithmetic helper; caller's span covers it.
 * @param n the value to clamp
 * @param lo lower bound (inclusive)
 * @param hi upper bound (inclusive)
 * @returns the clamped value
 */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
