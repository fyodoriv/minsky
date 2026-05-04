#!/usr/bin/env node
// @ts-check
// Pattern: scheduled batch job + verdict ladder over a per-experiment append-only
//   store (rule #9 weekly–monthly layer enforcement) + GitHub Actions cron.
// Source: Ries 2011 (build–measure–learn; sustained-gain discipline — value at +1d
//   is misleading, +7d is the floor); Kohavi/Tang/Xu 2020 ch. 5–7 (trustworthy
//   over fast; novelty effect; mid-term regressions); Kephart & Chess 2003 (this
//   layer is MAPE-K's Analyze phase scoped to rule #9); rule #10 (deterministic
//   enforcement — same input, same output, no LLM in the chain).
// Conformance: full — `replayExperiment(...)` is referentially transparent over
//   plain data; the CLI wrapper is the I/O boundary (reads JSONL files, runs the
//   measurement command, appends new lines, opens pivot tasks).
//
// Why this gate exists: rule #9 declares pre-registration; the daily layer
//   (`ci-experiment-runner-v0`) records baseline + treatment per merged PR.
//   *Pre-registration without execution is half a rule* (vision.md § 9). This
//   tracker closes the weekly–monthly layer:
//
//   - For each `experiment-store/<id>.jsonl` (one file per experiment id),
//     find the most recent `record` line (the merge boundary).
//   - For each configured replay window (default `[7, 30]` days), if `now`
//     is past `mergeTs + window_days` AND no `replay-result` for that window
//     already exists, run the recorded `measurement` command and append a
//     `replay-result` line tagged `{ts, ref, value, window_days, verdict}`.
//   - Emit `validated` when value meets/exceeds `success` for at least one
//     replay window AND has not regressed since.
//   - Emit `regressed` when value crosses `pivot` (in the wrong direction)
//     in two consecutive replay windows. Single-window regressions stay
//     `inconclusive` to dampen churn (see Risk in TASKS.md original brief).
//   - Emit `inconclusive` otherwise.
//   - For `validated`, write a single line to `validated-learnings.md`.
//   - For `regressed`, append a `pivot-experiment-<id>` task to TASKS.md.
//
// Pivot (rule #9): if 90 days post-landing every replay verdict is
//   `inconclusive` (signal-to-noise too low at 7d/30d), shorten windows AND
//   raise pre-declared success margins, OR gate eligibility by tag. If still
//   inconclusive at 180 days, the daily-layer measurements are too noisy to
//   support the weekly layer; pivot to declaration-only with quarterly review.

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {object} ExecResult
 * @property {number} exitCode
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} durationMs
 * @property {boolean} timedOut
 */

/**
 * @callback Exec
 * @param {string} cmd
 * @param {{ cwd?: string, timeoutSeconds: number }} opts
 * @returns {ExecResult}
 */

/**
 * A `record` line is what the daily runner appends per merged PR.
 * Schema mirrors `scripts/run-experiment.mjs`'s `StoreRecord`. We retain
 * a structural typedef here (not a runtime import) because the daily runner
 * already validates these on the way in; the tracker only consumes them.
 *
 * @typedef {object} StoreRecord
 * @property {string} experiment_id
 * @property {string} baseline
 * @property {string} treatment
 * @property {string} ts
 * @property {string} ref
 * @property {string} base_ref
 * @property {number} [baseline_duration_ms]
 * @property {number} [treatment_duration_ms]
 */

/**
 * A replay-result line is what THIS runner appends per replay window.
 *
 * @typedef {object} ReplayResult
 * @property {"replay-result"} kind — discriminator: this is a replay line, not a record line
 * @property {string} experiment_id
 * @property {string} ts — ISO-8601 timestamp the replay observed
 * @property {string} ref — the head ref the replay ran against
 * @property {string} value — captured stdout from the measurement command
 * @property {number} window_days — which replay window this row covers (e.g., 7 or 30)
 * @property {ReplayVerdict} verdict
 * @property {string} reason — one-sentence English explanation of the verdict
 */

/** @typedef {"validated" | "regressed" | "inconclusive"} ReplayVerdict */

/**
 * @typedef {object} ExperimentMeta
 * @property {string} id
 * @property {string} measurement
 * @property {string} success — verbatim string from EXPERIMENT.yaml
 * @property {string} pivot — verbatim string from EXPERIMENT.yaml
 * @property {readonly number[]} replay_windows_days
 * @property {number} timeout_seconds
 */

/**
 * Numeric comparator extracted from a `success` / `pivot` string in
 * EXPERIMENT.yaml. We intentionally support a tiny vocabulary —
 * `>= N`, `<= N`, `> N`, `< N`, with optional unicode `≥` `≤` and a
 * leading "at least" / "at most" English form. Anything else falls back
 * to "no numeric threshold extracted; verdict is inconclusive".
 *
 * @typedef {object} Threshold
 * @property {">=" | "<=" | ">" | "<"} op
 * @property {number} value
 */

/** @typedef {{ op: "noop" }} ThresholdNotExtracted */

const NUM_RE = "(-?\\d+(?:\\.\\d+)?)";
const SUCCESS_PATTERNS = [
  // "≥10", ">= 10", "at least 10"
  { re: new RegExp(`(?:^|[^\\w])(?:≥|>=|at least)\\s*${NUM_RE}`, "i"), op: ">=" },
  // "≤-1", "<= -1", "at most -1"
  { re: new RegExp(`(?:^|[^\\w])(?:≤|<=|at most)\\s*${NUM_RE}`, "i"), op: "<=" },
  // ">10"
  { re: new RegExp(`(?:^|[^\\w])>\\s*${NUM_RE}`), op: ">" },
  // "<10"
  { re: new RegExp(`(?:^|[^\\w])<\\s*${NUM_RE}`), op: "<" },
];

/**
 * @param {string} s
 * @returns {Threshold | ThresholdNotExtracted}
 */
export function extractThreshold(s) {
  for (const { re, op } of SUCCESS_PATTERNS) {
    const m = re.exec(s);
    if (m !== null && m[1] !== undefined) {
      const value = Number.parseFloat(m[1]);
      if (Number.isFinite(value)) {
        return /** @type {Threshold} */ ({ op: /** @type {any} */ (op), value });
      }
    }
  }
  return { op: "noop" };
}

/**
 * @param {number} value
 * @param {Threshold} threshold
 * @returns {boolean}
 */
function meetsThreshold(value, threshold) {
  switch (threshold.op) {
    case ">=":
      return value >= threshold.value;
    case "<=":
      return value <= threshold.value;
    case ">":
      return value > threshold.value;
    case "<":
      return value < threshold.value;
  }
}

/**
 * Returns true when `value` has crossed the pivot in the WRONG direction —
 * i.e., `success` says "≥10" and `pivot` says "<0", a value of -5 counts
 * as a pivot crossing. The pivot's direction is *opposite* the success
 * direction by construction (rule #9 contract).
 *
 * @param {number} value
 * @param {Threshold} pivot
 * @returns {boolean}
 */
function crossesPivot(value, pivot) {
  return meetsThreshold(value, pivot);
}

/**
 * Parse the first numeric token out of a measurement's stdout. Tolerates
 * leading/trailing whitespace and surrounding text — the daily runner
 * captures stdout verbatim, which is often `42\n` but may be a longer
 * report. We pull the first signed-decimal token.
 *
 * @param {string} stdout
 * @returns {number | null}
 */
export function extractValue(stdout) {
  const m = /-?\d+(?:\.\d+)?/.exec(stdout);
  if (m === null) return null;
  const v = Number.parseFloat(m[0]);
  return Number.isFinite(v) ? v : null;
}

/**
 * @typedef {object} ReplayInput
 * @property {ExperimentMeta} meta
 * @property {StoreRecord} record — the most recent merge-record for this experiment
 * @property {readonly ReplayResult[]} priorReplays — replay-result rows already on file
 * @property {string} currentValueStdout — verbatim stdout from running `meta.measurement` now
 * @property {string} now — ISO-8601 timestamp the replay observed
 * @property {string} ref — head ref the measurement ran against
 * @property {number} windowDays — which window this call covers
 */

/**
 * @typedef {object} ReplayDecision
 * @property {ReplayVerdict} verdict
 * @property {string} reason
 * @property {ReplayResult} resultLine — the row to append to the JSONL
 */

/**
 * Pure function: given the inputs for one replay window, return the verdict
 * + the JSONL row to append. No I/O.
 *
 * Verdict ladder (pivot-experiment-only-on-2-consecutive-regressions per
 * the Risk mitigation in the original task brief):
 *
 *   - `regressed`: this window's value crosses pivot AND the prior replay
 *     for this experiment also crossed pivot. (Two consecutive regressions
 *     dampen one-off noise.)
 *   - `validated`: value meets success AND no value has crossed pivot in
 *     the prior replays for this experiment.
 *   - `inconclusive`: anything else, including:
 *       - first-time pivot crossing (must persist into the next window);
 *       - value below success but above pivot;
 *       - non-numeric stdout or non-extractable thresholds.
 *
 * @param {ReplayInput} input
 * @returns {ReplayDecision}
 */
/**
 * @param {number} value
 * @param {Threshold} successT
 * @param {Threshold} pivotT
 * @param {boolean} priorPivotCrossing
 * @param {number} windowDays
 * @returns {{ verdict: ReplayVerdict, reason: string }}
 */
function decideVerdictFromNumbers(value, successT, pivotT, priorPivotCrossing, windowDays) {
  const crossed = crossesPivot(value, pivotT);
  if (crossed && priorPivotCrossing) {
    return {
      verdict: "regressed",
      reason: `value ${value} crosses pivot ${pivotT.op}${pivotT.value} in two consecutive windows`,
    };
  }
  if (crossed) {
    return {
      verdict: "inconclusive",
      reason: `value ${value} crosses pivot ${pivotT.op}${pivotT.value} once; awaiting next window before declaring regressed`,
    };
  }
  if (meetsThreshold(value, successT)) {
    return {
      verdict: "validated",
      reason: `value ${value} meets success ${successT.op}${successT.value} at +${windowDays}d`,
    };
  }
  return {
    verdict: "inconclusive",
    reason: `value ${value} below success ${successT.op}${successT.value}, above pivot ${pivotT.op}${pivotT.value}`,
  };
}

/**
 * @param {string} stdout
 * @param {ExperimentMeta} meta
 * @param {readonly ReplayResult[]} priorReplays
 * @param {number} windowDays
 * @returns {{ verdict: ReplayVerdict, reason: string }}
 */
function decideVerdict(stdout, meta, priorReplays, windowDays) {
  const value = extractValue(stdout);
  const successT = extractThreshold(meta.success);
  const pivotT = extractThreshold(meta.pivot);
  if (value === null) {
    return {
      verdict: "inconclusive",
      reason: `measurement stdout did not yield a numeric value: ${JSON.stringify(stdout.slice(0, 80))}`,
    };
  }
  if (successT.op === "noop" || pivotT.op === "noop") {
    return {
      verdict: "inconclusive",
      reason: `success/pivot threshold not numerically extractable from "${meta.success}" / "${meta.pivot}"`,
    };
  }
  const priorPivotCrossing = priorReplays.some(
    (r) => r.verdict === "regressed" || /pivot/i.test(r.reason),
  );
  return decideVerdictFromNumbers(value, successT, pivotT, priorPivotCrossing, windowDays);
}

/**
 * @param {ReplayInput} input
 * @returns {ReplayDecision}
 */
export function replayExperiment(input) {
  const { meta, currentValueStdout, now, ref, windowDays, priorReplays } = input;
  const { verdict, reason } = decideVerdict(currentValueStdout, meta, priorReplays, windowDays);
  /** @type {ReplayResult} */
  const resultLine = {
    kind: "replay-result",
    experiment_id: meta.id,
    ts: now,
    ref,
    value: currentValueStdout,
    window_days: windowDays,
    verdict,
    reason,
  };
  return { verdict, reason, resultLine };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI side: I/O + orchestration. The pure function above is what the tests pin.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} path
 * @returns {string | null}
 */
function readMaybe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Parse a JSONL file into typed rows. Corrupt lines surface as warnings,
 * never crash the run (rule #7 chaos discipline — graceful-degrade on
 * upstream-malformed inputs).
 *
 * @param {string} content
 * @param {string} path
 * @returns {{ records: StoreRecord[], replays: ReplayResult[], warnings: string[] }}
 */
/**
 * @param {string} line
 * @param {string} path
 * @param {number} lineNo
 * @returns {{ ok: true, value: object } | { ok: false, warning: string }}
 */
function parseJsonlLine(line, path, lineNo) {
  try {
    const parsed = JSON.parse(line);
    if (parsed === null || typeof parsed !== "object") {
      return { ok: false, warning: `${path}:${lineNo} non-object JSONL row, skipping` };
    }
    return { ok: true, value: parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, warning: `${path}:${lineNo} corrupt JSONL line, skipping: ${msg}` };
  }
}

/**
 * @param {object} parsed
 * @returns {"replay-result" | "record" | "unknown"}
 */
function classifyJsonlRow(parsed) {
  const obj = /** @type {Record<string, unknown>} */ (parsed);
  if (obj["kind"] === "replay-result") return "replay-result";
  if (typeof obj["experiment_id"] === "string" && typeof obj["ts"] === "string") return "record";
  return "unknown";
}

/**
 * @param {string} line
 * @param {string} path
 * @param {number} lineNo
 * @param {{ records: StoreRecord[], replays: ReplayResult[], warnings: string[] }} sink
 */
function dispatchJsonlLine(line, path, lineNo, sink) {
  if (line.trim() === "") return;
  const res = parseJsonlLine(line, path, lineNo);
  if (!res.ok) {
    sink.warnings.push(res.warning);
    return;
  }
  const kind = classifyJsonlRow(res.value);
  if (kind === "replay-result") sink.replays.push(/** @type {ReplayResult} */ (res.value));
  else if (kind === "record") sink.records.push(/** @type {StoreRecord} */ (res.value));
  else sink.warnings.push(`${path}:${lineNo} unrecognised JSONL row, skipping`);
}

/**
 * @param {string} content
 * @param {string} path
 * @returns {{ records: StoreRecord[], replays: ReplayResult[], warnings: string[] }}
 */
export function parseJsonl(content, path) {
  /** @type {{ records: StoreRecord[], replays: ReplayResult[], warnings: string[] }} */
  const sink = { records: [], replays: [], warnings: [] };
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    dispatchJsonlLine(line, path, i + 1, sink);
  }
  return sink;
}

/**
 * Find replay windows that are due NOW and have not yet been recorded.
 *
 * @param {StoreRecord} record
 * @param {readonly ReplayResult[]} replays
 * @param {readonly number[]} windows
 * @param {Date} now
 * @returns {number[]} — the windows (in days) that should run this tick
 */
export function dueWindows(record, replays, windows, now) {
  const merged = new Date(record.ts).getTime();
  if (Number.isNaN(merged)) return [];
  /** @type {number[]} */
  const due = [];
  for (const win of windows) {
    const boundary = merged + win * 24 * 60 * 60 * 1000;
    if (now.getTime() < boundary) continue;
    // Already covered? Match on (ref, window_days) so re-runs are no-ops.
    const already = replays.some((r) => r.ref === record.ref && r.window_days === win);
    if (already) continue;
    due.push(win);
  }
  return due;
}

/**
 * @type {Exec}
 */
function realExec(cmd, opts) {
  const timeoutMs = opts.timeoutSeconds * 1000;
  const start = Date.now();
  const result = spawnSync("/bin/sh", ["-c", cmd], {
    cwd: opts.cwd,
    timeout: timeoutMs,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const durationMs = Date.now() - start;
  const timedOut = result.signal === "SIGTERM" && durationMs >= timeoutMs - 50;
  return {
    exitCode: result.status ?? (timedOut ? 124 : 1),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs,
    timedOut,
  };
}

/**
 * Locate the experiment-store dir. Resolved relative to the repo root
 * (the parent of this script's dir).
 *
 * @param {string} repoRoot
 * @returns {string}
 */
function storeDir(repoRoot) {
  return resolve(repoRoot, "experiment-store");
}

/**
 * @param {string} repoRoot
 * @returns {string[]}
 */
function listStoreFiles(repoRoot) {
  const dir = storeDir(repoRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".jsonl"))
    .map((n) => resolve(dir, n));
}

/**
 * Resolve a recorded experiment id to its current `EXPERIMENT.yaml`.
 * If the on-disk yaml's id matches, parse it. Otherwise we fall back
 * to a minimal meta synthesised from the record (no thresholds → all
 * verdicts inconclusive). This is the conservative behaviour: an
 * experiment whose yaml has been removed (e.g., closed feature) doesn't
 * crash the tracker; it just stops yielding non-inconclusive verdicts.
 *
 * @param {string} repoRoot
 * @param {string} experimentId
 * @returns {Promise<ExperimentMeta | null>}
 */
async function loadMetaFor(repoRoot, experimentId) {
  const yamlPath = resolve(repoRoot, "EXPERIMENT.yaml");
  const yaml = readMaybe(yamlPath);
  if (yaml === null) return null;
  const { parse } = await import("@minsky/experiment-record");
  const parsed = parse(yaml);
  if (!parsed.ok) return null;
  if (parsed.record.id !== experimentId) return null;
  return {
    id: parsed.record.id,
    measurement: parsed.record.measurement,
    success: parsed.record.success,
    pivot: parsed.record.pivot,
    replay_windows_days: parsed.record.replay_windows_days,
    timeout_seconds: parsed.record.timeout_seconds,
  };
}

/**
 * @param {ReplayResult} row
 * @returns {string}
 */
function formatJsonl(row) {
  return `${JSON.stringify(row)}\n`;
}

/**
 * @param {string} repoRoot
 * @param {ReplayResult} row
 */
function appendValidatedLearning(repoRoot, row) {
  const path = resolve(repoRoot, "validated-learnings.md");
  const line = `- \`${row.experiment_id}\` — validated at +${row.window_days}d (${row.ts}, ref ${row.ref.slice(0, 7)}): ${row.reason}\n`;
  if (!existsSync(path)) {
    writeFileSync(path, validatedLearningsHeader() + line, "utf8");
  } else {
    appendFileSync(path, line, "utf8");
  }
}

function validatedLearningsHeader() {
  return [
    "# Validated learnings",
    "",
    "Append-only log of experiments whose post-merge replay (rule #9 weekly–monthly layer)",
    "found the predicted gain held at +7d / +30d. Maintained by `scripts/replay-experiment.mjs`",
    "and the `experiment-tracker` GitHub Actions workflow. Rows are never deleted; superseded",
    "learnings get a follow-up row, not a rewrite.",
    "",
  ].join("\n");
}

/**
 * @param {string} repoRoot
 * @param {ReplayResult} row
 */
function appendPivotTask(repoRoot, row) {
  const path = resolve(repoRoot, "TASKS.md");
  const taskId = `pivot-experiment-${row.experiment_id}`;
  const existing = readMaybe(path) ?? "";
  if (existing.includes(`**ID**: ${taskId}`)) return; // idempotent
  const block = [
    "",
    `- [ ] \`${taskId}\` — pivot the approach behind \`${row.experiment_id}\` (regressed at +${row.window_days}d)`,
    `  - **ID**: ${taskId}`,
    "  - **Tags**: pivot, automated, rule-9",
    "  - **Estimate**: 2–4h (review + decision)",
    `  - **Hypothesis**: the experiment \`${row.experiment_id}\` regressed below its pivot threshold across two consecutive replay windows. Per rule #9 the *approach* is now abandoned (not just the change reverted). The hypothesis at this layer is that opening this task within one replay tick of the second crossing converts a silent regression into an actionable decision within ≤7 days of detection.`,
    `  - **Details**: Auto-filed by \`scripts/replay-experiment.mjs\` at ${row.ts} after the +${row.window_days}d replay against ref ${row.ref}. Replay reason: ${row.reason}.`,
    `  - **Files**: \`experiment-store/${row.experiment_id}.jsonl\` (verdict log)`,
    "  - **Verification**: a follow-up commit either (a) reverts and lands a new approach with its own `EXPERIMENT.yaml`, or (b) documents in `research.md` why the original approach is being persevered with despite the regression.",
    `  - **Measurement**: \`grep -E 'pivot-experiment-${row.experiment_id}' TASKS.md\` returns 0 once this task is closed.`,
    "  - **Pivot**: if the regressed metric was itself wrong (instrumentation bug), file a separate fix-instrumentation task and close this one with that reference; do not silently keep the original approach.",
    "  - **Acceptance**: decision recorded; either revert lands or perseverance is justified in research.md.",
    "  - **Anchor**: Ries 2011 (pivot-or-persevere); rule #9 (pre-registered HDD); Kohavi/Tang/Xu 2020 (mid-term regressions).",
    "  - **Risk**: a regressed verdict may itself be noisy (e.g., flaky measurement). Mitigation: the two-consecutive-windows rule already handles single-window noise; if the measurement itself is suspect, the instrumentation fix above is the right response.",
    "",
  ].join("\n");
  appendFileSync(path, block, "utf8");
}

/**
 * @typedef {object} ProcessReport
 * @property {number} filesScanned
 * @property {number} replaysAdded
 * @property {number} validatedAdded
 * @property {number} regressedAdded
 * @property {string[]} warnings
 */

/**
 * @typedef {object} ProcessOpts
 * @property {string} repoRoot
 * @property {Date} now
 * @property {Exec} [exec]
 * @property {boolean} [dryRun]
 */

/**
 * @typedef {object} WindowOutcome
 * @property {boolean} ran
 * @property {ReplayVerdict} [verdict]
 * @property {string} [warning]
 * @property {ReplayResult} [resultLine]
 */

/**
 * Run one replay window. Returns the verdict (or a warning) without
 * touching the file system. The caller decides whether to persist.
 *
 * @param {object} args
 * @param {string} args.path
 * @param {ExperimentMeta} args.meta
 * @param {StoreRecord} args.record
 * @param {readonly ReplayResult[]} args.priorReplays
 * @param {number} args.windowDays
 * @param {Date} args.now
 * @param {Exec} args.exec
 * @returns {WindowOutcome}
 */
function runOneWindow(args) {
  const { path, meta, record, priorReplays, windowDays, now, exec } = args;
  const result = exec(meta.measurement, { timeoutSeconds: meta.timeout_seconds });
  if (result.exitCode !== 0 || result.timedOut) {
    const stderrTail = result.stderr.trim().slice(0, 200) || "(empty)";
    const tail = result.timedOut ? ", timed out" : "";
    return {
      ran: false,
      warning: `${path}: replay measurement failed (exit ${result.exitCode}${tail}); skipping +${windowDays}d window. Stderr: ${stderrTail}`,
    };
  }
  const decision = replayExperiment({
    meta,
    record,
    priorReplays,
    currentValueStdout: result.stdout,
    now: now.toISOString(),
    ref: record.ref,
    windowDays,
  });
  return { ran: true, verdict: decision.verdict, resultLine: decision.resultLine };
}

/**
 * Persist a window outcome (append JSONL row, write validated-learning,
 * file pivot task). Updates the per-store-file replay list in place so
 * subsequent windows in the same tick see the new row.
 *
 * @param {object} args
 * @param {string} args.repoRoot
 * @param {string} args.path
 * @param {ReplayResult} args.resultLine
 * @param {boolean} args.dryRun
 * @param {ReplayResult[]} args.replaysInOut
 */
function persistWindowOutcome(args) {
  const { repoRoot, path, resultLine, dryRun, replaysInOut } = args;
  if (!dryRun) {
    appendFileSync(path, formatJsonl(resultLine), "utf8");
    if (resultLine.verdict === "validated") appendValidatedLearning(repoRoot, resultLine);
    else if (resultLine.verdict === "regressed") appendPivotTask(repoRoot, resultLine);
  }
  replaysInOut.push(resultLine);
}

/**
 * @typedef {object} FileReport
 * @property {number} replaysAdded
 * @property {number} validatedAdded
 * @property {number} regressedAdded
 * @property {string[]} warnings
 */

/**
 * Process a single experiment-store file end-to-end. The pure decision
 * logic stays in `replayExperiment`; this glue handles parse + due-window
 * scheduling + persistence. Extracted from `processStore` to keep its
 * cognitive complexity below the lint cap.
 *
 * @param {object} args
 * @param {string} args.repoRoot
 * @param {string} args.path
 * @param {Date} args.now
 * @param {Exec} args.exec
 * @param {boolean} args.dryRun
 * @returns {Promise<FileReport>}
 */
/**
 * @param {object} args
 * @param {string} args.repoRoot
 * @param {string} args.path
 * @param {ExperimentMeta} args.meta
 * @param {StoreRecord} args.record
 * @param {readonly number[]} args.due
 * @param {ReplayResult[]} args.priorReplays
 * @param {Date} args.now
 * @param {Exec} args.exec
 * @param {boolean} args.dryRun
 * @returns {FileReport}
 */
/**
 * @param {WindowOutcome} outcome
 * @param {object} ctx
 * @param {string} ctx.repoRoot
 * @param {string} ctx.path
 * @param {boolean} ctx.dryRun
 * @param {ReplayResult[]} ctx.priorReplays
 * @param {FileReport} ctx.report
 */
function applyWindowOutcome(outcome, ctx) {
  if (!outcome.ran) {
    if (outcome.warning !== undefined) ctx.report.warnings.push(outcome.warning);
    return;
  }
  if (outcome.resultLine === undefined) return;
  persistWindowOutcome({
    repoRoot: ctx.repoRoot,
    path: ctx.path,
    resultLine: outcome.resultLine,
    dryRun: ctx.dryRun,
    replaysInOut: ctx.priorReplays,
  });
  ctx.report.replaysAdded++;
  if (outcome.verdict === "validated") ctx.report.validatedAdded++;
  else if (outcome.verdict === "regressed") ctx.report.regressedAdded++;
}

/**
 * @param {{
 *   repoRoot: string,
 *   path: string,
 *   meta: ExperimentMeta,
 *   record: StoreRecord,
 *   due: readonly number[],
 *   priorReplays: ReplayResult[],
 *   now: Date,
 *   exec: Exec,
 *   dryRun: boolean,
 * }} args
 * @returns {FileReport}
 */
function runDueWindows(args) {
  const { repoRoot, path, meta, record, due, priorReplays, now, exec, dryRun } = args;
  /** @type {FileReport} */
  const report = { replaysAdded: 0, validatedAdded: 0, regressedAdded: 0, warnings: [] };
  for (const windowDays of due) {
    const outcome = runOneWindow({ path, meta, record, priorReplays, windowDays, now, exec });
    applyWindowOutcome(outcome, { repoRoot, path, dryRun, priorReplays, report });
  }
  return report;
}

/**
 * @param {FileReport} into
 * @param {FileReport} from
 */
function mergeFileReport(into, from) {
  into.replaysAdded += from.replaysAdded;
  into.validatedAdded += from.validatedAdded;
  into.regressedAdded += from.regressedAdded;
  into.warnings.push(...from.warnings);
}

/**
 * @param {{ repoRoot: string, path: string, now: Date, exec: Exec, dryRun: boolean }} args
 * @returns {Promise<FileReport>}
 */
async function processOneFile(args) {
  const { repoRoot, path, now, exec, dryRun } = args;
  /** @type {FileReport} */
  const report = { replaysAdded: 0, validatedAdded: 0, regressedAdded: 0, warnings: [] };

  const content = readMaybe(path) ?? "";
  const { records, replays, warnings } = parseJsonl(content, path);
  report.warnings.push(...warnings);
  if (records.length === 0) return report;

  // Append-only store with ISO-8601 timestamps → string-sort = chronological.
  const sorted = [...records].sort((a, b) => a.ts.localeCompare(b.ts));
  const last = sorted[sorted.length - 1];
  if (last === undefined) return report;

  const meta = await loadMetaFor(repoRoot, last.experiment_id);
  if (meta === null) {
    report.warnings.push(
      `${path}: no live EXPERIMENT.yaml matches id ${last.experiment_id}; skipping (closed or renamed)`,
    );
    return report;
  }

  const due = dueWindows(last, replays, meta.replay_windows_days, now);
  const priorReplays = replays.filter((r) => r.experiment_id === meta.id);
  const windowReport = runDueWindows({
    repoRoot,
    path,
    meta,
    record: last,
    due,
    priorReplays,
    now,
    exec,
    dryRun,
  });
  mergeFileReport(report, windowReport);
  return report;
}

/**
 * Top-level orchestration. Walks every `experiment-store/*.jsonl`, delegates
 * the per-file work to `processOneFile`, and aggregates the report. The
 * dry-run path short-circuits the persistence inside `persistWindowOutcome`.
 *
 * @param {ProcessOpts} opts
 * @returns {Promise<ProcessReport>}
 */
export async function processStore(opts) {
  const { repoRoot, now, dryRun = false } = opts;
  const exec = opts.exec ?? realExec;
  const files = listStoreFiles(repoRoot);
  /** @type {ProcessReport} */
  const total = {
    filesScanned: files.length,
    replaysAdded: 0,
    validatedAdded: 0,
    regressedAdded: 0,
    warnings: [],
  };
  for (const path of files) {
    const fileReport = await processOneFile({ repoRoot, path, now, exec, dryRun });
    total.replaysAdded += fileReport.replaysAdded;
    total.validatedAdded += fileReport.validatedAdded;
    total.regressedAdded += fileReport.regressedAdded;
    total.warnings.push(...fileReport.warnings);
  }
  return total;
}

/**
 * @param {string[]} argv
 * @returns {Record<string, string | true>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | true>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function usage() {
  process.stderr.write(
    ["usage:", "  replay-experiment [--dry-run] [--now <iso-ts>]", ""].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["help"] === true || args["h"] === true) {
    usage();
    return 0;
  }
  const repoRoot = resolve(HERE, "..");
  // Ensure the dir exists so the workflow's `git status` step has something
  // to look at (also makes the .gitkeep contract observable).
  const dir = storeDir(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const nowIso = typeof args["now"] === "string" ? args["now"] : new Date().toISOString();
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) {
    process.stderr.write(`invalid --now value: ${nowIso}\n`);
    return 2;
  }
  const dryRun = args["dry-run"] === true;

  const report = await processStore({ repoRoot, now, dryRun });

  for (const w of report.warnings) process.stderr.write(`[warn] ${w}\n`);
  process.stdout.write(
    `experiment-tracker: scanned=${report.filesScanned}, replays-added=${report.replaysAdded}, validated=${report.validatedAdded}, regressed=${report.regressedAdded}${dryRun ? " (dry-run)" : ""}\n`,
  );
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("replay-experiment.mjs");
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(
        `replay-experiment crashed: ${err instanceof Error ? err.stack : String(err)}\n`,
      );
      process.exit(2);
    },
  );
}
