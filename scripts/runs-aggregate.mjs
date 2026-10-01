// Pure aggregator over per-run summaries written by `scripts/run-summary.mjs`
// (`.minsky/runs/<id>/run-summary.json`). Minsky is NOT always-on: it runs
// only during operator-started sessions (operator directive 2026-06-19
// "don't expect it to be always on; record data when minsky runs"). So
// run-derived metrics are RUN-RELATIVE — windowed by accumulated *runtime*,
// not wall-clock — and segmentable by where minsky ran (`host`) and which
// `minskyVersion` produced the run ("logs as usual honestly").
//
// Two pure reducers consumed by `scripts/collect-metrics.mjs`:
//   - accumulate24h: the most recent 24h of actual runtime (runs newest→
//     oldest, summing uptime until the window fills; the last run is counted
//     partially). Idle calendar gaps never count.
//   - longestRun: the single longest uninterrupted run.
//
// Both accept optional `{ host, minskyVersion }` filters; absent → all runs.
// Pure data in, pure data out (rule #4 — absent input yields null, never a
// fabricated number; Ries 2011 — wrong data is worse than no data).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SEC_PER_DAY = 24 * 60 * 60;

/**
 * @typedef {object} RunSummary
 * @property {string|null} runId
 * @property {string} [startedAt]   ISO
 * @property {string} [endedAt]     ISO
 * @property {number|null} [totalUptimeSec]
 * @property {number|null} [longestUninterruptedSec]
 * @property {number} [restartCount]
 * @property {number} [tasksMerged]
 * @property {string|null} [host]
 * @property {string|null} [minskyVersion]
 */

/**
 * @param {RunSummary[]} runs
 * @param {{ host?: string|null, minskyVersion?: string|null }} [filter]
 * @returns {RunSummary[]}
 */
function applyFilter(runs, filter = {}) {
  const { host, minskyVersion } = filter;
  return runs.filter((r) => {
    if (!r || typeof r !== "object") return false;
    if (host != null && r.host !== host) return false;
    if (minskyVersion != null && r.minskyVersion !== minskyVersion) return false;
    return true;
  });
}

/**
 * Newest-first by endedAt (fall back to startedAt). Drops unparseable.
 * @param {RunSummary[]} runs
 * @returns {RunSummary[]}
 */
function sortNewestFirst(runs) {
  return runs
    .filter((r) => r && Number.isFinite(Date.parse(r.endedAt ?? r.startedAt ?? "")))
    .sort((a, b) => {
      const ta = Date.parse(a.endedAt ?? a.startedAt ?? "");
      const tb = Date.parse(b.endedAt ?? b.startedAt ?? "");
      return tb - ta;
    });
}

/**
 * The most recent `windowSec` (default 24h) of ACCUMULATED runtime.
 * Walk runs newest→oldest, summing `totalUptimeSec` until the window fills;
 * the run that crosses the boundary is counted partially (uptime capped to
 * the remaining budget). Returns null when there is no usable run data.
 *
 * @param {RunSummary[]} runs
 * @param {{ host?: string|null, minskyVersion?: string|null, windowSec?: number, nowMs?: number }} [opts]
 * @returns {null | {
 *   windowSec: number, accumulatedUptimeSec: number, complete: boolean,
 *   runCount: number, runIds: string[], restarts: number, tasksMerged: number,
 *   longestUninterruptedSec: number|null, windowStart: string|null,
 *   windowEnd: string|null, host: string|null, minskyVersion: string|null,
 * }}
 */
export function accumulate24h(runs, opts = {}) {
  const windowSec = opts.windowSec ?? SEC_PER_DAY;
  const filtered = sortNewestFirst(applyFilter(runs, opts));
  if (filtered.length === 0) return null;

  const acc = {
    sec: 0,
    restarts: 0,
    tasksMerged: 0,
    longest: /** @type {number|null} */ (null),
    runIds: /** @type {string[]} */ ([]),
    windowStart: /** @type {string|null} */ (null),
    windowEnd: filtered[0]?.endedAt ?? null,
    complete: false,
  };
  for (const r of filtered) {
    accumulateRun(acc, r, windowSec);
    if (acc.complete) break;
  }

  return {
    windowSec,
    accumulatedUptimeSec: Math.round(acc.sec),
    complete: acc.complete,
    runCount: acc.runIds.length,
    runIds: acc.runIds,
    restarts: acc.restarts,
    tasksMerged: acc.tasksMerged,
    longestUninterruptedSec: acc.longest,
    windowStart: acc.windowStart,
    windowEnd: acc.windowEnd,
    host: opts.host ?? null,
    minskyVersion: opts.minskyVersion ?? null,
  };
}

/** @param {unknown} v @param {number} [d] @returns {number} */
function num(v, d = 0) {
  return Number.isFinite(v) ? Number(v) : d;
}

/**
 * Fold one run into the accumulator (mutates `acc`). Extracted so
 * `accumulate24h` stays under the cognitive-complexity budget.
 * @param {{sec:number,restarts:number,tasksMerged:number,longest:number|null,runIds:string[],windowStart:string|null,windowEnd:string|null,complete:boolean}} acc
 * @param {RunSummary} r
 * @param {number} windowSec
 */
function accumulateRun(acc, r, windowSec) {
  acc.sec += Math.min(Math.max(0, num(r.totalUptimeSec)), windowSec - acc.sec);
  acc.restarts += num(r.restartCount);
  acc.tasksMerged += num(r.tasksMerged);
  if (Number.isFinite(r.longestUninterruptedSec)) {
    acc.longest = Math.max(acc.longest ?? 0, Number(r.longestUninterruptedSec));
  }
  if (r.runId) acc.runIds.push(r.runId);
  acc.windowStart = r.startedAt ?? acc.windowStart;
  if (acc.sec >= windowSec) acc.complete = true;
}

/**
 * The single longest uninterrupted run (max `longestUninterruptedSec`).
 * Returns null when no run carries a finite value.
 *
 * @param {RunSummary[]} runs
 * @param {{ host?: string|null, minskyVersion?: string|null }} [filter]
 * @returns {null | {
 *   longestUninterruptedSec: number, runId: string|null, startedAt: string|null,
 *   endedAt: string|null, totalUptimeSec: number|null, host: string|null,
 *   minskyVersion: string|null,
 * }}
 */
export function longestRun(runs, filter = {}) {
  let best = null;
  for (const r of applyFilter(runs, filter)) {
    if (!Number.isFinite(r.longestUninterruptedSec)) continue;
    const sec = Number(r.longestUninterruptedSec);
    if (best === null || sec > best.longestUninterruptedSec) best = toLongest(r, sec);
  }
  return best;
}

/**
 * @param {RunSummary} r
 * @param {number} sec
 * @returns {{longestUninterruptedSec:number,runId:string|null,startedAt:string|null,endedAt:string|null,totalUptimeSec:number|null,host:string|null,minskyVersion:string|null}}
 */
function toLongest(r, sec) {
  return {
    longestUninterruptedSec: sec,
    runId: r.runId ?? null,
    startedAt: r.startedAt ?? null,
    endedAt: r.endedAt ?? null,
    totalUptimeSec: Number.isFinite(r.totalUptimeSec) ? Number(r.totalUptimeSec) : null,
    host: r.host ?? null,
    minskyVersion: r.minskyVersion ?? null,
  };
}

/**
 * The most recent run's end timestamp (ms), or null when no run data — the
 * run-relative clock for the freshness gate. "Last time minsky actually ran."
 * @param {RunSummary[]} runs
 * @returns {number|null}
 */
export function latestRunEndMs(runs) {
  const sorted = sortNewestFirst(applyFilter(runs, {}));
  const top = sorted[0];
  if (!top) return null;
  const ms = Date.parse(top.endedAt ?? top.startedAt ?? "");
  return Number.isFinite(ms) ? ms : null;
}

// ---- impure helpers (CLI / collectors) -------------------------------

/**
 * Read every `.minsky/runs/<id>/run-summary.json` under `rootDir`.
 * Best-effort: a fresh CI checkout has no `.minsky/` (gitignored) → [].
 * @param {string} rootDir
 * @returns {RunSummary[]}
 */
export function loadRunSummaries(rootDir) {
  const dir = join(rootDir, ".minsky", "runs");
  if (!existsSync(dir)) return [];
  /** @type {RunSummary[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry, "run-summary.json");
    if (!existsSync(file)) continue;
    try {
      out.push(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      /* skip unparseable run summary */
    }
  }
  return out;
}
