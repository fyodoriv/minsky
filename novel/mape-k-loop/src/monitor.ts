/**
 * `@minsky/mape-k-loop/monitor` — Monitor phase of the MAPE-K loop
 * (Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer* 2003).
 *
 * Pure function: ingests already-parsed CI runs, spec advisories, and
 * experiment-store records; emits a single aggregate {@link HealthSnapshot}.
 * The CLI wrapper that runs `gh run list --json …`, reads
 * `spec-advisories/*.md`, and tails `experiment-store/*.jsonl` is the I/O
 * boundary (Martin, *Clean Architecture*, 2017 — pure decision module +
 * thin I/O shell).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           MAPE-K Monitor phase per Kephart-Chess 2003.
 *                            Conformance: full for the parsed-input contract
 *                            documented here; the I/O boundary lives in the
 *                            CLI wrapper that ships in sub-task 4 (`mape-k-
 *                            knowledge-and-integration`).
 *   - `monitor(...)`:        Pure decision function (Martin 2017). Conformance:
 *                            full — no I/O, no shared state, no clocks.
 *   - Aggregate-counter shape: USE method (Gregg, *Systems Performance*, 2014)
 *                            applied to the constraint-detection substrate —
 *                            per-ruleId utilisation count + first/last-seen
 *                            window. Conformance: partial (counts only; the
 *                            saturation + errors columns of USE are out of
 *                            scope for v0 — sub-task 3 adds them when Plan
 *                            consumes the snapshot).
 *
 * @module mape-k-loop/monitor
 */

/**
 * Failure on a CI run. Shape matches `gh run list --json conclusion,name,createdAt`
 * (the fields Monitor consumes). Other fields the CLI may parse are ignored
 * by the pure function — keeping the contract narrow per rule #2.
 */
export interface CiRun {
  /** Workflow / job name (e.g., "ci.yml", "experiment.yml"). */
  readonly name: string;
  /** GitHub Actions conclusion. Anything other than `success` counts as a failure signal. */
  readonly conclusion: "success" | "failure" | "cancelled" | string;
  /** ISO-8601 timestamp the run was created. */
  readonly createdAt: string;
}

/**
 * One advisory row, parsed from `spec-advisories/*.md`. The Monitor only
 * needs the rule id, a brief evidence pointer, the severity, and the
 * timestamp — enough to count and rank.
 */
export interface Advisory {
  /** Rule id the advisory cites (e.g., `rule-9`, `rule-7`, `pattern-index`). */
  readonly ruleId: string;
  /** Short human-readable evidence string (file + line / quote / etc.). */
  readonly evidence: string;
  /** Severity label as written in the advisory. */
  readonly severity: string;
  /** ISO-8601 timestamp the advisory was filed. */
  readonly createdAt: string;
}

/** Verdict emitted by the experiment-tracker daily replay. */
export type ExperimentVerdict = "validated" | "regressed" | "inconclusive";

/** One row from `experiment-store/<id>.jsonl`. */
export interface ExperimentRecord {
  /** Experiment id (the `id` field of `EXPERIMENT.yaml`). */
  readonly id: string;
  /** Replay-window verdict. */
  readonly verdict: ExperimentVerdict;
  /** Numeric value at the replay boundary. */
  readonly value: number;
  /** ISO-8601 timestamp of the replay. */
  readonly ts: string;
}

/** Per-ruleId aggregate the Analyze phase consumes. */
export interface RuleViolationStats {
  readonly ruleId: string;
  readonly violationCount: number;
  /** Earliest createdAt observed across the inputs (ISO-8601). */
  readonly firstSeen: string;
  /** Latest createdAt observed across the inputs (ISO-8601). */
  readonly lastSeen: string;
  /** Up to 3 short evidence strings (advisory evidence, CI run name). */
  readonly exemplars: readonly string[];
}

/** Aggregate of the experiment-tracker verdicts, by verdict label. */
export interface ExperimentTally {
  readonly validated: number;
  readonly regressed: number;
  readonly inconclusive: number;
}

/** Output of the Monitor phase. The Analyze phase consumes this. */
export interface HealthSnapshot {
  /** Per-rule aggregate, sorted by ruleId for determinism. */
  readonly violations: readonly RuleViolationStats[];
  /** Verdict tally across the supplied experiment records. */
  readonly experiments: ExperimentTally;
  /** Number of CI runs whose conclusion was not `success`. */
  readonly ciFailureCount: number;
  /** Total advisory count across all rule ids. */
  readonly advisoryCount: number;
  /** Skipped-input warnings — corrupt rows that were dropped (rule #7). */
  readonly warnings: readonly string[];
}

/** Inputs to the Monitor phase. */
export interface MonitorInput {
  readonly ciRuns: readonly CiRun[];
  readonly advisories: readonly Advisory[];
  readonly experimentRecords: readonly ExperimentRecord[];
}

/** Sentinel ruleId used when a CI run cannot be attributed to a specific rule. */
export const CI_RULE_ID = "ci-failure";

/**
 * Aggregate the parsed inputs into a {@link HealthSnapshot}.
 *
 * - Each non-`success` CI run contributes one violation under {@link CI_RULE_ID}.
 *   The CI workflow name is the exemplar.
 * - Each advisory contributes one violation under its `ruleId`. The advisory
 *   evidence string is the exemplar.
 * - Experiment records are tallied by verdict; corrupt rows skipped with a warning.
 * - Inputs whose required fields are missing or non-string / non-number are
 *   dropped with a `warnings` entry — graceful-degrade per rule #7.
 *
 * @otel mape-k-loop.monitor
 */
export function monitor(input: MonitorInput): HealthSnapshot {
  const warnings: string[] = [];
  const acc = new Map<string, MutableStats>();

  const ciFailureCount = ingestCiRuns(input.ciRuns, acc, warnings);
  const advisoryCount = ingestAdvisories(input.advisories, acc, warnings);
  const experiments = tallyExperiments(input.experimentRecords, warnings);

  const violations = [...acc.values()]
    .map(freezeStats)
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  return {
    violations,
    experiments,
    ciFailureCount,
    advisoryCount,
    warnings,
  };
}

// ---------- helpers (≤10 cognitive complexity each) -------------------------

interface MutableStats {
  ruleId: string;
  violationCount: number;
  firstSeen: string;
  lastSeen: string;
  exemplars: string[];
}

/**
 * Walk `runs`, accept rows shaped {@link CiRun}, and bump the
 * {@link CI_RULE_ID} bucket for each non-`success` row. Returns the count
 * of accepted CI failures.
 *
 * @otel-exempt pure helper of `monitor`; no I/O.
 */
function ingestCiRuns(
  runs: readonly CiRun[],
  acc: Map<string, MutableStats>,
  warnings: string[],
): number {
  let failures = 0;
  for (const [i, run] of runs.entries()) {
    if (!isValidCiRun(run)) {
      warnings.push(`monitor: skipping malformed ci-run at index ${i}`);
      continue;
    }
    if (run.conclusion === "success") continue;
    failures += 1;
    bumpStats(acc, CI_RULE_ID, run.createdAt, run.name);
  }
  return failures;
}

/**
 * Walk `advisories`, accept rows shaped {@link Advisory}, and bump the
 * `ruleId` bucket for each one. Returns the count of accepted advisories.
 *
 * @otel-exempt pure helper of `monitor`; no I/O.
 */
function ingestAdvisories(
  advisories: readonly Advisory[],
  acc: Map<string, MutableStats>,
  warnings: string[],
): number {
  let count = 0;
  for (const [i, a] of advisories.entries()) {
    if (!isValidAdvisory(a)) {
      warnings.push(`monitor: skipping malformed advisory at index ${i}`);
      continue;
    }
    count += 1;
    bumpStats(acc, a.ruleId, a.createdAt, a.evidence);
  }
  return count;
}

/**
 * Tally experiment-store rows by verdict; skip corrupt rows with a warning.
 *
 * @otel-exempt pure helper of `monitor`; no I/O.
 */
function tallyExperiments(
  records: readonly ExperimentRecord[],
  warnings: string[],
): ExperimentTally {
  let validated = 0;
  let regressed = 0;
  let inconclusive = 0;
  for (const [i, r] of records.entries()) {
    if (!isValidExperiment(r)) {
      warnings.push(`monitor: skipping malformed experiment-record at index ${i}`);
      continue;
    }
    if (r.verdict === "validated") validated += 1;
    else if (r.verdict === "regressed") regressed += 1;
    else inconclusive += 1;
  }
  return { validated, regressed, inconclusive };
}

/**
 * Mutate `acc` in-place: increment count, widen window, append exemplar
 * (capped at 3) for `ruleId`. Pure relative to inputs other than `acc`.
 *
 * @otel-exempt pure helper of `monitor`.
 */
function bumpStats(
  acc: Map<string, MutableStats>,
  ruleId: string,
  ts: string,
  exemplar: string,
): void {
  const cur = acc.get(ruleId);
  if (cur === undefined) {
    acc.set(ruleId, {
      ruleId,
      violationCount: 1,
      firstSeen: ts,
      lastSeen: ts,
      exemplars: [exemplar],
    });
    return;
  }
  cur.violationCount += 1;
  if (ts < cur.firstSeen) cur.firstSeen = ts;
  if (ts > cur.lastSeen) cur.lastSeen = ts;
  if (cur.exemplars.length < 3) cur.exemplars.push(exemplar);
}

/** @otel-exempt pure helper. */
function freezeStats(s: MutableStats): RuleViolationStats {
  return {
    ruleId: s.ruleId,
    violationCount: s.violationCount,
    firstSeen: s.firstSeen,
    lastSeen: s.lastSeen,
    exemplars: [...s.exemplars],
  };
}

/** @otel-exempt pure helper. */
function isValidCiRun(r: unknown): r is CiRun {
  if (r === null || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o["name"] === "string" &&
    typeof o["conclusion"] === "string" &&
    typeof o["createdAt"] === "string"
  );
}

/** @otel-exempt pure helper. */
function isValidAdvisory(a: unknown): a is Advisory {
  if (a === null || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  const ruleId = o["ruleId"];
  return (
    typeof ruleId === "string" &&
    ruleId.length > 0 &&
    typeof o["evidence"] === "string" &&
    typeof o["severity"] === "string" &&
    typeof o["createdAt"] === "string"
  );
}

/** @otel-exempt pure helper. */
function isValidExperiment(r: unknown): r is ExperimentRecord {
  if (r === null || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  const verdict = o["verdict"];
  const value = o["value"];
  return (
    typeof o["id"] === "string" &&
    (verdict === "validated" || verdict === "regressed" || verdict === "inconclusive") &&
    typeof value === "number" &&
    Number.isFinite(value) &&
    typeof o["ts"] === "string"
  );
}
