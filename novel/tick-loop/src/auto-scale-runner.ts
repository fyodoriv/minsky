// <!-- scope: human-approved auto-scale-workers slice 2 (operator 2026-05-07) -->

/**
 * `@minsky/tick-loop/auto-scale-runner` — I/O wrapper that feeds the pure
 * `decideAutoScale` decision (slice 1) with rolling-window counters from
 * the daemon's iteration spans, and spawns a new child via the injected
 * `spawn` callback when the verdict is `spawn`.
 *
 * Pattern conformance (rule #8):
 *   - **Strategy** (Gamma 1994) — `spawn`, `getEligibleTaskCount`,
 *     `getBudgetState`, `emit` are all injected dependencies; the
 *     production CLI wires real ones, tests inject stubs.
 *   - **Pre-registered HDD** (rule #9) — the rolling-window decay rule
 *     (halve counters every N iterations) is documented inline and
 *     exposed via `AUTO_SCALE_RUNNER_DEFAULTS` so a test can assert it.
 *   - **Visible-not-silent** (Beyer SRE 2016 Ch. 6) — every eval emits
 *     a `tick-loop.auto-scale.decision` span carrying the verdict +
 *     reason + state snapshot.
 *
 * @otel tick-loop.auto-scale.decision (one per evaluation)
 */

import {
  type AutoScaleDecision,
  type AutoScaleState,
  decideAutoScale,
} from "./auto-scale-workers.js";

/**
 * The minimal `TickSpan` subset this runner observes. Compatible with
 * the daemon's actual `TickSpan` shape; subset for ease of testing.
 */
export type ObservableEvent = {
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
};

/**
 * Spawn callback — called when `decideAutoScale` returns `spawn`. The
 * caller is responsible for the actual `child_process.spawn` and any
 * tracking of the resulting PID. The `workerId` is the next-free index
 * (0-indexed); `totalAfter` is what `--workers-total` should be set to
 * on existing + new workers.
 */
export type SpawnCallback = (input: {
  readonly workerId: number;
  readonly totalAfter: number;
}) => void;

/**
 * Optional event emitter for the auto-scale decision spans. When
 * undefined, decisions are silent.
 */
export type AutoScaleEventEmitter = (event: ObservableEvent) => void;

/**
 * Configuration knobs for the runner. All have sensible defaults.
 */
export const AUTO_SCALE_RUNNER_DEFAULTS = Object.freeze({
  /** Evaluate `decideAutoScale` every N iteration spans. */
  evalEveryNIterations: 5,
  /**
   * Halve the rolling-window counters every N iterations. Approximates
   * an exponential-decay rolling window without timestamp bookkeeping —
   * sufficient for the operator's "system stable enough?" question.
   */
  decayEveryNIterations: 10,
});

/**
 * Inputs for the runner constructor.
 */
export type AutoScaleRunnerInput = {
  /** Operator-configured ceiling (default 5; matches CLI default). */
  readonly maxWorkers: number;
  /** Worker count at startup (typically `workersTotal` from CLI args). */
  readonly initialWorkers: number;
  /**
   * Production: `() => listEligibleTasks(readFileSync(tasksMd)).length`.
   * Tests: a stub returning a synthetic number.
   */
  readonly getEligibleTaskCount: () => number;
  /**
   * Production: pulls from `BudgetGuard.lastDecision()` or equivalent.
   * Tests: a stub returning a synthetic budgetState.
   */
  readonly getBudgetState: () => AutoScaleState["budgetState"];
  /**
   * Production: forks a child via `child_process.spawn`. Tests: a stub
   * that records the call.
   */
  readonly spawn: SpawnCallback;
  /**
   * Optional span emitter. Production wires the same `emit` the
   * supervisor uses for `tick-loop.iteration` spans.
   */
  readonly emit?: AutoScaleEventEmitter;
  /**
   * Override the eval / decay cadences for testing. Defaults pulled
   * from `AUTO_SCALE_RUNNER_DEFAULTS`.
   */
  readonly evalEveryN?: number;
  readonly decayEveryN?: number;
};

/**
 * Stateful runner that observes iteration spans and drives auto-scale
 * decisions. Single-instance per supervisor process; the root daemon
 * constructs one and the bin's `emit` callback forwards to its
 * `observeEvent` method.
 *
 * @otel-exempt the inner `decideAutoScale` call emits the span; this
 *   class is the I/O wrapper.
 */
export class AutoScaleRunner {
  private currentWorkers: number;
  private readonly maxWorkers: number;
  private readonly evalEveryN: number;
  private readonly decayEveryN: number;
  private recentFailedIterations: number;
  private recentClaimCollisions: number;
  private iterationsSinceLastEval: number;
  private iterationsSinceLastDecay: number;
  private readonly getEligibleTaskCount: () => number;
  private readonly getBudgetState: () => AutoScaleState["budgetState"];
  private readonly spawn: SpawnCallback;
  private readonly emit: AutoScaleEventEmitter | undefined;
  private readonly localRoutingForced: boolean;
  private readonly localServerConcurrencyCap: number;

  constructor(input: AutoScaleRunnerInput) {
    this.maxWorkers = input.maxWorkers;
    this.currentWorkers = input.initialWorkers;
    this.evalEveryN = input.evalEveryN ?? AUTO_SCALE_RUNNER_DEFAULTS.evalEveryNIterations;
    this.decayEveryN = input.decayEveryN ?? AUTO_SCALE_RUNNER_DEFAULTS.decayEveryNIterations;
    this.recentFailedIterations = 0;
    this.recentClaimCollisions = 0;
    this.iterationsSinceLastEval = 0;
    this.iterationsSinceLastDecay = 0;
    this.getEligibleTaskCount = input.getEligibleTaskCount;
    this.getBudgetState = input.getBudgetState;
    this.spawn = input.spawn;
    this.emit = input.emit;
    // Strategy seam (rule #8): env is read once here; the pure
    // `decideAutoScale` only sees the resolved boolean + cap.
    this.localRoutingForced =
      process.env["MINSKY_LOCAL_LLM"] === "1" &&
      process.env["MINSKY_LLM_PROVIDER"] === "local-preferred";
    const rawCap = Number.parseInt(process.env["MINSKY_LOCAL_SERVER_MAX_CONCURRENT"] ?? "1", 10);
    this.localServerConcurrencyCap = Number.isFinite(rawCap) && rawCap >= 1 ? rawCap : 1;
  }

  /**
   * Feed a tick-loop span. Updates rolling counters; periodically
   * evaluates `decideAutoScale` and calls `spawn` when the verdict is
   * `spawn`.
   *
   * Two span types are observed:
   *   - `tick-loop.iteration` — drives the eval cadence and increments
   *     `recentFailedIterations` when `iteration.status === "failed"`
   *     OR when `iteration.reason` includes `collision-prevented`
   *     (which feeds `recentClaimCollisions`).
   *   - `tick-loop.pre-pr-lint-gate` — when `pre-pr-lint.verdict === "fail"`,
   *     also increments `recentFailedIterations`. Iteration status stays
   *     `"completed"` (the spawn exited 0) but the resulting PR can't
   *     open lint-clean — auto-scale treats this as instability so the
   *     supervisor doesn't compound a stuck pipeline by spawning more
   *     workers stuck on the same lint failure.
   *
   * All other span types are ignored.
   *
   * @otel-exempt this method is itself the producer of the
   *   `tick-loop.auto-scale.decision` span (emitted via the injected
   *   `emit` callback when an evaluation fires).
   */
  observeEvent(event: ObservableEvent): void {
    if (event.name === "tick-loop.pre-pr-lint-gate") {
      this.updateCountersFromPrePrLint(event.attributes);
      return;
    }
    if (event.name !== "tick-loop.iteration") return;
    this.updateCountersFromIteration(event.attributes);
    this.iterationsSinceLastEval++;
    this.iterationsSinceLastDecay++;
    this.maybeDecay();
    this.maybeEvaluate();
  }

  /**
   * Snapshot of internal state — used by tests and the supervisor's
   * banner.
   *
   * @otel-exempt pure read accessor; emits no spans.
   */
  getState(): AutoScaleState & { readonly iterationsSinceLastEval: number } {
    return {
      currentWorkers: this.currentWorkers,
      maxWorkers: this.maxWorkers,
      eligibleTaskCount: this.getEligibleTaskCount(),
      recentFailedIterations: this.recentFailedIterations,
      budgetState: this.getBudgetState(),
      recentClaimCollisions: this.recentClaimCollisions,
      localRoutingForced: this.localRoutingForced,
      localServerConcurrencyCap: this.localServerConcurrencyCap,
      iterationsSinceLastEval: this.iterationsSinceLastEval,
    };
  }

  private updateCountersFromIteration(attributes: Readonly<Record<string, unknown>>): void {
    const status = attributes["iteration.status"];
    const reason = attributes["iteration.reason"];
    if (status === "failed") this.recentFailedIterations++;
    if (typeof reason === "string" && reason.includes("collision-prevented")) {
      this.recentClaimCollisions++;
    }
  }

  /**
   * Pre-pr-lint failures count as instability. The iteration's spawn
   * exited 0 (so `iteration.status === "completed"`) but the resulting
   * branch is lint-red — claude correctly noop-exits and no PR opens.
   * Auto-scale treats this as a failed iteration so the runner doesn't
   * spawn more workers into a stuck pipeline.
   */
  private updateCountersFromPrePrLint(attributes: Readonly<Record<string, unknown>>): void {
    if (attributes["pre-pr-lint.verdict"] === "fail") {
      this.recentFailedIterations++;
    }
  }

  private maybeDecay(): void {
    if (this.iterationsSinceLastDecay < this.decayEveryN) return;
    this.recentFailedIterations = Math.floor(this.recentFailedIterations / 2);
    this.recentClaimCollisions = Math.floor(this.recentClaimCollisions / 2);
    this.iterationsSinceLastDecay = 0;
  }

  private maybeEvaluate(): void {
    if (this.iterationsSinceLastEval < this.evalEveryN) return;
    this.iterationsSinceLastEval = 0;
    const state: AutoScaleState = {
      currentWorkers: this.currentWorkers,
      maxWorkers: this.maxWorkers,
      eligibleTaskCount: this.getEligibleTaskCount(),
      recentFailedIterations: this.recentFailedIterations,
      budgetState: this.getBudgetState(),
      recentClaimCollisions: this.recentClaimCollisions,
      localRoutingForced: this.localRoutingForced,
      localServerConcurrencyCap: this.localServerConcurrencyCap,
    };
    const decision = decideAutoScale(state);
    this.emitDecision(state, decision);
    if (decision.verdict === "spawn") {
      const workerId = this.currentWorkers;
      const totalAfter = this.currentWorkers + 1;
      this.spawn({ workerId, totalAfter });
      this.currentWorkers = totalAfter;
    }
  }

  private emitDecision(state: AutoScaleState, decision: AutoScaleDecision): void {
    if (this.emit === undefined) return;
    this.emit({
      name: "tick-loop.auto-scale.decision",
      attributes: {
        verdict: decision.verdict,
        reason: decision.reason,
        "auto-scale.currentWorkers": state.currentWorkers,
        "auto-scale.maxWorkers": state.maxWorkers,
        "auto-scale.eligibleTaskCount": state.eligibleTaskCount,
        "auto-scale.recentFailedIterations": state.recentFailedIterations,
        "auto-scale.recentClaimCollisions": state.recentClaimCollisions,
        "auto-scale.budgetState": state.budgetState,
        "auto-scale.localRoutingForced": state.localRoutingForced ?? false,
        "auto-scale.localServerConcurrencyCap": state.localServerConcurrencyCap ?? 1,
      },
    });
  }
}
