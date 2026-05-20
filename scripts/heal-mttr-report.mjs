#!/usr/bin/env node
// Compute MTTR (mean-time-to-recovery) stats for catalogued automated
// heals from .minsky/heal-events.jsonl. Drives the `mttr-self-heal`
// METRICS.md row.
//
// Usage:
//   node scripts/heal-mttr-report.mjs [--host-dir <path>] [--window=24h|7d|30d]... [--now=<iso>] [--json]
//
// Multi-window: pass --window multiple times to get one row per window.
// Default windows: 24h, 7d, 30d.
//
// Output (JSON mode): array of one element per window with:
//   { window, attempted, successful, mttr_p50_ms, mttr_p95_ms, source }
//
// source: "heal-events" when the ledger has data in the window,
//         "no-data" when ledger is missing or window is empty.
//
// User-story: 007-agent-self-heals-catalogued-failures.md
// Scenarios:
//   - "heal-mttr-report computes correct stats for a multi-window query"
//   - "heal-mttr-report returns no-data source when ledger is missing or empty"
//   - "heal-mttr-report only counts events whose ts_observed is within the window"

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");

let hostDir = process.cwd();
/** @type {string | null} */
let nowIso = null;
/** @type {string[]} */
const windows = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--host-dir") {
    hostDir = args[++i] ?? process.cwd();
  } else if (a?.startsWith("--host-dir=")) {
    hostDir = a.slice("--host-dir=".length);
  } else if (a === "--now") {
    nowIso = args[++i] ?? null;
  } else if (a?.startsWith("--now=")) {
    nowIso = a.slice("--now=".length);
  } else if (a === "--window") {
    const w = args[++i];
    if (w) windows.push(w);
  } else if (a?.startsWith("--window=")) {
    windows.push(a.slice("--window=".length));
  } else if (a === "--json") {
    // already handled
  } else if (a === "--help" || a === "-h") {
    console.log(
      "Usage: heal-mttr-report.mjs [--host-dir <path>] [--window=24h|7d|30d]... [--now=<iso>] [--json]",
    );
    process.exit(0);
  }
}

if (windows.length === 0) {
  windows.push("24h", "7d", "30d");
}

const nowMs = nowIso ? new Date(nowIso).getTime() : Date.now();

/**
 * Parse a window string like "24h", "7d", "30d" → milliseconds. Throws on bad input.
 * @param {string} window
 * @returns {number}
 */
export function parseWindowMs(window) {
  const match = /^(\d+)([hdw])$/.exec(window);
  if (!match) throw new Error(`bad window: ${window}`);
  const n = Number(match[1]);
  const unit = match[2];
  if (unit === "h") return n * 60 * 60 * 1000;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  if (unit === "w") return n * 7 * 24 * 60 * 60 * 1000;
  throw new Error(`bad unit: ${unit}`);
}

/**
 * @typedef {object} HealEvent
 * @property {string} ts_observed
 * @property {string} ts_fixed
 * @property {string} failure_class
 * @property {string} fix_applied
 * @property {number} duration_ms
 * @property {string} host
 * @property {"healed" | "verified-failed" | "skipped"} outcome
 */

/**
 * Read JSONL events from a ledger file. Returns [] if file missing or unreadable.
 * @param {string} ledgerPath
 * @returns {HealEvent[]}
 */
export function readLedger(ledgerPath) {
  if (!existsSync(ledgerPath)) return [];
  const raw = readFileSync(ledgerPath, "utf8");
  /** @type {HealEvent[]} */
  const events = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
      // rule-6: handled-locally — malformed JSONL line is local recoverable.
      // The reporter must not crash on bad data; skipping is the right call.
    } catch {
      // skip
    }
  }
  return events;
}

/**
 * Compute the p-th percentile of an array of numbers. p in [0,1].
 * @param {number[]} values
 * @param {number} p
 * @returns {number | null}
 */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx] ?? null;
}

/**
 * @typedef {object} WindowStatsRow
 * @property {string} window
 * @property {number} attempted
 * @property {number} successful
 * @property {number | null} mttr_p50_ms
 * @property {number | null} mttr_p95_ms
 * @property {"heal-events" | "no-data"} source
 */

/**
 * Compute the per-window stats for a list of HealEvents.
 * @param {{ events: HealEvent[]; window: string; nowMs: number }} args
 * @returns {WindowStatsRow}
 */
export function computeWindowStats(args) {
  const { events, window, nowMs } = args;
  const windowMs = parseWindowMs(window);
  const cutoffMs = nowMs - windowMs;
  const inWindow = events.filter((/** @type {HealEvent} */ e) => {
    const ts = new Date(e.ts_observed).getTime();
    return ts >= cutoffMs && ts <= nowMs;
  });
  if (inWindow.length === 0) {
    return {
      window,
      attempted: 0,
      successful: 0,
      mttr_p50_ms: null,
      mttr_p95_ms: null,
      source: "no-data",
    };
  }
  const successful = inWindow.filter((/** @type {HealEvent} */ e) => e.outcome === "healed");
  const durations = successful.map((/** @type {HealEvent} */ e) => e.duration_ms);
  return {
    window,
    attempted: inWindow.length,
    successful: successful.length,
    mttr_p50_ms: percentile(durations, 0.5),
    mttr_p95_ms: percentile(durations, 0.95),
    source: "heal-events",
  };
}

// CLI entrypoint — only runs when invoked directly, not on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  const ledgerPath = resolve(hostDir, ".minsky", "heal-events.jsonl");
  const events = readLedger(ledgerPath);
  const rows = windows.map((w) => computeWindowStats({ events, window: w, nowMs }));
  if (jsonMode) {
    console.log(JSON.stringify(rows));
  } else {
    for (const r of rows) {
      if (r.source === "no-data") {
        console.log(`${r.window}: no data`);
      } else {
        const p50 = r.mttr_p50_ms === null ? "n/a" : `${r.mttr_p50_ms}ms`;
        const p95 = r.mttr_p95_ms === null ? "n/a" : `${r.mttr_p95_ms}ms`;
        console.log(`${r.window}: ${r.successful}/${r.attempted} healed; p50=${p50} p95=${p95}`);
      }
    }
  }
}
