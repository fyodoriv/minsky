/**
 * `@minsky/mape-k-loop/knowledge` — Knowledge phase of the MAPE-K loop
 * (Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer* 2003).
 *
 * The Knowledge phase is the loop's append-only learning substrate (Helland,
 * "Life beyond Distributed Transactions", *CIDR* 2007 — the immutable log).
 * It does two things, both pure:
 *
 *   1. Emit a markdown block to *append* to `constraints.md` capturing the
 *      tick's hypothesis / intervention / result. The block is content-only
 *      — the I/O wrapper writes it.
 *   2. If the rule-#9 calibration drift (mean absolute error between
 *      `predicted` and `value` across the verdict log) exceeds the configured
 *      threshold, emit a proposed amendment to `research.md` § "DSPy fit"
 *      that the operator can paste into the next preparation PR.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           MAPE-K Knowledge phase per Kephart-Chess 2003
 *                            over an append-only log per Helland 2007.
 *                            Conformance: full.
 *   - `knowledge(...)`:      Pure decision function (Martin, *Clean
 *                            Architecture*, 2017). Conformance: full — no
 *                            I/O, clock injected via `now`.
 *   - Calibration check:     Rule-#9 quarterly automation layer (Munafò et
 *                            al., "A Manifesto for Reproducible Science",
 *                            *Nature Human Behaviour* 1, 0021, 2017 — the
 *                            pre-registration discipline operationalised as
 *                            mean-absolute-error over predicted-vs-observed
 *                            deltas). Conformance: full.
 *
 * @module mape-k-loop/knowledge
 */

import type { ExperimentVerdict } from "./monitor.js";

/**
 * One row of the verdict log the Knowledge phase consumes. A super-set of
 * `ExperimentRecord`: adds an optional `predicted` numeric so the calibration
 * check can compare predicted Δ vs observed Δ. The CLI wrapper aggregates
 * this from `experiment-store/<id>.jsonl` + the `EXPERIMENT.yaml` original
 * predictions.
 */
export interface VerdictLogEntry {
  /** Experiment id — the `id` field of `EXPERIMENT.yaml`. */
  readonly id: string;
  /** Replay-window verdict. */
  readonly verdict: ExperimentVerdict;
  /** Numeric value at the replay boundary (the *observed* metric). */
  readonly value: number;
  /** ISO-8601 timestamp of the replay. */
  readonly ts: string;
  /**
   * Optional pre-registered prediction (the metric value the experiment's
   * `EXPERIMENT.yaml` `success`/`pivot` block predicted). Only entries that
   * carry both `predicted` *and* `value` count toward the calibration MAE.
   */
  readonly predicted?: number;
}

/** Argument bundle for `knowledge`. */
export interface KnowledgeArgs {
  /** Append-only verdict log (most-recent last). */
  readonly verdictLog: readonly VerdictLogEntry[];
  /**
   * Calibration drift threshold (mean-absolute-error). When the log's MAE
   * exceeds this, an amendment proposal is emitted. Default
   * {@link DEFAULT_CALIBRATION_DRIFT_THRESHOLD}.
   */
  readonly calibrationDriftThreshold?: number;
  /**
   * Top-constraint ruleId the current tick targeted (or null when the
   * Analyze phase reported no constraint). Recorded in the constraints.md
   * append for the audit trail.
   */
  readonly topConstraintRuleId: string | null;
  /**
   * Decision the Execute phase reached this tick. Recorded in the append.
   */
  readonly executeDecision: "rollout" | "abstain" | "no-op";
  /**
   * Human-readable reason from Execute (or a synthetic reason when this tick
   * skipped Execute entirely — e.g., no constraint).
   */
  readonly executeReason: string;
  /**
   * Variant id rolled out (or `null` when none was). Recorded in the append.
   */
  readonly winnerVariantId: string | null;
  /**
   * Reference clock (injected for deterministic tests).
   */
  readonly now: Date;
}

/** Outcome of the Knowledge phase. */
export interface KnowledgeResult {
  /**
   * Markdown block to *append* to `constraints.md`. Always a non-empty string
   * so the audit trail records every tick (even no-ops — Helland 2007).
   */
  readonly constraintsAppend: string;
  /**
   * Proposed amendment text for `research.md` § "DSPy fit" — emitted only
   * when the calibration drift exceeds the threshold; `null` otherwise.
   */
  readonly researchMdAmendmentProposal: string | null;
  /**
   * Mean-absolute-error across the verdict log (only entries with both
   * `predicted` and `value` count). NaN-safe — `0` when the log is empty.
   */
  readonly calibrationMae: number;
  /** How many entries contributed to the MAE — useful for reporting. */
  readonly calibrationSampleSize: number;
}

/**
 * Default drift threshold. Per the brief: 50 % MAE between predicted and
 * observed. Anything above this is "the predictions are fish-stories" and
 * triggers a proposed rule-#9 amendment.
 */
export const DEFAULT_CALIBRATION_DRIFT_THRESHOLD = 0.5;

/**
 * Compute the constraints.md append + (conditionally) a research.md
 * amendment proposal for the current MAPE-K tick.
 *
 * @otel mape-k-loop.knowledge
 */
export function knowledge(args: KnowledgeArgs): KnowledgeResult {
  const threshold = args.calibrationDriftThreshold ?? DEFAULT_CALIBRATION_DRIFT_THRESHOLD;
  const cal = computeCalibration(args.verdictLog);
  const constraintsAppend = renderConstraintsAppend(args);
  const researchMdAmendmentProposal =
    cal.sampleSize > 0 && cal.mae > threshold
      ? renderResearchMdAmendment(cal.mae, threshold, cal.sampleSize)
      : null;
  return {
    constraintsAppend,
    researchMdAmendmentProposal,
    calibrationMae: cal.mae,
    calibrationSampleSize: cal.sampleSize,
  };
}

// ---------- helpers (≤10 cognitive complexity each) -------------------------

interface CalibrationStats {
  readonly mae: number;
  readonly sampleSize: number;
}

/**
 * Mean absolute error across entries where both `predicted` and `value` are
 * finite numbers. Empty / no-prediction logs return `mae: 0, sampleSize: 0`
 * — the caller treats sample-size 0 as "no signal yet" (rule #7 — graceful
 * degrade; the calibration check needs evidence to fire).
 *
 * @otel-exempt pure helper of `knowledge`.
 */
function computeCalibration(log: readonly VerdictLogEntry[]): CalibrationStats {
  let totalAbsErr = 0;
  let n = 0;
  for (const entry of log) {
    const predicted = entry.predicted;
    if (typeof predicted !== "number" || !Number.isFinite(predicted)) continue;
    if (!Number.isFinite(entry.value)) continue;
    totalAbsErr += Math.abs(predicted - entry.value);
    n += 1;
  }
  if (n === 0) return { mae: 0, sampleSize: 0 };
  return { mae: totalAbsErr / n, sampleSize: n };
}

/**
 * Render a Helland-2007 immutable-log entry for `constraints.md`.
 * Section heading is `## <ISO-8601 date>` per the brief.
 *
 * @otel-exempt pure helper of `knowledge`.
 */
function renderConstraintsAppend(args: KnowledgeArgs): string {
  const dateIso = args.now.toISOString().slice(0, 10);
  const constraint = args.topConstraintRuleId ?? "(none — no rule violations this tick)";
  const winner = args.winnerVariantId ?? "(none rolled out)";
  return [
    `## ${dateIso}`,
    "",
    `- **Top constraint**: \`${constraint}\``,
    `- **Decision**: ${args.executeDecision}`,
    `- **Winner**: \`${winner}\``,
    `- **Reason**: ${args.executeReason}`,
    "",
  ].join("\n");
}

/**
 * Compose a one-paragraph proposal block for `research.md`. The operator
 * pastes this into the next preparation PR per CLAUDE.md § "Preparation-PR
 * pattern"; nothing is auto-committed.
 *
 * @otel-exempt pure helper of `knowledge`.
 */
function renderResearchMdAmendment(mae: number, threshold: number, n: number): string {
  const maePct = (mae * 100).toFixed(1);
  const thresholdPct = (threshold * 100).toFixed(1);
  return [
    "### Calibration drift exceeded (mape-k-loop Knowledge phase)",
    "",
    `Across the last ${n} pre-registered experiments, the mean absolute error`,
    `between predicted Δ and observed Δ is ${maePct}% (threshold: ${thresholdPct}%).`,
    "Per Munafò et al. 2017 (pre-registration manifesto), this indicates either:",
    "",
    "1. Hypothesis-category miscalibration — one category (feature / refactor /",
    "   bugfix / docs) is systematically over-optimistic; group MAE by category",
    "   and re-anchor the success/pivot thresholds for the worst offender.",
    "2. Threshold drift — the predictions are stale because the underlying system",
    "   moved (token economy, model version, eval-set composition).",
    "",
    "Recommended action: open a preparation PR that adds per-category MAE to the",
    "quarterly review checklist, then a follow-up PR that adjusts the rule-#9",
    "success-threshold guidance in vision.md § 9.",
    "",
  ].join("\n");
}
