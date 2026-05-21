#!/usr/bin/env node
// Fleet stability report — aggregate iteration-success ratios across
// multiple minsky hosts on the same filesystem (NFS / iCloud / Dropbox /
// just a list of local repo paths).
//
// Usage:
//   node scripts/fleet-stability-report.mjs --host /path/to/host-a --host /path/to/host-b
//   MINSKY_FLEET_HOSTS=/path/to/host-a:/path/to/host-b \
//     node scripts/fleet-stability-report.mjs --json
//   node scripts/fleet-stability-report.mjs --window=24h --window=7d --json
//
// Output (--json):
//   {
//     hosts: [
//       {host: "/path/...", windows: [{window, successful, total, ratio}, ...]},
//       {host: "/missing/...", error: "host-not-found"},
//       ...
//     ],
//     fleet: {
//       window_summary: [
//         {window, successful_sum, total_sum, ratio (decimal 0.0–1.0)},
//         ...
//       ],
//       host_count: N,  // number of hosts with valid data (not counting missing)
//     },
//     generated_at: "<iso>"
//   }
//
// `ratio` fields are always decimal 0.0–1.0, never percentage.
// `window_summary` preserves CLI window order (canonical [10h, 24h, 7d, 30d]
// when no --window flag specified).
//
// Exit code: 0 if ≥1 host returned valid data; 1 if all hosts failed OR
// no hosts were specified.
//
// Pattern: SLI/SLO measurement aggregated across hosts — Beyer et al.
//   2016, *SRE*, Ch. 4.
// Source: docs/plans/fleet-stability-centralized-reporting.md § Step 2.
// Conformance: full — pure aggregation over the shared helper.

import { existsSync } from "node:fs";
import { CANONICAL_WINDOWS, computeHostStability } from "./lib/stability.mjs";

/**
 * Pull a `--flag=value` or `--flag value` argument out of argv starting
 * at index `i`. Returns the value (string) and the new index. If the
 * flag wasn't matched, returns `null`.
 *
 * @param {readonly string[]} argv
 * @param {number} i
 * @param {string} flag the flag name, e.g. "--host"
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
 * Parse the colon-separated MINSKY_FLEET_HOSTS env var into a list of
 * host paths (empty list when unset).
 * @returns {readonly string[]}
 */
function readEnvHosts() {
  const raw = process.env["MINSKY_FLEET_HOSTS"];
  if (!raw) return [];
  return raw
    .split(":")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
}

/**
 * @param {readonly string[]} argv
 * @returns {{ hosts: readonly string[], windows: readonly string[], jsonMode: boolean, now: number }}
 */
function parseArgv(argv) {
  /** @type {string[]} */
  const hosts = [];
  /** @type {string[]} */
  const windows = [];
  const state = { jsonMode: false, now: Date.now() };
  /** @type {Array<{ flag: string, apply: (v: string) => void }>} */
  const handlers = [
    { flag: "--host", apply: (v) => hosts.push(v) },
    { flag: "--window", apply: (v) => windows.push(v) },
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
  // Env-var fallback when --host not supplied.
  if (hosts.length === 0) {
    hosts.push(...readEnvHosts());
  }
  return {
    hosts,
    windows: windows.length > 0 ? windows : CANONICAL_WINDOWS,
    jsonMode: state.jsonMode,
    now: state.now,
  };
}

const { hosts, windows, jsonMode, now } = parseArgv(process.argv.slice(2));

if (hosts.length === 0) {
  if (jsonMode) {
    console.log(
      JSON.stringify({
        hosts: [],
        fleet: { window_summary: [], host_count: 0 },
        error: "no-hosts-specified",
        generated_at: new Date(now).toISOString(),
      }),
    );
  } else {
    console.error(
      "No hosts specified. Pass --host <path> (repeatable) or set MINSKY_FLEET_HOSTS=path1:path2:...",
    );
  }
  process.exit(1);
}

/**
 * @typedef {object} PerHostEntry
 * @property {string} host
 * @property {readonly import("./lib/stability.mjs").StabilityWindowResult[]} [windows]
 * @property {string} [error]
 */

/** @type {PerHostEntry[]} */
const perHost = [];
let validHostCount = 0;

for (const hostPath of hosts) {
  if (!existsSync(hostPath)) {
    perHost.push({ host: hostPath, error: "host-not-found" });
    continue;
  }
  try {
    const windowsResult = computeHostStability({ hostDir: hostPath, windowLabels: windows, now });
    perHost.push({ host: hostPath, windows: windowsResult });
    validHostCount += 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    perHost.push({ host: hostPath, error: `compute-failed: ${msg}` });
  }
}

// Aggregate. For each window, sum successful and total across valid
// hosts; recompute ratio as sum_successful / sum_total. Null when no
// valid host had data for that window.
const windowSummary = windows.map((label) => {
  let successfulSum = 0;
  let totalSum = 0;
  for (const entry of perHost) {
    if (!entry.windows) continue;
    const row = entry.windows.find((w) => w.window === label);
    if (!row) continue;
    successfulSum += row.successful;
    totalSum += row.total;
  }
  return {
    window: label,
    successful_sum: successfulSum,
    total_sum: totalSum,
    ratio: totalSum > 0 ? successfulSum / totalSum : null,
  };
});

const output = {
  hosts: perHost,
  fleet: {
    window_summary: windowSummary,
    host_count: validHostCount,
  },
  generated_at: new Date(now).toISOString(),
};

if (jsonMode) {
  console.log(JSON.stringify(output));
} else {
  // Human-readable: per-host lines + fleet summary line.
  console.log(`Fleet stability (hosts: ${validHostCount}/${hosts.length} valid)`);
  for (const entry of perHost) {
    if (entry.error) {
      console.log(`  ${entry.host}: ERROR (${entry.error})`);
      continue;
    }
    const w7d = entry.windows?.find((w) => w.window === "7d");
    if (w7d && w7d.ratio !== null) {
      const pct = Math.round(w7d.ratio * 100);
      console.log(`  ${entry.host}: 7d=${pct}% (${w7d.successful}/${w7d.total})`);
    } else {
      console.log(`  ${entry.host}: 7d=no data`);
    }
  }
  console.log("Fleet aggregate:");
  for (const ws of windowSummary) {
    if (ws.ratio === null) {
      console.log(`  ${ws.window}: no data`);
    } else {
      const pct = Math.round(ws.ratio * 100);
      console.log(
        `  ${ws.window}: ${pct}% (${ws.successful_sum}/${ws.total_sum} across ${validHostCount} host(s))`,
      );
    }
  }
}

process.exit(validHostCount > 0 ? 0 : 1);
