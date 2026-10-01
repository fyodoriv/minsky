#!/usr/bin/env node
// Multi-window stability report for one minsky host.
//
// Usage:
//   node scripts/stability-report.mjs                                    # all four canonical windows
//   node scripts/stability-report.mjs --window=10h --window=24h          # selected windows
//   node scripts/stability-report.mjs --window=7d --json                 # JSON array output
//   node scripts/stability-report.mjs --host-dir <path>                  # non-cwd host
//   node scripts/stability-report.mjs --window=7d --now 2026-05-20T15:00:00Z  # deterministic time (tests)
//
// Output (--json):
//   [{window:"10h", successful:N, total:M, ratio:0.0–1.0|null, source:"experiment-store"|"no-data"|"no-recent-data", generated_at:"<iso>"}, ...]
//
// `ratio` is a decimal (0.0–1.0), NOT a percentage. Window order matches CLI order;
// canonical [10h, 24h, 7d, 30d] when no --window flag is supplied.
//
// Pattern: SLI/SLO measurement — Beyer et al. 2016, *SRE*, Ch. 4.
// Source: TASKS.md `fleet-stability-centralized-reporting`; rule #1
//   (reuse `scripts/lib/stability.mjs` instead of duplicating logic from
//   `stability-number.mjs`).
// Conformance: full — thin CLI shell over the pure helper.

import { CANONICAL_WINDOWS, computeHostStability } from "./lib/stability.mjs";

/**
 * Pull a `--flag=value` or `--flag value` argument out of argv starting
 * at index `i`. Returns the value (string) and the new index. If the
 * flag wasn't matched, returns `null`.
 *
 * @param {readonly string[]} argv
 * @param {number} i
 * @param {string} flag the flag name, e.g. "--window"
 * @returns {{ value: string, nextI: number } | null}
 */
function readFlagValue(argv, i, flag) {
  const arg = argv[i];
  if (arg === undefined) return null;
  const eqPrefix = `${flag}=`;
  if (arg.startsWith(eqPrefix)) {
    return { value: arg.slice(eqPrefix.length), nextI: i };
  }
  if (arg === flag) {
    const next = argv[i + 1];
    if (next !== undefined) {
      return { value: next, nextI: i + 1 };
    }
  }
  return null;
}

/**
 * @param {readonly string[]} argv
 * @returns {{ windows: readonly string[], jsonMode: boolean, hostDir: string, now: number }}
 */
function parseArgv(argv) {
  /** @type {string[]} */
  const windows = [];
  const state = { jsonMode: false, hostDir: process.cwd(), now: Date.now() };
  /** @type {Array<{ flag: string, apply: (v: string) => void }>} */
  const handlers = [
    { flag: "--window", apply: (v) => windows.push(v) },
    {
      flag: "--host-dir",
      apply: (v) => {
        state.hostDir = v;
      },
    },
    {
      flag: "--now",
      apply: (v) => {
        state.now = new Date(v).getTime();
      },
    },
  ];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") {
      state.jsonMode = true;
      continue;
    }
    for (const h of handlers) {
      const got = readFlagValue(argv, i, h.flag);
      if (got !== null) {
        h.apply(got.value);
        i = got.nextI;
        break;
      }
    }
  }
  return {
    windows: windows.length > 0 ? windows : CANONICAL_WINDOWS,
    jsonMode: state.jsonMode,
    hostDir: state.hostDir,
    now: state.now,
  };
}

const { windows, jsonMode, hostDir, now } = parseArgv(process.argv.slice(2));

const generatedAt = new Date(now).toISOString();
const results = computeHostStability({ hostDir, windowLabels: windows, now }).map((r) => ({
  ...r,
  generated_at: generatedAt,
}));

if (jsonMode) {
  console.log(JSON.stringify(results));
} else {
  // Human-readable table.
  for (const r of results) {
    if (r.ratio === null) {
      console.log(`${r.window.padEnd(4)}: no data (${r.source})`);
    } else {
      const pct = Math.round(r.ratio * 100);
      console.log(`${r.window.padEnd(4)}: ${pct}% (${r.successful}/${r.total} successful)`);
    }
  }
}
