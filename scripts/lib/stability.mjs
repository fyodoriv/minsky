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
 * @property {string} [verdict] "validated" | "spawn-failed" | "scope-leak" | ...
 */

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
 * @property {"experiment-store" | "no-data" | "no-recent-data"} source
 */

/**
 * Compute the stability ratio for a single window over a fixed record set.
 * Pure function — no I/O, no side effects, fully deterministic given
 * `records`, `windowLabel`, and `now`.
 *
 * @param {object} inputs
 * @param {readonly IterationRecord[]} inputs.records
 * @param {string} inputs.windowLabel
 * @param {number} inputs.now epoch ms — injected so tests are deterministic
 * @param {"experiment-store" | "no-data"} inputs.sourceWhenNoMatch source field to use if no records match
 * @returns {StabilityWindowResult}
 */
export function computeStabilityForWindow({ records, windowLabel, now, sourceWhenNoMatch }) {
  const windowMs = windowToMs(windowLabel);
  const cutoff = now - windowMs;
  const inWindow = records.filter((r) => {
    const ts = new Date(r.ts).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
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
  const successful = inWindow.filter((r) => r.verdict === "validated").length;
  const total = inWindow.length;
  return {
    window: windowLabel,
    successful,
    total,
    ratio: successful / total,
    source: "experiment-store",
  };
}

/**
 * Convenience wrapper: read the experiment store for a host and compute
 * stability over a list of windows. Preserves CLI window order.
 *
 * @param {object} inputs
 * @param {string} inputs.hostDir
 * @param {readonly string[]} inputs.windowLabels
 * @param {number} [inputs.now] defaults to Date.now()
 * @returns {readonly StabilityWindowResult[]}
 */
export function computeHostStability({ hostDir, windowLabels, now = Date.now() }) {
  const { records, source } = readExperimentStore(hostDir);
  return windowLabels.map((label) =>
    computeStabilityForWindow({
      records,
      windowLabel: label,
      now,
      sourceWhenNoMatch: source,
    }),
  );
}
