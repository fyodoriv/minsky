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
 *   3. `audit-pass-trigger` — the MAPE-K Plan-phase decision that, when the
 *      host queue empties (`pickHostTask → null`), tells the daemon to run an
 *      audit pass that authors the next batch of tasks instead of idling. Pure
 *      decision + JSONL tick-event builder; the agent spawn + event append I/O
 *      live in the daemon / `bin/minsky-run.sh`, and the coverage measurement
 *      in `scripts/audit-pass-empty-queue-coverage.mjs`.
 *   4. `worker-config` — the per-run namespace derivation that lets dozens of
 *      concurrent `minsky` processes on one machine never collide. Every
 *      mutable namespace (worktree dir, lock file, branch, launchd label,
 *      ledger path, port) is keyed by a single run-id `<repo-hash>-<pid>-<rand>`
 *      and task arbitration uses a repo+task-scoped claim key. Pure derivation;
 *      the mkdir / O_EXCL / git / launchctl I/O lives in
 *      `scripts/orchestrate.mjs` + the bash runner. Chaos measurement in
 *      `scripts/chaos-multitenant.mjs` (rule #7). Rule #6 (a namespace clash
 *      must never crash a sibling run).
 *
 * See `README.md` for the pattern conformance, failure modes, and threat model.
 */

export {
  type AuditPassDecision,
  type AuditPassDecisionReason,
  type AuditPassScope,
  type AuditPassTickEvent,
  buildAuditPassTickEvent,
  chooseAuditScope,
  DEFAULT_EMPTY_QUEUE_CADENCE,
  normalizeCadence,
  STABILITY_DEBT_VERDICTS,
  shouldTriggerAuditPass,
  type TickContext,
} from "./audit-pass-trigger.js";
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
  countDuplicates,
  countNamespaceCollisions,
  DEFAULT_BASE_PORT,
  DEFAULT_PORT_SPAN,
  deriveClaimKey,
  deriveRunId,
  deriveRunNamespace,
  fnv1a32,
  normalizeRepoPath,
  type RunNamespace,
  type RunNamespaceInput,
  repoHash,
} from "./worker-config.js";
