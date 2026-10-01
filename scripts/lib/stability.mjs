// Pure functions for computing minsky's iteration-success stability ratio
// from `.minsky/experiment-store/cross-repo/*.jsonl` ledger records.
//
// Pattern: SLI/SLO measurement — Beyer et al. 2016, *Site Reliability
//   Engineering*, Ch. 4. Stability ratio = successful_iterations /
//   total_iterations over a time window. The single numeric SLI for
//   minsky's loop.
// Source: TASKS.md `fleet-stability-centralized-reporting`; rule #1
//   (extract the helper instead of duplicating between stability-number
//   and stability-report).
// Conformance: full — pure functions over injected I/O seams.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Window labels supported by the stability report.
 * @typedef {"10h" | "24h" | "7d" | "30d"} WindowLabel
 */

/**
 * Canonical window order — what `stability-report.mjs` defaults to when
 * `--window` is not supplied. Also the canonical sort order used by
 * downstream consumers when they need a stable presentation.
 */
export const CANONICAL_WINDOWS = /** @type {const} */ (["10h", "24h", "7d", "30d"]);

/**
 * Convert a window label to milliseconds.
 * @param {string} label
 * @returns {number}
 * @throws {Error} when the label is not recognized
 */
export function windowToMs(label) {
  switch (label) {
    case "10h":
      return 10 * 60 * 60 * 1000;
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
    default:
      throw new Error(
        `unknown window label: ${label} (expected one of ${CANONICAL_WINDOWS.join(", ")})`,
      );
  }
}

/**
 * @typedef {object} IterationRecord
 * @property {string} ts ISO-8601 timestamp
 * @property {string} [verdict] "validated" | "spawn-failed" | "scope-leak" | "drained" | ...
 * @property {string} [notes] free-text breadcrumb written by the runner
 */

/**
 * A record counts toward the stability SLI only when it represents the
 * runner actually attempting a task. Drained-queue ticks ("no eligible
 * task") are bookkeeping events, not iterations: counting them in the
 * denominator poisons stability with idle-time noise (observed 2026-06-10:
 * ~6000 drained records vs 10 real iterations over 2 days → 24h stability
 * read 0% while the true task-attempt ratio was non-zero). Valid-event
 * qualification per Beyer et al. 2016, *SRE*, Ch. 4 — an SLI must define
 * which received events count as valid before computing the ratio.
 *
 * Verdict `drained` is the canonical marker (bin/minsky-run.sh, 2026-06-11);
 * the legacy shape (`verdict: "aborted"` + `notes: "no eligible task"`) is
 * excluded too so historical ledgers compute correctly.
 *
 * @param {IterationRecord} record
 * @returns {boolean}
 */
export function isTaskAttempt(record) {
  if (record.verdict === "drained") return false;
  if (record.verdict === "aborted" && record.notes === "no eligible task") return false;
  return true;
}

/**
 * Parse a single .jsonl file into an array of records. Malformed lines
 * are silently skipped (per rule #6: let-it-crash AT the right boundary
 * — a single malformed line should not crash the whole report).
 *
 * @param {string} path absolute path to a `.jsonl` file
 * @returns {readonly IterationRecord[]}
 */
function parseJsonlFile(path) {
  /** @type {IterationRecord[]} */
  const records = [];
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Skip malformed line — see rule #6 above.
    }
  }
  return records;
}

/**
 * Read every `.jsonl` file under the host's `experiment-store/cross-repo/`
 * directory and parse each line as a record.
 *
 * @param {string} hostDir absolute path to the host repo root
 * @returns {{ records: readonly IterationRecord[], source: "experiment-store" | "no-data" }}
 */
export function readExperimentStore(hostDir) {
  const storeDir = join(hostDir, ".minsky", "experiment-store", "cross-repo");
  if (!existsSync(storeDir)) {
    return { records: [], source: "no-data" };
  }
  const jsonlFiles = readdirSync(storeDir).filter((f) => f.endsWith(".jsonl"));
  /** @type {IterationRecord[]} */
  const records = [];
  for (const file of jsonlFiles) {
    records.push(...parseJsonlFile(join(storeDir, file)));
  }
  return { records, source: "experiment-store" };
}

/**
 * @typedef {object} StabilityWindowResult
 * @property {string} window
 * @property {number} successful
 * @property {number} total
 * @property {number | null} ratio decimal 0.0–1.0, or null when no data
 * @property {"session-ledger" | "experiment-store" | "no-data" | "no-recent-data"} source
 */

/**
 * Read `.minsky/session-ledger.jsonl` — the PRIMARY iteration record source
 * written by `bin/minsky-run.sh` after every non-no-task iteration (PR #1250).
 * The experiment-store path becomes a FALLBACK for pre-#1250 historical data.
 *
 * @param {string} hostDir absolute path to the host repo root
 * @returns {{ records: readonly IterationRecord[], source: "session-ledger" | "no-data" }}
 */
export function readSessionLedger(hostDir) {
  const ledgerPath = join(hostDir, ".minsky", "session-ledger.jsonl");
  if (!existsSync(ledgerPath)) {
    return { records: [], source: "no-data" };
  }
  return { records: parseJsonlFile(ledgerPath), source: "session-ledger" };
}

/**
 * Returns true when a session-ledger verdict represents a successful iteration.
 * "shipped" = PR opened; "merged" = PR merged; "validated" = PR passed CI.
 * "planned" and "spawn-failed" are failures; "drained" is excluded by isTaskAttempt.
 *
 * @param {IterationRecord} record
 * @returns {boolean}
 */
export function isSessionLedgerSuccess(record) {
  return (
    record.verdict === "validated" || record.verdict === "merged" || record.verdict === "shipped"
  );
}

/**
 * Compute the stability ratio for a single window over a fixed record set.
 * Pure function — no I/O, no side effects, fully deterministic given
 * `records`, `windowLabel`, and `now`.
 *
 * @param {object} inputs
 * @param {readonly IterationRecord[]} inputs.records
 * @param {string} inputs.windowLabel
 * @param {number} inputs.now epoch ms — injected so tests are deterministic
 * @param {"session-ledger" | "experiment-store" | "no-data"} inputs.sourceWhenNoMatch source field to use if no records match
 * @param {(r: IterationRecord) => boolean} [inputs.isSuccess] predicate for counting a record as successful; defaults to verdict==="validated"
 * @param {"session-ledger" | "experiment-store"} [inputs.hitSource] source label to use when records ARE found
 * @returns {StabilityWindowResult}
 */
export function computeStabilityForWindow({
  records,
  windowLabel,
  now,
  sourceWhenNoMatch,
  isSuccess = (r) => r.verdict === "validated",
  hitSource = "experiment-store",
}) {
  const windowMs = windowToMs(windowLabel);
  const cutoff = now - windowMs;
  const inWindow = records.filter((r) => {
    const ts = new Date(r.ts).getTime();
    return Number.isFinite(ts) && ts >= cutoff && isTaskAttempt(r);
  });
  if (inWindow.length === 0) {
    return {
      window: windowLabel,
      successful: 0,
      total: 0,
      ratio: null,
      source: sourceWhenNoMatch === "no-data" ? "no-data" : "no-recent-data",
    };
  }
  const successful = inWindow.filter(isSuccess).length;
  const total = inWindow.length;
  return {
    window: windowLabel,
    successful,
    total,
    ratio: successful / total,
    source: hitSource,
  };
}

/**
 * Convenience wrapper: read the session-ledger (primary) or experiment store
 * (fallback) for a host and compute stability over a list of windows.
 * Preserves CLI window order.
 *
 * @param {object} inputs
 * @param {string} inputs.hostDir
 * @param {readonly string[]} inputs.windowLabels
 * @param {number} [inputs.now] defaults to Date.now()
 * @returns {readonly StabilityWindowResult[]}
 */
export function computeHostStability({ hostDir, windowLabels, now = Date.now() }) {
  const ledger = readSessionLedger(hostDir);
  const useLedger = ledger.records.length > 0;
  const { records, source } = useLedger ? ledger : readExperimentStore(hostDir);
  const isSuccess = useLedger
    ? isSessionLedgerSuccess
    : (/** @type {IterationRecord} */ r) => r.verdict === "validated";
  const hitSource = useLedger
    ? /** @type {const} */ ("session-ledger")
    : /** @type {const} */ ("experiment-store");
  return windowLabels.map((label) =>
    computeStabilityForWindow({
      records,
      windowLabel: label,
      now,
      sourceWhenNoMatch: source,
      isSuccess,
      hitSource,
    }),
  );
}
