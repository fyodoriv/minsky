// Pattern: State Machine guard / pure transition function (Hopcroft & Ullman,
//   *Introduction to Automata Theory*, 1979) over a per-tick decision, plus the
//   MAPE-K Plan phase (Kephart & Chess 2003 — the Plan stage synthesises new
//   actions from the Analyse stage's observations). The tick loop's Analyse
//   output is "the host's queue is empty"; this module's Plan output is "run an
//   audit pass to author the next batch of tasks". Pure decision + record
//   builder; all I/O (spawning the audit-pass agent, appending the tick event
//   to the JSONL store) lives at the edge in the daemon / `bin/minsky-run.sh`.
// Source: TASKS.md `autonomous-task-authoring-between-ticks`; the operator's
//   "comes up with tasks" vision directive (author tasks BETWEEN iterations,
//   not only inside them); vision.md rule #12 (scope discipline — stability
//   work when the queue empties); rule #17 (proactive heal — scout discipline
//   authors tasks INSIDE iterations; this closes the BETWEEN-tick half); MAPE-K
//   (Kephart & Chess, *The Vision of Autonomic Computing*, IEEE Computer 2003).
// <!-- pattern: not-applicable — automaton guard + MAPE-K Plan-phase decision; pattern grounding lives in this header + the package README "Pattern conformance" section, not the vision.md index (vision.md is MAPE-K-owned and out of this task's scope) -->
//
// Note on the picker callsite: the task block named
// `novel/cross-repo-runner/src/task-finder.ts` as the `pickHostTask → null`
// instrumentation site. That TypeScript file was deleted in the Path A Phase 7
// cut (its semantics now live in `scripts/pick_task.py`, which prints the
// picked task id on stdout or an EMPTY string when the queue is empty). So this
// module deliberately does NOT depend on the picker's internals — it operates
// on the OBSERVABLE pick *result* (`pickedTaskId: string | null`). The daemon /
// bash runner maps an empty `pick_task.py` stdout to `pickedTaskId: null` and
// feeds it here. This keeps the decision pure and language-agnostic across the
// TS-deleted / Python-live boundary.

/**
 * The audit-pass policy. When the host queue empties (`pickHostTask → null`,
 * i.e. `pick_task.py` prints empty), the daemon must NOT idle waiting for the
 * operator — it runs an audit pass that authors the next batch of tasks. Two
 * scope flavours, gated by rule #12:
 *
 * - `"broad"` — the full sweep / project-audit surface (features, refactors,
 *   doc gaps, stability). Used when the host has a healthy stability posture,
 *   so proposing new feature work does not collide with rule #12.
 * - `"stability-only"` — the rule-#12-aware narrowing (the task's Pivot clause).
 *   Only audits stability surfaces — failure-mode tables, chaos coverage, MTTR,
 *   observability gaps — and never proposes new features. Used when rule #12
 *   says "ship stability when the queue empties", so a broad audit would
 *   propose feature work the next picker would (correctly) reject.
 */
export type AuditPassScope = "broad" | "stability-only";

/**
 * Why the audit pass was (or was not) triggered — the machine-readable reason
 * the daemon logs so the operator can see, in `minsky watch`, exactly why a
 * given empty-queue tick did or did not author tasks.
 */
export type AuditPassDecisionReason =
  | "queue-non-empty" // a task was picked; the loop proceeds normally — no audit
  | "cadence-not-reached" // empty queue, but the every-Nth-tick cadence hasn't elapsed
  | "empty-queue-cadence-reached"; // empty queue AND cadence elapsed — TRIGGER

/**
 * The default audit-pass cadence: on the FIRST empty-queue tick, trigger
 * immediately (latency matters — the Success threshold is idle→next-task p50
 * < 5 min, so we do not wait N empty ticks before the first audit). Thereafter,
 * re-trigger every `DEFAULT_EMPTY_QUEUE_CADENCE` consecutive empty ticks so a
 * persistently-empty host re-audits periodically rather than spinning an audit
 * on every single tick (which would burn budget against rule #15).
 */
export const DEFAULT_EMPTY_QUEUE_CADENCE = 1;

/**
 * Verdicts that count as a "non-trivially-empty repo has stability debt" signal
 * for the rule-#12 scope decision. When the recent tick history shows ANY of
 * these, the queue-empty audit narrows to `stability-only` — the host has open
 * stability concerns, so rule #12 says ship stability, not features.
 */
export const STABILITY_DEBT_VERDICTS: ReadonlySet<string> = Object.freeze(
  new Set(["spawn-failed", "scope-leak", "watchdog-kill", "flaky-test", "crash", "timeout"]),
);

/**
 * The observable input to the audit-pass decision — built by the daemon from
 * the picker result + the running empty-queue-tick counter. Pure data; no I/O.
 */
export interface TickContext {
  /**
   * The id the picker returned for this tick, or `null` when the queue is
   * empty (`pick_task.py` printed an empty line). This is the `pickHostTask →
   * null` signal the task block calls out.
   */
  readonly pickedTaskId: string | null;
  /**
   * How many CONSECUTIVE empty-queue ticks have now occurred, INCLUDING this
   * one. `1` on the first empty tick after a non-empty one. Reset to `0` by the
   * daemon whenever a task is picked.
   */
  readonly consecutiveEmptyTicks: number;
  /**
   * Recent tick verdicts on this host (most-recent-first is not required —
   * membership is all that matters). Used only to decide audit-pass SCOPE
   * (broad vs stability-only), never WHETHER to trigger.
   */
  readonly recentVerdicts?: readonly string[];
  /**
   * The every-Nth-empty-tick cadence. Defaults to
   * `DEFAULT_EMPTY_QUEUE_CADENCE`.
   */
  readonly cadence?: number;
}

/**
 * The decision the daemon acts on. When `trigger` is `true`, the daemon spawns
 * an audit-pass agent (sweep / project-audit) scoped per `scope`; when `false`,
 * the loop proceeds normally (a task was picked, or the cadence hasn't elapsed).
 */
export interface AuditPassDecision {
  readonly trigger: boolean;
  readonly reason: AuditPassDecisionReason;
  /** Only meaningful when `trigger` is `true`. */
  readonly scope: AuditPassScope;
}

/**
 * Decide whether an empty-queue tick should trigger an audit pass, and at what
 * scope. Pure — no clock read, no I/O, deterministic for a given `TickContext`.
 * This is the load-bearing decision the task block specifies: "every Nth tick
 * (or whenever `pickHostTask` returns null), the daemon invokes the audit-pass
 * equivalent".
 *
 * The cadence is `(consecutiveEmptyTicks - 1) % cadence === 0` so that the
 * FIRST empty tick always triggers (idle→audit latency = one tick), and with
 * the default cadence of 1 every empty tick triggers; a larger cadence spaces
 * re-audits out on a persistently-empty host.
 *
 * @otel tick-loop.audit-pass.should-trigger
 * @param ctx the per-tick observable context
 * @returns the trigger decision + scope
 */
export function shouldTriggerAuditPass(ctx: TickContext): AuditPassDecision {
  if (ctx.pickedTaskId !== null) {
    return {
      trigger: false,
      reason: "queue-non-empty",
      scope: chooseAuditScope(ctx.recentVerdicts),
    };
  }
  const cadence = normalizeCadence(ctx.cadence);
  const reached = ctx.consecutiveEmptyTicks >= 1 && (ctx.consecutiveEmptyTicks - 1) % cadence === 0;
  if (!reached) {
    return {
      trigger: false,
      reason: "cadence-not-reached",
      scope: chooseAuditScope(ctx.recentVerdicts),
    };
  }
  return {
    trigger: true,
    reason: "empty-queue-cadence-reached",
    scope: chooseAuditScope(ctx.recentVerdicts),
  };
}

/**
 * Choose the audit-pass scope from the recent verdicts (the rule-#12 Pivot
 * clause). If the host shows ANY stability-debt verdict, narrow to
 * `stability-only` so the audit never proposes feature work that rule #12
 * would reject when the queue empties; otherwise allow a `broad` audit.
 * Pure — membership test over a frozen set.
 *
 * @otel tick-loop.audit-pass.choose-scope
 * @param recentVerdicts recent tick verdicts on the host (may be undefined)
 * @returns the audit-pass scope
 */
export function chooseAuditScope(recentVerdicts?: readonly string[]): AuditPassScope {
  if (recentVerdicts === undefined) return "broad";
  for (const v of recentVerdicts) {
    if (STABILITY_DEBT_VERDICTS.has(v)) return "stability-only";
  }
  return "broad";
}

/**
 * Normalize a caller-supplied cadence to a positive integer, defaulting to
 * `DEFAULT_EMPTY_QUEUE_CADENCE`. A non-finite, non-positive, or non-integer
 * cadence is a programming error at the call site, but the decision must never
 * crash the daemon over it (rule #6 — stay alive); we clamp to the default and
 * let the audit-pass cadence lint surface the misconfig out-of-band.
 *
 * @otel-exempt pure arithmetic clamp — no span; called inside should-trigger which carries the span
 * @param cadence the caller-supplied cadence
 * @returns a positive-integer cadence
 */
export function normalizeCadence(cadence?: number): number {
  if (cadence === undefined) return DEFAULT_EMPTY_QUEUE_CADENCE;
  if (!Number.isFinite(cadence) || cadence < 1) return DEFAULT_EMPTY_QUEUE_CADENCE;
  return Math.floor(cadence);
}

/**
 * One per-tick event the daemon appends to the audit-pass JSONL store
 * (`.minsky/experiment-store/audit-pass/*.jsonl`). The coverage script
 * (`scripts/audit-pass-empty-queue-coverage.mjs`) reads these to compute the
 * Measurement: `empty_queue_ticks`, `audit_pass_invocations`,
 * `new_tasks_produced`, `idle_to_next_task_p50_minutes`.
 */
export interface AuditPassTickEvent {
  /** ISO-8601 timestamp of the tick. */
  readonly ts: string;
  /** Was the host queue empty on this tick? */
  readonly emptyQueue: boolean;
  /** Did this tick trigger an audit pass? */
  readonly auditPassInvoked: boolean;
  /** How many actionable tasks the audit pass authored (0 when not invoked). */
  readonly newTasksProduced: number;
  /**
   * Minutes from this empty-queue tick until the next non-empty (task-picked)
   * tick, or `null` if the host is still idle / this isn't an empty tick.
   */
  readonly idleToNextTaskMinutes: number | null;
}

/**
 * Build a single audit-pass tick event from a decision + outcome — the shape
 * the daemon appends to the JSONL store. Pure: a deterministic projection of
 * the inputs, no clock read (the caller supplies `ts`). Keeping this builder in
 * the pure core means the daemon's I/O edge only has to `JSON.stringify` +
 * append; the event shape is unit-testable in isolation.
 *
 * @otel tick-loop.audit-pass.build-tick-event
 * @param input the decision + observed outcome for one tick
 * @returns the JSONL-ready tick event
 */
export function buildAuditPassTickEvent(input: {
  readonly ts: string;
  readonly decision: AuditPassDecision;
  readonly emptyQueue: boolean;
  readonly newTasksProduced?: number;
  readonly idleToNextTaskMinutes?: number | null;
}): AuditPassTickEvent {
  return {
    ts: input.ts,
    emptyQueue: input.emptyQueue,
    auditPassInvoked: input.decision.trigger,
    newTasksProduced: input.decision.trigger ? (input.newTasksProduced ?? 0) : 0,
    idleToNextTaskMinutes: input.idleToNextTaskMinutes ?? null,
  };
}
