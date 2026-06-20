#!/usr/bin/env node
// @ts-check
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
  const n = parseInt(m.groups["count"] ?? "0", 10);
  return m.groups["unit"] === "d" ? n * 86400_000 : n * 3600_000;
}

function main() {
  const args = process.argv.slice(2);
  let windowStr = "7d";
  let jsonMode = false;
  let ledgerPath = join(ROOT, ".minsky/session-ledger.jsonl");

  for (const arg of args) {
    if (arg.startsWith("--window=")) windowStr = arg.slice(9);
    else if (arg === "--json") jsonMode = true;
    else if (arg.startsWith("--ledger=")) ledgerPath = resolve(arg.slice(9));
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: compute-session-metrics.mjs [--window=7d] [--json] [--ledger=<path>]",
      );
      process.exit(0);
    }
  }

  const windowMs = parseWindow(windowStr);
  const cutoff = Date.now() - windowMs;

  if (!existsSync(ledgerPath)) {
    const result = {
      session_converts_repo: null,
      baseline_delta_per_cycle: null,
      n: 0,
      window: windowStr,
      error: "ledger not found",
    };
    if (jsonMode) {
      console.log(JSON.stringify(result));
    } else {
      console.log(
        `session_converts_repo: null (ledger not found at ${ledgerPath})`,
      );
      console.log("baseline_delta_per_cycle: null");
    }
    process.exit(0);
  }

  const lines = readFileSync(ledgerPath, "utf8")
    .split("\n")
    .filter((l) => l.trim());

  /** @type {Array<{session_id:string,ts:string,task_id:string,verdict:string,files_changed:number,loc_delta:number}>} */
  const entries = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(
      (e) =>
        e !== null &&
        e.verdict !== "no-task" &&
        new Date(e.ts).getTime() >= cutoff,
    );

  const n = entries.length;
  const converts = entries.filter((e) => (e.files_changed ?? 0) > 0).length;
  const session_converts_repo = n === 0 ? null : converts / n;
  const locDeltas = entries.map((e) => e.loc_delta ?? 0);
  const baseline_delta_per_cycle = n === 0 ? null : median(locDeltas);

  const result = {
    session_converts_repo,
    baseline_delta_per_cycle,
    n,
    window: windowStr,
  };

  if (jsonMode) {
    console.log(JSON.stringify(result));
  } else {
    console.log(
      `session_converts_repo: ${session_converts_repo === null ? "null" : session_converts_repo.toFixed(4)} (n=${n}, converts=${converts})`,
    );
    console.log(
      `baseline_delta_per_cycle: ${baseline_delta_per_cycle === null ? "null" : baseline_delta_per_cycle} loc (median over ${windowStr})`,
    );
  }
}

main();
