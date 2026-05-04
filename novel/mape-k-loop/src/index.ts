/**
 * `@minsky/mape-k-loop` — autonomic-manager core for Minsky.
 * Reference architecture: Kephart & Chess, "The Vision of Autonomic
 * Computing", *IEEE Computer* 36(1) 2003 — the MAPE-K loop
 * (Monitor / Analyze / Plan / Execute over a Knowledge base).
 *
 * v0 ships sub-task 2/4: the M (Monitor) and A (Analyze) phases as pure
 * decision functions (Martin, *Clean Architecture*, 2017). The CLI
 * wrapper that owns I/O, the P/E phases (sustained-gain + oscillation
 * guards) and the K phase (constraints append + research.md amendment
 * proposals) ship in sub-tasks 3 and 4 — see `TASKS.md`.
 *
 * Pattern conformance row: vision.md § "Pattern conformance index" row 54
 * (`@minsky/mape-k-loop`, partial — only M+A phases here).
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
