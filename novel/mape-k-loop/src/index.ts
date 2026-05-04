/**
 * `@minsky/mape-k-loop` — autonomic-manager core for Minsky.
 * Reference architecture: Kephart & Chess, "The Vision of Autonomic
 * Computing", *IEEE Computer* 36(1) 2003 — the MAPE-K loop
 * (Monitor / Analyze / Plan / Execute over a Knowledge base).
 *
 * v0 ships all four MAPE phases as pure decision functions (Martin, *Clean
 * Architecture*, 2017) plus the Knowledge phase (Helland, "Life beyond
 * Distributed Transactions", *CIDR* 2007 — append-only immutable log) and
 * the two guards (sustained-gain per Kohavi-Tang-Xu 2020, oscillation per
 * Ries 2011). The `tick(...)` function below assembles one full cycle of
 * the loop; the I/O wrapper that turns its outputs into actual file writes
 * + OTEL spans is the user's responsibility (rule #2 — every dep behind an
 * interface).
 *
 * Pattern conformance row: vision.md § "Pattern conformance index" row 54
 * (`@minsky/mape-k-loop`, full — M+A+P+E+K shipped + integration test
 * passes against user-story 003).
 *
 * @module mape-k-loop
 */

import { analyze } from "./analyze.js";
import type { Analysis } from "./analyze.js";
import { execute } from "./execute.js";
import type { EvalSetInput, ExecuteResult } from "./execute.js";
import { knowledge } from "./knowledge.js";
import type { KnowledgeResult, VerdictLogEntry } from "./knowledge.js";
import { monitor } from "./monitor.js";
import type { HealthSnapshot, MonitorInput } from "./monitor.js";
import { plan } from "./plan.js";
import type { Variant } from "./plan.js";
import type { RolloutHistory } from "./sustained-gain.js";

import type { PromptOptimizer } from "@minsky/prompt-optimizer";

export {
  type Advisory,
  type CiRun,
  CI_RULE_ID,
  type ExperimentRecord,
  type ExperimentTally,
  type ExperimentVerdict,
  type HealthSnapshot,
  type MonitorInput,
  monitor,
  type RuleViolationStats,
} from "./monitor.js";

export {
  type Analysis,
  type AnalyzeArgs,
  analyze,
  type Constraint,
  type ConstraintEvidence,
  type ConstraintSeverity,
  type CostSchedule,
  costEstimate,
  DEFAULT_RULE_COST,
  SEVERITY_THRESHOLDS,
} from "./analyze.js";

export { parseCostSchedule } from "./cost-schedule.js";

export { MAX_VARIANTS_PER_PLAN, plan, type PlanArgs, type Variant } from "./plan.js";

export {
  type EvalSetInput,
  execute,
  type ExecuteArgs,
  type ExecuteDecision,
  type ExecuteResult,
  type VariantScore,
} from "./execute.js";

export {
  DEFAULT_SCORE_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
  type RolloutHistory,
  type RolloutHistoryEntry,
  sustainedGain,
  type SustainedGainArgs,
  type SustainedGainResult,
} from "./sustained-gain.js";

export {
  DEFAULT_LOOKBACK_ITERATIONS,
  oscillation,
  type OscillationArgs,
  type OscillationResult,
} from "./oscillation.js";

export {
  DEFAULT_CALIBRATION_DRIFT_THRESHOLD,
  knowledge,
  type KnowledgeArgs,
  type KnowledgeResult,
  type VerdictLogEntry,
} from "./knowledge.js";

export {
  DEFAULT_BRANCH_PREFIX,
  orchestrate,
  type OrchestrateArgs,
  type OrchestrateResult,
  type OrchestratorKnowledge,
  type RolloutDraft,
} from "./orchestrator.js";

/** Argument bundle for `tick`. The CLI wrapper assembles this from I/O. */
export interface TickArgs {
  /** Inputs to the Monitor phase (parsed CI runs / advisories / experiments). */
  readonly monitorInput: MonitorInput;
  /** Verdict log the Knowledge phase consumes (calibration drift signal). */
  readonly verdictLog: readonly VerdictLogEntry[];
  /** Append-only rollout history both Execute guards consume. */
  readonly history: RolloutHistory;
  /** Eval-set the A/B harness scores variants against. */
  readonly evalSet: readonly EvalSetInput[];
  /** Prompt optimizer (sub-task 1's adapter). Inject a Stub for tests. */
  readonly optimizer: PromptOptimizer;
  /** Async metric — higher is better. */
  readonly metric: (output: string, input: EvalSetInput) => Promise<number>;
  /** Base prompt the loop is currently running. */
  readonly basePrompt: string;
  /** Reference clock injected for deterministic tests. */
  readonly now: Date;
  /**
   * Optional per-rule cost weight schedule for the Analyze phase. Defaults
   * to the identity (every rule = 1).
   */
  readonly costs?: Readonly<Record<string, number>>;
  /**
   * Optional sustained-gain window override (days). Forwarded to Execute.
   */
  readonly sustainedGainWindowDays?: number;
  /**
   * Optional oscillation lookback override (iterations). Forwarded to Execute.
   */
  readonly oscillationLookback?: number;
  /**
   * Optional calibration drift threshold for the Knowledge phase. Defaults
   * to 0.5 (50 % MAE).
   */
  readonly calibrationDriftThreshold?: number;
  /**
   * Optional event sink. Each MAPE-K phase emits one event; the wrapper can
   * forward these to OTEL (`@minsky/observability`) or to a test recorder.
   * The integration test under `user-stories/003-…` uses this seam. The
   * sink MUST NOT throw — Knowledge fires last and the audit trail is the
   * source of truth (rule #7 — graceful degrade).
   */
  readonly emit?: (event: TickEvent) => void;
}

/**
 * One OTEL-shaped event emitted per phase per tick. The CLI wrapper
 * forwards these to `@minsky/observability` spans; the integration test
 * collects them in-memory.
 */
export interface TickEvent {
  /** Event name — `mape.<phase>.<verb>`. */
  readonly name: string;
  /** Free-form attributes; same shape as OTEL span attributes. */
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * Outcome of one MAPE-K tick. The CLI wrapper writes
 * `knowledgeWrites.constraintsAppend` to `constraints.md` and (if non-null)
 * the `researchMdAmendmentProposal` to a draft branch for human review.
 */
export interface TickResult {
  readonly snapshot: HealthSnapshot;
  readonly analysis: Analysis;
  readonly variants: readonly Variant[];
  readonly rolloutDecision: ExecuteResult | null;
  readonly knowledgeWrites: KnowledgeResult;
}

/**
 * Run one full Monitor → Analyze → Plan → Execute → Knowledge tick.
 *
 * Pure assembly: every input is data; every output is data. The function
 * never reads or writes a file. The `emit` seam is optional — when absent,
 * the function is purely deterministic over inputs. When present, it fires
 * once per phase boundary so the wrapper can carry the OTEL spans.
 *
 * Cold-start path (no constraint detected): Plan, Execute are skipped;
 * Knowledge still runs (the audit trail records the no-op tick per Helland
 * 2007 — every tick is observable).
 *
 * @otel mape-k-loop.tick
 */
export async function tick(args: TickArgs): Promise<TickResult> {
  const emit = args.emit ?? noopEmit;
  const snapshot = monitor(args.monitorInput);
  emit({ name: "mape.monitor.snapshot", attributes: snapshotAttrs(snapshot) });

  const analysis = analyze(
    args.costs === undefined ? { snapshot } : { snapshot, costs: args.costs },
  );
  emit({ name: "mape.analyze.constraint", attributes: analysisAttrs(analysis) });

  if (analysis.topConstraint === null) {
    return finishNoConstraint(args, snapshot, analysis, emit);
  }

  const variants = plan({
    topConstraint: analysis.topConstraint,
    evidence: analysis.topConstraint.evidence,
    basePrompt: args.basePrompt,
  });
  emit({ name: "mape.plan.variants", attributes: { count: variants.length } });

  const rolloutDecision = await execute(buildExecuteArgs(variants, args));
  emit({ name: "mape.execute.decision", attributes: executeAttrs(rolloutDecision) });

  const knowledgeWrites = knowledge(
    buildKnowledgeArgs(args, {
      topConstraintRuleId: analysis.topConstraint.ruleId,
      executeDecision: rolloutDecision.decision,
      executeReason: rolloutDecision.reason,
      winnerVariantId: rolloutDecision.winner?.id ?? null,
    }),
  );
  emit({ name: "mape.knowledge.write", attributes: knowledgeAttrs(knowledgeWrites) });

  return { snapshot, analysis, variants, rolloutDecision, knowledgeWrites };
}

// ---------- helpers (≤10 cognitive complexity each) -------------------------

/** @otel-exempt pure helper — default emit is a no-op. */
function noopEmit(_event: TickEvent): void {
  // Intentionally empty — `emit` is optional.
}

/** @otel-exempt pure helper of `tick`. */
function finishNoConstraint(
  args: TickArgs,
  snapshot: HealthSnapshot,
  analysis: Analysis,
  emit: (event: TickEvent) => void,
): TickResult {
  const knowledgeWrites = knowledge(
    buildKnowledgeArgs(args, {
      topConstraintRuleId: null,
      executeDecision: "no-op",
      executeReason: "analyze: no top constraint detected this tick",
      winnerVariantId: null,
    }),
  );
  emit({ name: "mape.knowledge.write", attributes: knowledgeAttrs(knowledgeWrites) });
  return {
    snapshot,
    analysis,
    variants: [],
    rolloutDecision: null,
    knowledgeWrites,
  };
}

/**
 * Build an `ExecuteArgs` value, omitting optional fields when the caller did
 * not supply them. Required because the project sets
 * `exactOptionalPropertyTypes: true` — a literal `undefined` is not the same
 * as an absent property under that flag.
 *
 * @otel-exempt pure helper of `tick`.
 */
function buildExecuteArgs(
  variants: readonly Variant[],
  args: TickArgs,
): import("./execute.js").ExecuteArgs {
  const base = {
    variants,
    evalSet: args.evalSet,
    optimizer: args.optimizer,
    metric: args.metric,
    history: args.history,
    now: args.now,
  };
  const withSg =
    args.sustainedGainWindowDays === undefined
      ? base
      : { ...base, sustainedGainWindowDays: args.sustainedGainWindowDays };
  return args.oscillationLookback === undefined
    ? withSg
    : { ...withSg, oscillationLookback: args.oscillationLookback };
}

interface KnowledgeOverlay {
  readonly topConstraintRuleId: string | null;
  readonly executeDecision: "rollout" | "abstain" | "no-op";
  readonly executeReason: string;
  readonly winnerVariantId: string | null;
}

/**
 * Build a `KnowledgeArgs` value, threading through the optional
 * `calibrationDriftThreshold` only when the caller supplied one. Required
 * because the project sets `exactOptionalPropertyTypes: true`.
 *
 * @otel-exempt pure helper of `tick`.
 */
function buildKnowledgeArgs(
  args: TickArgs,
  overlay: KnowledgeOverlay,
): import("./knowledge.js").KnowledgeArgs {
  const base = {
    verdictLog: args.verdictLog,
    topConstraintRuleId: overlay.topConstraintRuleId,
    executeDecision: overlay.executeDecision,
    executeReason: overlay.executeReason,
    winnerVariantId: overlay.winnerVariantId,
    now: args.now,
  };
  return args.calibrationDriftThreshold === undefined
    ? base
    : { ...base, calibrationDriftThreshold: args.calibrationDriftThreshold };
}

/** @otel-exempt pure helper of `tick`. */
function snapshotAttrs(snapshot: HealthSnapshot): Record<string, string | number | boolean> {
  return {
    "violations.count": snapshot.violations.length,
    "ci.failures": snapshot.ciFailureCount,
    "advisories.count": snapshot.advisoryCount,
    "warnings.count": snapshot.warnings.length,
  };
}

/** @otel-exempt pure helper of `tick`. */
function analysisAttrs(analysis: Analysis): Record<string, string | number | boolean | null> {
  return {
    "constraint.ruleId": analysis.topConstraint?.ruleId ?? null,
    "constraint.severity": analysis.severity ?? "none",
    "constraint.violationCount": analysis.evidence?.violationCount ?? 0,
  };
}

/** @otel-exempt pure helper of `tick`. */
function executeAttrs(result: ExecuteResult): Record<string, string | number | boolean | null> {
  return {
    "execute.decision": result.decision,
    "execute.winner": result.winner?.id ?? null,
    "execute.reason": result.reason,
  };
}

/** @otel-exempt pure helper of `tick`. */
function knowledgeAttrs(result: KnowledgeResult): Record<string, string | number | boolean> {
  return {
    "knowledge.calibrationMae": result.calibrationMae,
    "knowledge.calibrationSampleSize": result.calibrationSampleSize,
    "knowledge.amendmentProposed": result.researchMdAmendmentProposal !== null,
  };
}
