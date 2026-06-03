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
//   node scripts/fleet-stability-report.mjs --host a --host b --html > fleet.html
//
// `--html` runs the SAME aggregation as `--json` and renders a single
// self-contained HTML page (no external CSS/JS, no network) — a table of
// {host, last-iteration time, success/total, ratio, error-count} plus a
// fleet roll-up row. The operator opens one file instead of SSHing into
// every host. `--json` wins when both flags are passed (machine output first).
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
import { CANONICAL_WINDOWS, computeHostStability, readExperimentStore } from "./lib/stability.mjs";

/**
 * Most-recent iteration timestamp (ISO-8601) across ALL of a host's records,
 * independent of any window — the "when did this machine last run" column.
 * Returns "no data" when the host has no parseable records. Pure read over
 * the shared helper (rule #1 — no duplicate jsonl parser).
 *
 * @param {string} hostDir
 * @returns {string}
 */
function lastIterationTime(hostDir) {
  const { records } = readExperimentStore(hostDir);
  let latest = Number.NEGATIVE_INFINITY;
  for (const r of records) {
    const ts = new Date(r.ts).getTime();
    if (Number.isFinite(ts) && ts > latest) latest = ts;
  }
  return latest === Number.NEGATIVE_INFINITY ? "no data" : new Date(latest).toISOString();
}

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
 * @typedef {{ flag: string, apply: (v: string) => void }} ValueFlagHandler
 */

/**
 * Try each value-taking handler against argv[i]. Returns the index to
 * continue from (advanced past a consumed value), or `i` unchanged when no
 * handler matched. Extracted from `parseArgv` to keep its complexity bounded.
 *
 * @param {readonly string[]} argv
 * @param {number} i
 * @param {readonly ValueFlagHandler[]} handlers
 * @returns {number}
 */
function applyValueFlag(argv, i, handlers) {
  for (const h of handlers) {
    const got = readFlagValue(argv, i, h.flag);
    if (got !== null) {
      h.apply(got.value);
      return got.nextI;
    }
  }
  return i;
}

/**
 * @param {readonly string[]} argv
 * @returns {{ hosts: readonly string[], windows: readonly string[], jsonMode: boolean, htmlMode: boolean, now: number }}
 */
function parseArgv(argv) {
  /** @type {string[]} */
  const hosts = [];
  /** @type {string[]} */
  const windows = [];
  const state = { jsonMode: false, htmlMode: false, now: Date.now() };
  /** @type {Record<string, () => void>} valueless boolean flags */
  const booleanFlags = {
    "--json": () => {
      state.jsonMode = true;
    },
    "--html": () => {
      state.htmlMode = true;
    },
  };
  /** @type {ValueFlagHandler[]} value-taking flags */
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
    const arg = argv[i];
    const boolHandler = arg !== undefined ? booleanFlags[arg] : undefined;
    if (boolHandler !== undefined) {
      boolHandler();
      continue;
    }
    i = applyValueFlag(argv, i, handlers);
  }
  // Env-var fallback when --host not supplied.
  if (hosts.length === 0) {
    hosts.push(...readEnvHosts());
  }
  return {
    hosts,
    windows: windows.length > 0 ? windows : CANONICAL_WINDOWS,
    jsonMode: state.jsonMode,
    htmlMode: state.htmlMode,
    now: state.now,
  };
}

/**
 * Escape the five XML/HTML metacharacters so a host path (which can contain
 * arbitrary filesystem chars) cannot break out of an attribute or inject
 * markup. No template engine — a 5-char replace keeps the renderer
 * dependency-free per rule #1.
 *
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Format a decimal ratio (0.0–1.0) or null as a percent string for display.
 * @param {number | null | undefined} ratio
 * @returns {string}
 */
function fmtRatio(ratio) {
  return ratio === null || ratio === undefined ? "—" : `${Math.round(ratio * 100)}%`;
}

/**
 * Build one per-host `<tr>`. Error hosts (missing / compute-failed) still get
 * a row (rule #4 — if you can't see it, it doesn't exist); valid hosts carry
 * {last-iteration time, success/total, ratio, error-count} for `primaryWindow`.
 *
 * @param {PerHostEntry} entry
 * @param {string} primaryWindow
 * @returns {string}
 */
function renderHostRow(entry, primaryWindow) {
  const hostCell = escapeHtml(entry.host);
  if (entry.error) {
    return `<tr class="host-error"><td>${hostCell}</td><td>—</td><td>—</td><td>—</td><td class="err">${escapeHtml(entry.error)}</td></tr>`;
  }
  const win = entry.windows?.find((w) => w.window === primaryWindow);
  const successful = win ? win.successful : 0;
  const total = win ? win.total : 0;
  const ratio = win ? win.ratio : null;
  // Last-iteration time: the most-recent ts across ALL records for the host,
  // independent of window (operators want "when did this machine last run").
  const lastIso = lastIterationTime(entry.host);
  return `<tr><td>${hostCell}</td><td>${escapeHtml(lastIso)}</td><td>${successful}/${total}</td><td>${fmtRatio(ratio)}</td><td>${total - successful}</td></tr>`;
}

/**
 * Render the aggregated report as a single self-contained HTML page. Pure
 * function over the SAME `output` object the `--json` path emits, plus the
 * resolved `windowLabels` (so the displayed window matches the request).
 * No external CSS/JS — the operator opens one file with no network round-trip.
 *
 * The per-host table carries {host, last-iteration time, success/total, ratio,
 * error-count}; the final fleet roll-up row sums success/total across valid
 * hosts.
 *
 * @param {object} inputs
 * @param {{
 *   hosts: PerHostEntry[],
 *   fleet: { window_summary: Array<{ window: string, successful_sum: number, total_sum: number, ratio: number | null }>, host_count: number },
 *   generated_at: string,
 * }} inputs.output
 * @param {readonly string[]} inputs.windowLabels
 * @returns {string}
 */
function renderHtml({ output, windowLabels }) {
  // Default the headline window to "7d" when present, else the first label
  // (empty string when no window labels — keeps `primaryWindow` a string).
  const primaryWindow = windowLabels.includes("7d") ? "7d" : (windowLabels[0] ?? "");
  const rows = output.hosts.map((entry) => renderHostRow(entry, primaryWindow));
  const fleetWin =
    output.fleet.window_summary.find((w) => w.window === primaryWindow) ??
    output.fleet.window_summary[0];
  const fleetSuccessful = fleetWin ? fleetWin.successful_sum : 0;
  const fleetTotal = fleetWin ? fleetWin.total_sum : 0;
  const fleetRatio = fleetWin ? fleetWin.ratio : null;
  const fleetRow = `<tr class="fleet"><td>Fleet (${output.fleet.host_count} host(s))</td><td>—</td><td>${fleetSuccessful}/${fleetTotal}</td><td>${fmtRatio(fleetRatio)}</td><td>${fleetTotal - fleetSuccessful}</td></tr>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Minsky fleet stability — ${escapeHtml(primaryWindow)}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
h1 { font-size: 1.3rem; }
table { border-collapse: collapse; width: 100%; max-width: 60rem; }
th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; }
th { background: #f0f0f0; }
tr.fleet { font-weight: 600; background: #eef6ff; }
tr.host-error td.err { color: #b00020; }
.meta { color: #666; font-size: 0.85rem; margin-top: 1rem; }
</style>
</head>
<body>
<h1>Minsky fleet stability — window ${escapeHtml(primaryWindow)}</h1>
<table>
<thead>
<tr><th>Host</th><th>Last iteration</th><th>Success / total</th><th>Ratio</th><th>Errors</th></tr>
</thead>
<tbody>
${rows.join("\n")}
${fleetRow}
</tbody>
</table>
<p class="meta">Generated at ${escapeHtml(output.generated_at)} · windows: ${escapeHtml(windowLabels.join(", "))}</p>
</body>
</html>
`;
}

const { hosts, windows, jsonMode, htmlMode, now } = parseArgv(process.argv.slice(2));

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
  } else if (htmlMode) {
    console.log(
      renderHtml({
        output: {
          hosts: [],
          fleet: { window_summary: [], host_count: 0 },
          generated_at: new Date(now).toISOString(),
        },
        windowLabels: windows,
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
  // `--json` keeps the byte-identical shape existing consumers parse; when
  // both --json and --html are passed, --json wins (machine output first).
  console.log(JSON.stringify(output));
} else if (htmlMode) {
  console.log(renderHtml({ output, windowLabels: windows }));
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
