#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved observer-dogfood-recurring-cadence (experiments/observer-dogfood-recurring-2026-06-02.yaml) -->
//
// observer-dogfood-runner — run the observer dogfood against minsky's own
// repo on a recurring cadence and append a 1-line finding-count record to
// data/observer-dogfood-log.jsonl.
//
// Why this exists: the observer skill (skill-plugins/observer/minsky/SKILL.md)
// surfaces real findings when run against minsky's own repo, but today it only
// runs when the operator initiates it. This runner is the cadence layer — the
// weekly GH Actions cron (.github/workflows/observer-dogfood.yml) invokes it,
// it shells `minsky run --once --no-live --host .` (the canonical single-
// iteration dry-run form per bin/minsky + the observer SKILL), parses the
// cross-repo iteration records the run wrote, counts findings, and appends a
// {run, findings_count, new_tasks_filed} record so the operator has continuous
// regression signal without operator action. The workflow opens a draft PR
// when findings_count > 0 — observer-on-self IS the canary (Beyer et al. 2016).
//
// Reuse over reinvention (rule #1): the health-check / restart watch loop is
// `minsky watch` (built into bin/minsky); this runner does NOT reimplement it.
// It runs a single bounded iteration (--once) and reads the same cross-repo
// experiment-store records the observer SKILL's monitor loop reads, so the
// finding definition stays in one place.
//
// Pattern: pure transform + injected I/O seam (rule #2 — the record list is
//   the seam; runMinsky / readRecords / appendLine are the boundary, all
//   replaceable via DI for the paired tests). Conformance: full — parseRecords
//   / countFindings / buildLogLine are pure functions; I/O lives in
//   runObserverDogfood's injected dependencies and the CLI's default bindings.
// Source: TASKS.md observer-dogfood-recurring-cadence; vision.md rule #9
//   (pre-registered HDD — the finding-rate metric is declared in
//   experiments/observer-dogfood-recurring-2026-06-02.yaml); rule #1 (don't
//   reinvent — reuse the existing watch-loop record shape); Forsgren-Humble-Kim
//   2018 (continuous verification — observers run on a cadence, not just
//   operator-initiated); Beyer et al. 2016 (canary/dogfood discipline).

import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Default log path — the recurring finding-count ledger the workflow reads.
 * Co-located under data/ (committed, unlike the gitignored .minsky/ session
 * state) so the metric history survives across runs and clones.
 */
export const DEFAULT_LOG_PATH = resolve(REPO_ROOT, "data", "observer-dogfood-log.jsonl");

/**
 * The cross-repo experiment-store directory the single iteration writes its
 * verdict record into. Same path the observer SKILL's monitor loop tails.
 */
export const CROSS_REPO_STORE_REL = join(".minsky", "experiment-store", "cross-repo");

/**
 * Verdicts that count as a FINDING — a signal the dogfood surfaced that the
 * observer would act on. Mirrors the "Action" column of the observer SKILL's
 * signal-classification table: scope-leak / spawn-failed / crash / stuck /
 * rule-9-violation are problems worth a draft PR; `validated` and
 * `empty-queue` are healthy and are NOT findings. Frozen so a silent edit is
 * caught by the paired test.
 *
 * @type {ReadonlySet<string>}
 */
export const FINDING_VERDICTS = Object.freeze(
  new Set(["scope-leak", "spawn-failed", "crash", "stuck", "rule-9-violation"]),
);

/**
 * Parse the cross-repo experiment-store JSONL text into typed records. Each
 * non-empty line is one JSON object; malformed lines are dropped (graceful-
 * degrade, rule #7) rather than throwing — a single truncated mid-write line
 * must not lose the whole run's signal. The drop count is returned so the
 * caller can surface it.
 *
 * @param {string} text — raw JSONL content (may be empty)
 * @returns {{ records: Array<Record<string, unknown>>, dropped: number }}
 */
export function parseRecords(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  /** @type {Array<Record<string, unknown>>} */
  const records = [];
  let dropped = 0;
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
      // rule-6: handled-locally — JSON.parse throws on a truncated mid-write
      // line at the I/O boundary; dropping that one line (not the run) is the
      // graceful-degrade contract, so the boolean-ish drop branch is correct.
    } catch {
      dropped += 1;
      continue;
    }
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      records.push(parsed);
    } else {
      dropped += 1;
    }
  }
  return { records, dropped };
}

/**
 * Count findings among parsed records — records whose `verdict` is in
 * FINDING_VERDICTS. Records without a string verdict are ignored.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} records
 * @returns {number}
 */
export function countFindings(records) {
  let n = 0;
  for (const r of records) {
    const verdict = r["verdict"];
    if (typeof verdict === "string" && FINDING_VERDICTS.has(verdict)) n += 1;
  }
  return n;
}

/**
 * Count how many records carry a non-null `pr_url` — the runs that filed a
 * task / opened a PR (the `new_tasks_filed` column). A finding without a PR is
 * a finding the cadence surfaced but did not yet act on.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} records
 * @returns {number}
 */
export function countTasksFiled(records) {
  let n = 0;
  for (const r of records) {
    const prUrl = r["pr_url"];
    if (typeof prUrl === "string" && prUrl.length > 0 && prUrl !== "null") n += 1;
  }
  return n;
}

/**
 * Build the JSONL ledger line for one cadence run. `run` is the ISO timestamp
 * the cron fired (defaults to now); the count fields come from the parsed
 * records. The shape `{run, findings_count, new_tasks_filed}` is the schema
 * documented in RECURRING.md and asserted by the Measurement command in the
 * experiment YAML.
 *
 * @param {{
 *   run?: string,
 *   findingsCount: number,
 *   newTasksFiled: number,
 *   recordsRead?: number,
 * }} input
 * @returns {string} a single JSONL line, no trailing newline
 */
export function buildLogLine(input) {
  const run = input.run ?? new Date().toISOString();
  /** @type {Record<string, unknown>} */
  const line = {
    run,
    findings_count: input.findingsCount,
    new_tasks_filed: input.newTasksFiled,
  };
  if (typeof input.recordsRead === "number") line["records_read"] = input.recordsRead;
  return JSON.stringify(line);
}

/**
 * @callback RunMinsky
 * @param {string} hostDir — the --host target
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */

/**
 * @callback ReadRecords
 * @param {string} hostDir — the --host target whose store is read
 * @returns {Promise<string>} concatenated JSONL content of all cross-repo files
 */

/**
 * @callback AppendLine
 * @param {string} logPath
 * @param {string} line — JSONL line WITHOUT trailing newline
 * @returns {Promise<void>}
 */

/**
 * Orchestrate one cadence run: invoke the bounded single iteration, read the
 * records it wrote, count findings + filed tasks, append the ledger line, and
 * return a structured summary the workflow turns into a `--json` payload + the
 * "open a draft PR when findings > 0" decision.
 *
 * Pure orchestration over injected seams — tests pass fakes; the CLI passes
 * defaultRunMinsky / defaultReadRecords / defaultAppendLine.
 *
 * @param {{
 *   hostDir: string,
 *   logPath: string,
 *   run?: string,
 *   runMinsky: RunMinsky,
 *   readRecords: ReadRecords,
 *   appendLine: AppendLine,
 * }} deps
 * @returns {Promise<{
 *   findingsCount: number,
 *   newTasksFiled: number,
 *   recordsRead: number,
 *   droppedLines: number,
 *   iterationCode: number,
 *   shouldOpenPr: boolean,
 *   logLine: string,
 * }>}
 */
export async function runObserverDogfood(deps) {
  const { hostDir, logPath, run, runMinsky, readRecords, appendLine } = deps;
  const iteration = await runMinsky(hostDir);
  const text = await readRecords(hostDir);
  const { records, dropped } = parseRecords(text);
  const findingsCount = countFindings(records);
  const newTasksFiled = countTasksFiled(records);
  const logLine = buildLogLine({
    ...(run !== undefined ? { run } : {}),
    findingsCount,
    newTasksFiled,
    recordsRead: records.length,
  });
  await appendLine(logPath, logLine);
  return {
    findingsCount,
    newTasksFiled,
    recordsRead: records.length,
    droppedLines: dropped,
    iterationCode: iteration.code,
    shouldOpenPr: findingsCount > 0,
    logLine,
  };
}

/**
 * Production seam: shell `minsky run --once --no-live --host <dir>`. Resolves
 * with the captured stdout/stderr/code regardless of exit code — a non-zero
 * iteration is itself signal (the run failed, which is a finding the records
 * capture), not a reason to crash the cadence.
 *
 * @type {RunMinsky}
 */
export const defaultRunMinsky = (hostDir) =>
  new Promise((resolvePromise) => {
    const bin = resolve(REPO_ROOT, "bin", "minsky");
    execFile(
      "bash",
      [bin, "run", "--once", "--no-live", "--host", hostDir],
      { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err && typeof err.code === "number" ? err.code : 0;
        resolvePromise({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          code,
        });
      },
    );
  });

/**
 * Production seam: read + concatenate every cross-repo JSONL file under the
 * host's experiment-store. Returns "" when the store is absent (a host that
 * has not yet run an iteration) — graceful-degrade, not a crash.
 *
 * @type {ReadRecords}
 */
export const defaultReadRecords = async (hostDir) => {
  const dir = resolve(hostDir, CROSS_REPO_STORE_REL);
  if (!existsSync(dir)) return "";
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir);
  const files = entries.filter((e) => e.endsWith(".jsonl"));
  const parts = await Promise.all(files.map((f) => readFile(resolve(dir, f), "utf8")));
  return parts.join("\n");
};

/**
 * Production seam: append a JSONL line to the ledger, creating the parent dir
 * on first run.
 *
 * @type {AppendLine}
 */
export const defaultAppendLine = async (logPath, line) => {
  mkdirSync(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${line}\n`, "utf8");
};

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("observer-dogfood-runner.mjs");
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const hostArg = args.find((a) => a.startsWith("--host="));
  const logArg = args.find((a) => a.startsWith("--log="));
  const json = args.includes("--json");
  const hostDir = hostArg ? hostArg.slice("--host=".length) : REPO_ROOT;
  const logPath = logArg ? logArg.slice("--log=".length) : DEFAULT_LOG_PATH;
  const summary = await runObserverDogfood({
    hostDir,
    logPath,
    runMinsky: defaultRunMinsky,
    readRecords: defaultReadRecords,
    appendLine: defaultAppendLine,
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } else {
    process.stdout.write(
      `observer-dogfood: ${summary.findingsCount} finding(s), ` +
        `${summary.newTasksFiled} task(s) filed, ` +
        `${summary.recordsRead} record(s) read ` +
        `(open-pr: ${summary.shouldOpenPr}). Logged to ${logPath}.\n`,
    );
  }
  // Exit 0 — the cadence run itself succeeded even when findings > 0; the
  // workflow decides whether to open a PR from `shouldOpenPr`, not the exit
  // code. (A non-zero exit would fail the cron and lose the appended record.)
  process.exit(0);
}
