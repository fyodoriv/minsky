/**
 * `@minsky/tick-loop` — pure, unit-testable cores for the per-iteration tick
 * loop. Two concerns, both pure (no I/O), both with their I/O at the edge:
 *
 *   1. `finding-reporter` — data shapes + anonymizer for the self-reported
 *      findings a minsky installation submits back to `fyodoriv/minsky` (the
 *      `gh issue create` I/O lives in `scripts/submit-finding.mjs`). Rule #13.7
 *      (privacy by default — redact before egress).
 *   2. `gh-auth-classifier` — the decision seam that classifies a failed
 *      per-iteration `gh` / `gh api` call so a transient GitHub 401/403/429
 *      never crashes the worker daemon (rule #6 — stay alive). The `gh` spawn
 *      I/O lives in the call sites under `scripts/orchestrate.mjs` /
 *      `scripts/local-gate-merge.mjs`.
 *   3. `machine-budget-autoscaler` — the pure controller that resolves the
 *      operator's machine-utilisation budget and auto-scales worker
 *      concurrency to *match* it (vision.md rule #15). The launchd / config /
 *      env I/O lives at the edge in `bin/tick-loop.mjs`.
 *   4. `os-throttle-detect` — the pure detector that finds OS throttles
 *      contradicting the budget (launchd `Background` QoS, `Nice`, low
 *      `ulimit`, stale `MINSKY_*` caps) and renders the cross-repo
 *      propagation tasks. The host probe I/O lives at the edge.
 *
 * See `README.md` for the pattern conformance, failure modes, and threat model.
 */

export {
  type AnonymizedFinding,
  anonymizeFinding,
  containsPii,
  type FindingType,
  type RawFinding,
  REDACTION_RULES,
  REDACTION_TOKEN,
  redact,
  renderIssueBody,
  renderPreview,
} from "./finding-reporter.js";
export {
  classifyGhFailure,
  extractHttpStatus,
  GH_TRANSIENT_AUTH_FAILURE_CLASS,
  type GhCallDisposition,
  type GhFailureClassification,
  type GhFailureInput,
  PERSISTED_AUTH_FAILURE_THRESHOLD,
  RECOVERABLE_GH_STATUSES,
} from "./gh-auth-classifier.js";
export {
  type AutoscaleReason,
  type AutoscalerState,
  type BudgetInputs,
  computeWorkerTarget,
  GRIDLOCK_LOAD_MULTIPLE,
  MACHINE_BUDGET_POLICY,
  maxWorkersForBudget,
  resolveMachineBudgetPct,
  type WorkerTargetDecision,
} from "./machine-budget-autoscaler.js";
export {
  detectThrottles,
  isBudgetReachable,
  MIN_NOFILE_FOR_BUDGET,
  type MirrorRepo,
  type MirrorTask,
  renderMirrorTasks,
  type ThrottleEvidence,
  type ThrottleFinding,
  type ThrottleKind,
  TRIVIAL_BUDGET_PCT,
} from "./os-throttle-detect.js";
