/**
 * `@minsky/mape-k-loop` — autonomic-manager core for Minsky.
 * Reference architecture: Kephart & Chess, "The Vision of Autonomic
 * Computing", *IEEE Computer* 36(1) 2003 — the MAPE-K loop
 * (Monitor / Analyze / Plan / Execute over a Knowledge base).
 *
 * v0 ships sub-tasks 2/4 + 3/4: the M (Monitor), A (Analyze), P (Plan),
 * and E (Execute) phases as pure decision functions (Martin, *Clean
 * Architecture*, 2017), plus the two guards (sustained-gain per
 * Kohavi-Tang-Xu 2020, oscillation per Ries 2011). The CLI wrapper that
 * owns I/O and the K phase (constraints append + research.md amendment
 * proposals) ship in sub-task 4 — see `TASKS.md`.
 *
 * Pattern conformance row: vision.md § "Pattern conformance index" row 54
 * (`@minsky/mape-k-loop`, partial — M+A+P+E shipped; K + integration
 * pending sub-task 4).
 *
 * @module mape-k-loop
 */

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
