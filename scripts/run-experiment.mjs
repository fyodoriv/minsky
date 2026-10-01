#!/usr/bin/env node
// Pattern: continuous experimentation runner over per-PR pre-registration
//   records (rule #9 daily layer enforcement) + GitHub Actions deterministic CI.
// Source: Fagerholm et al., "Building Blocks for Continuous Experimentation",
//   *RCoSE* 2014 (the per-change experiment runner is the first building block);
//   Kohavi/Tang/Xu, *Trustworthy Online Controlled Experiments*, 2020 ch. 4
//   (running every change as an experiment); Beck 1999 (CI as constraint enforcer);
//   rule #10 (deterministic enforcement — same input, same output, no LLM in the chain).
// Conformance: full — pure function over diffs and command output. The CLI wrapper
//   is the I/O boundary; `runExperiment(...)` itself is referentially transparent.
//
// Why this gate exists: rule #9 declares pre-registration; without execution,
//   declaration is half a rule. This runner closes the daily layer:
//
//   - Job A (gate, on every PR): verify EXPERIMENT.yaml is present (or a
//     valid `trivial` exemption is declared), parses cleanly via
//     @minsky/experiment-record, AND its `measurement` command is runnable
//     (exit-code 0, within `timeout_seconds`).
//   - Job B (record, on push to main): re-run `measurement` against the
//     merge-base ref → baseline; against current main → treatment; append
//     `{experiment_id, baseline, treatment, ts, ref}` to
//     `experiment-store/<id>.jsonl`. The verdict-against-thresholds is the
//     weekly layer's job (`experiment-tracker-v0`); this runner only enforces
//     "the command is runnable and produces some output".
//
// Trivial-PR exemption is two-factor (matching the rule-3 pattern):
//   1. The PR carries the GitHub label `trivial`, AND
//   2. The PR body contains the exact comment
//      `<!-- experiment: trivial — see exemption.md -->`.
//   Either alone is insufficient — the label is the author's intent, the
//   comment is the explicit waiver visible in the description.
//
// Pivot (rule #9): if the gate produces ≥3 false positives in its first month
//   (e.g., misclassifying a trivial change as non-trivial, or measurement
//   commands that pass locally but fail in CI), tighten the trivial-detection
//   heuristic OR drop the executability gate to soft-fail until friction subsides.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Imported from the workspace-resolved package (built by `pnpm build` in
// `novel/experiment-record/` before this script is invoked from CI). Vitest
// resolves the same specifier to the TS source via the alias declared in
// `vitest.config.ts`, so tests don't require a pre-build.
import { parse as parseExperimentRecord } from "@minsky/experiment-record";

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
 * @param {string} cmd — shell command to run
 * @param {{ cwd?: string, timeoutSeconds: number }} opts
 * @returns {ExecResult}
 */

/**
 * @typedef {object} StoreRecord
 * @property {string} experiment_id
 * @property {string} baseline — captured stdout of measurement against base ref (verbatim)
 * @property {string} treatment — captured stdout of measurement against head ref
 * @property {string} ts — ISO-8601 timestamp the runner observed
 * @property {string} ref — the head ref the recorder ran against (commit sha)
 * @property {string} base_ref — the merge-base ref used for the baseline
 * @property {number} baseline_duration_ms
 * @property {number} treatment_duration_ms
 */

const TRIVIAL_EXEMPTION_RE = /<!--\s*experiment:\s*trivial\b[^>]*-->/i;

/**
 * @typedef {object} RunInput
 * @property {"gate" | "record"} mode
 * @property {string | null} recordContent
 * @property {boolean} [prTrivialLabel]
 * @property {string} [prBody]
 * @property {Exec} exec
 * @property {string} ts
 * @property {string} [headRef]
 * @property {string} [baseRef]
 */

/**
 * @typedef {{ ok: true, kind: "trivial-exempt" }
 *   | { ok: true, kind: "gate", experimentId: string }
 *   | { ok: true, kind: "record", record: StoreRecord }
 *   | { ok: false, errors: readonly string[] }} RunResult
 */

/**
 * Two-factor trivial exemption check.
 *
 * @param {boolean} labelled
 * @param {string} body
 * @returns {RunResult | null} — null means "not exempt; continue"
 */
function checkTrivialExemption(labelled, body) {
  const hasComment = TRIVIAL_EXEMPTION_RE.test(body);
  if (labelled && hasComment) return { ok: true, kind: "trivial-exempt" };
  if (labelled && !hasComment) {
    return {
      ok: false,
      errors: [
        "PR is labelled `trivial` but the body is missing the exemption comment `<!-- experiment: trivial — see exemption.md -->`. Both are required (two-factor) per docs/experiment-runner.md.",
      ],
    };
  }
  if (!labelled && hasComment) {
    return {
      ok: false,
      errors: [
        "PR body declares the `trivial` exemption comment but the PR is not labelled `trivial`. Both are required (two-factor); add the label or remove the comment.",
      ],
    };
  }
  return null;
}

/**
 * Run a measurement once and translate the exec result into a RunResult error
 * branch when it failed — or `null` to indicate "the run succeeded; carry on".
 *
 * @param {ExecResult} result
 * @param {string} label — "gate" / "baseline" / "treatment"
 * @param {string} cmd
 * @param {number} timeoutSeconds
 * @param {string} [refLabel]
 * @returns {RunResult | null}
 */
function execFailureToResult(result, label, cmd, timeoutSeconds, refLabel) {
  const refSuffix = refLabel !== undefined ? ` at ref ${refLabel}` : "";
  if (result.timedOut) {
    return {
      ok: false,
      errors: [
        `${label} measurement timed out after ${timeoutSeconds}s${refSuffix}: \`${cmd}\`. Raise \`timeout_seconds\` if the measurement legitimately needs longer, OR speed up the measurement.`,
      ],
    };
  }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      errors: [
        `${label} measurement is not runnable (exit ${result.exitCode})${refSuffix}: \`${cmd}\`. Stderr: ${result.stderr.trim() || "(empty)"}`,
      ],
    };
  }
  return null;
}

/**
 * @param {import("@minsky/experiment-record").ExperimentRecord} record
 * @param {Exec} exec
 * @returns {RunResult}
 */
function gateMeasurement(record, exec) {
  const result = exec(record.measurement, { timeoutSeconds: record.timeout_seconds });
  const failure = execFailureToResult(result, "gate", record.measurement, record.timeout_seconds);
  if (failure !== null) return failure;
  return { ok: true, kind: "gate", experimentId: record.id };
}

/**
 * @param {import("@minsky/experiment-record").ExperimentRecord} record
 * @param {Exec} exec
 * @param {string} baseRef
 * @param {string} headRef
 * @param {string} ts
 * @returns {RunResult}
 */
function recordMeasurement(record, exec, baseRef, headRef, ts) {
  const baselineRun = exec(record.measurement, { timeoutSeconds: record.timeout_seconds });
  const baselineFail = execFailureToResult(
    baselineRun,
    "baseline",
    record.measurement,
    record.timeout_seconds,
    baseRef,
  );
  if (baselineFail !== null) return baselineFail;

  const treatmentRun = exec(record.measurement, { timeoutSeconds: record.timeout_seconds });
  const treatmentFail = execFailureToResult(
    treatmentRun,
    "treatment",
    record.measurement,
    record.timeout_seconds,
    headRef,
  );
  if (treatmentFail !== null) return treatmentFail;

  /** @type {StoreRecord} */
  const storeRecord = {
    experiment_id: record.id,
    baseline: baselineRun.stdout,
    treatment: treatmentRun.stdout,
    ts,
    ref: headRef,
    base_ref: baseRef,
    baseline_duration_ms: baselineRun.durationMs,
    treatment_duration_ms: treatmentRun.durationMs,
  };
  return { ok: true, kind: "record", record: storeRecord };
}

/**
 * Pure function: given the runner inputs, return either a "gate-only ok",
 * a populated `StoreRecord`, or a structured error. Same input → same output.
 *
 * @param {RunInput} input
 * @returns {RunResult}
 */
export function runExperiment(input) {
  const { mode, recordContent, exec, ts } = input;

  if (mode === "gate") {
    const exemption = checkTrivialExemption(input.prTrivialLabel === true, input.prBody ?? "");
    if (exemption !== null) return exemption;
  }

  if (recordContent === null) {
    return {
      ok: false,
      errors: [
        "missing EXPERIMENT.yaml at the PR root. Every non-trivial PR must pre-register a hypothesis per constitutional rule #9. See docs/experiment-runner.md.",
      ],
    };
  }

  const parsed = parseExperimentRecord(recordContent);
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors.map((e) => `EXPERIMENT.yaml ${e.kind}: ${e.message}`),
    };
  }

  if (mode === "gate") return gateMeasurement(parsed.record, exec);

  const { baseRef, headRef } = input;
  if (baseRef === undefined || headRef === undefined) {
    return { ok: false, errors: ["record mode requires both baseRef and headRef"] };
  }
  return recordMeasurement(parsed.record, exec, baseRef, headRef, ts);
}

/**
 * CLI exec strategy: a real shell-out via spawnSync with a wall-clock timeout.
 * The pure function receives this as `exec`; tests inject a stub that never
 * actually shells out.
 *
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
  // spawnSync's timeout signals via `signal === 'SIGTERM'` when the timer fired.
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
 * @param {string} ref
 */
function checkoutRef(ref) {
  const r = spawnSync("/bin/sh", ["-c", `git checkout --quiet ${ref}`], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`git checkout ${ref} failed: ${r.stderr}`);
  }
}

/**
 * @param {string} repoRoot
 * @param {string} experimentId
 * @param {object} record
 */
function appendStoreRecord(repoRoot, experimentId, record) {
  const storeDir = resolve(repoRoot, "experiment-store");
  if (!existsSync(storeDir)) mkdirSync(storeDir, { recursive: true });
  const path = resolve(storeDir, `${experimentId}.jsonl`);
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  return path;
}

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

function usage() {
  process.stderr.write(
    [
      "usage:",
      "  run-experiment gate --record <path> [--pr-body-file <path>] [--trivial-label]",
      "  run-experiment record --record <path> --base-ref <sha> --head-ref <sha>",
      "",
    ].join("\n"),
  );
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

/**
 * @param {RunResult} result
 * @returns {number}
 */
function reportGateResult(result) {
  if (result.ok) {
    if (result.kind === "trivial-exempt") {
      process.stdout.write("ci-experiment-runner gate: trivial exemption accepted.\n");
    } else if (result.kind === "gate") {
      process.stdout.write(
        `ci-experiment-runner gate ok: experiment "${result.experimentId}" parses + measurement runnable.\n`,
      );
    }
    return 0;
  }
  for (const err of result.errors) process.stderr.write(`${err}\n`);
  return 1;
}

/**
 * @param {Record<string, string | true>} args
 * @param {string | null} recordContent
 * @returns {number}
 */
function mainGate(args, recordContent) {
  const prBodyPath = typeof args["pr-body-file"] === "string" ? args["pr-body-file"] : null;
  const prBody = prBodyPath !== null ? (readMaybe(prBodyPath) ?? "") : "";
  const trivialLabel = args["trivial-label"] === true;

  const result = runExperiment({
    mode: "gate",
    recordContent,
    prTrivialLabel: trivialLabel,
    prBody,
    exec: realExec,
    ts: new Date().toISOString(),
  });
  return reportGateResult(result);
}

/**
 * @param {string} baseRef
 * @param {string} headRef
 * @returns {Exec}
 */
function makeOrchestratedExec(baseRef, headRef) {
  let call = 0;
  return (cmd, opts) => {
    if (call === 0) checkoutRef(baseRef);
    else if (call === 1) checkoutRef(headRef);
    call++;
    return realExec(cmd, opts);
  };
}

/**
 * @param {Record<string, string | true>} args
 * @param {string | null} recordContent
 * @param {string} repoRoot
 * @returns {number}
 */
function mainRecord(args, recordContent, repoRoot) {
  const baseRef = typeof args["base-ref"] === "string" ? args["base-ref"] : null;
  const headRef = typeof args["head-ref"] === "string" ? args["head-ref"] : null;
  if (baseRef === null || headRef === null) {
    usage();
    return 2;
  }

  if (recordContent === null) {
    // Post-merge: no EXPERIMENT.yaml on main means the merge was either
    // trivial-exempt (Job B is a no-op in that case) or the gate was bypassed.
    process.stdout.write(
      "ci-experiment-runner record: no EXPERIMENT.yaml at HEAD; nothing to record (trivial-exempt or pre-rule-#9 commit).\n",
    );
    return 0;
  }

  const result = runExperiment({
    mode: "record",
    recordContent,
    exec: makeOrchestratedExec(baseRef, headRef),
    ts: new Date().toISOString(),
    baseRef,
    headRef,
  });

  // Always restore HEAD so post-step cleanup runs against `headRef`.
  try {
    checkoutRef(headRef);
  } catch {
    // best-effort; if checkout fails here the runner is already wedged.
  }

  if (!result.ok) {
    for (const err of result.errors) process.stderr.write(`${err}\n`);
    return 1;
  }
  if (result.kind !== "record") return 0;

  const path = appendStoreRecord(repoRoot, result.record.experiment_id, result.record);
  process.stdout.write(
    `ci-experiment-runner record ok: appended to ${path} (baseline=${result.record.baseline_duration_ms}ms, treatment=${result.record.treatment_duration_ms}ms).\n`,
  );
  return 0;
}

function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (subcommand !== "gate" && subcommand !== "record") {
    usage();
    return 2;
  }
  const args = parseArgs(rest);
  const recordPathArg = args["record"];
  if (typeof recordPathArg !== "string") {
    usage();
    return 2;
  }
  const repoRoot = resolve(HERE, "..");
  const recordContent = readMaybe(recordPathArg);
  if (subcommand === "gate") return mainGate(args, recordContent);
  return mainRecord(args, recordContent, repoRoot);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("run-experiment.mjs");
if (invokedDirectly) {
  try {
    process.exit(main());
  } catch (err) {
    process.stderr.write(
      `run-experiment crashed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(2);
  }
}

// Re-exports for tests:
export { TRIVIAL_EXEMPTION_RE };
