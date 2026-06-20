#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved implements session-converts-repo-ledger-bootstrap — M1.5/M1.7 metrics collector -->
// Compute M1.5 (session_converts_repo) and M1.7 (baseline_delta_per_cycle)
// from .minsky/session-ledger.jsonl.
//
// session_converts_repo: fraction of non-no-task iterations where
//   files_changed > 0 (the session actually mutated the repo).
// baseline_delta_per_cycle: median loc_delta across the window.
//
// Anchor: Forsgren/Humble/Kim, Accelerate 2018 — DORA deployment frequency
//   and lead-time metrics are derivable from a per-iteration ledger.
//   Munafò et al. 2017, Nature Human Behaviour — pre-registration requires
//   the measurement infrastructure to exist before the metric is reported.
//
// Usage:
//   node scripts/compute-session-metrics.mjs [--window=7d] [--json]
//   node scripts/compute-session-metrics.mjs --ledger=<path> [--window=7d] [--json]

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const ROOT = process.cwd();

/** @param {number[]} arr */
function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

/** @param {string} w */
function parseWindow(w) {
  const m = /^(?<count>\d+)(?<unit>d|h)$/.exec(w);
  if (!m?.groups) throw new Error(`invalid --window value: ${w}`);
  const n = Number.parseInt(m.groups["count"] ?? "0", 10);
  return m.groups["unit"] === "d" ? n * 86400_000 : n * 3600_000;
}

/** @param {string[]} args */
function parseArgs(args) {
  let windowStr = "7d";
  let jsonMode = false;
  let ledgerPath = join(ROOT, ".minsky/session-ledger.jsonl");
  for (const arg of args) {
    if (arg.startsWith("--window=")) windowStr = arg.slice(9);
    else if (arg === "--json") jsonMode = true;
    else if (arg.startsWith("--ledger=")) ledgerPath = resolve(arg.slice(9));
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: compute-session-metrics.mjs [--window=7d] [--json] [--ledger=<path>]\n",
      );
      process.exit(0);
    }
  }
  return { windowStr, jsonMode, ledgerPath };
}

/**
 * @typedef {{ session_converts_repo: number|null, baseline_delta_per_cycle: number|null, n: number, window: string, error?: string }} Metrics
 */

/** @param {string} ledgerPath @param {number} cutoff */
function readEntries(ledgerPath, cutoff) {
  const lines = readFileSync(ledgerPath, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  return lines
    .map((l) => {
      try {
        return /** @type {Record<string, unknown>} */ (JSON.parse(l));
      } catch {
        return null;
      }
    })
    .filter(
      (e) =>
        e !== null && e["verdict"] !== "no-task" && new Date(String(e["ts"])).getTime() >= cutoff,
    );
}

/** @param {Metrics} result @param {boolean} jsonMode @param {number} converts */
function printResult(result, jsonMode, converts) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const scr = result.session_converts_repo;
  const bdc = result.baseline_delta_per_cycle;
  process.stdout.write(
    `session_converts_repo: ${scr === null ? "null" : scr.toFixed(4)} (n=${result.n}, converts=${converts})\n`,
  );
  process.stdout.write(
    `baseline_delta_per_cycle: ${bdc === null ? "null" : bdc} loc (median over ${result.window})\n`,
  );
}

function main() {
  const { windowStr, jsonMode, ledgerPath } = parseArgs(process.argv.slice(2));
  const windowMs = parseWindow(windowStr);
  const cutoff = Date.now() - windowMs;

  if (!existsSync(ledgerPath)) {
    /** @type {Metrics} */
    const result = {
      session_converts_repo: null,
      baseline_delta_per_cycle: null,
      n: 0,
      window: windowStr,
      error: "ledger not found",
    };
    printResult(result, jsonMode, 0);
    process.exit(0);
  }

  const entries = readEntries(ledgerPath, cutoff);
  const n = entries.length;
  const converts = entries.filter((e) => (e?.["files_changed"] ?? 0) > 0).length;
  const session_converts_repo = n === 0 ? null : converts / n;
  const locDeltas = entries.map((e) => Number(e?.["loc_delta"] ?? 0));
  const baseline_delta_per_cycle = n === 0 ? null : median(locDeltas);

  /** @type {Metrics} */
  const result = { session_converts_repo, baseline_delta_per_cycle, n, window: windowStr };
  printResult(result, jsonMode, converts);
}

main();
