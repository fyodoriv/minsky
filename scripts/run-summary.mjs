#!/usr/bin/env node
// @ts-check
// Per-run observability summary (task `obs-run-session-ledger`).
//
// Reads the existing append-only ledger `.minsky/orchestrate.jsonl` (tick
// heartbeats: ts, workerAlive, healed, merged[], runId) and derives ONE
// `run-summary.json` for a supervised run: uptime, longest-uninterrupted span,
// restart count (worker heals), and throughput. No new hot-loop instrumentation:
// this is a pure reducer over data the daemon already writes (rule #2 — read the
// seam, don't add a write path).
//
// Anchor: Avizienis, Laprie, Randell, Landwehr, "Basic Concepts and Taxonomy of
// Dependable and Secure Computing", IEEE TDSC 2004 — continuity/uptime is a
// measured dependability attribute, not a vibe.
//
// Usage:
//   node scripts/run-summary.mjs                 # latest run, pretty
//   node scripts/run-summary.mjs --run latest --json
//   node scripts/run-summary.mjs --run <run-id> --json
//
// Pure core (`summarizeRun`) is unit-tested in run-summary.test.mjs; the CLI
// only does the file reads and prints. Missing ledgers → null fields, never a
// throw (rule #7 — graceful degrade).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/**
 * @typedef {{ ts: string, workerAlive?: boolean, healed?: boolean, merged?: number[], skipped?: number, sweepError?: string, runId?: string }} TickLine
 */

/**
 * Most-recent run id = runId of the ledger line with the greatest ts.
 * @param {TickLine[]} ledger
 * @returns {string | null}
 */
function latestRunId(ledger) {
  let best = null;
  let bestT = Number.NEGATIVE_INFINITY;
  for (const l of ledger) {
    if (!l || typeof l.runId !== "string") continue;
    const t = Date.parse(l.ts);
    if (Number.isFinite(t) && t >= bestT) {
      bestT = t;
      best = l.runId;
    }
  }
  return best;
}

/** @param {unknown[]} verdicts @returns {number | null} */
const attemptCount = (verdicts) =>
  Array.isArray(verdicts) && verdicts.length ? verdicts.length : null;

/** @param {unknown[]} verdicts @param {string | null} [runId] */
const emptySummary = (verdicts, runId = null) => ({
  runId: runId ?? null,
  startedAt: null,
  endedAt: null,
  totalUptimeSec: null,
  longestUninterruptedSec: null,
  restartCount: 0,
  tasksAttempted: attemptCount(verdicts),
  tasksMerged: 0,
});

/**
 * Longest span (sec) with no worker restart: heal events split the run.
 * @param {TickLine[]} sorted @param {number} startMs @param {number} endMs
 */
function longestUninterruptedSec(sorted, startMs, endMs) {
  const boundaries = [startMs];
  for (const l of sorted) if (l.healed === true) boundaries.push(Date.parse(l.ts));
  boundaries.push(endMs);
  let longestMs = 0;
  for (let i = 1; i < boundaries.length; i++) {
    const a = boundaries[i];
    const b = boundaries[i - 1];
    if (a !== undefined && b !== undefined) longestMs = Math.max(longestMs, a - b);
  }
  return Math.round(longestMs / 1000);
}

/** @param {TickLine[]} sorted @returns {number} distinct merged PR count */
function distinctMergedCount(sorted) {
  /** @type {Set<number>} */
  const merged = new Set();
  for (const l of sorted) for (const n of l.merged ?? []) merged.add(n);
  return merged.size;
}

/**
 * Pure reducer: ledger (+ optional verdicts) → run summary.
 * @param {{ ledger?: TickLine[], verdicts?: unknown[], runId?: string | null }} input
 */
export function summarizeRun({ ledger = [], verdicts = [], runId = null } = {}) {
  if (!Array.isArray(ledger) || ledger.length === 0) return emptySummary(verdicts);

  const targetRunId = runId ?? latestRunId(ledger);
  const lines = targetRunId ? ledger.filter((l) => l && l.runId === targetRunId) : ledger.slice();
  const sorted = lines
    .filter((l) => l && Number.isFinite(Date.parse(l.ts)))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return emptySummary(verdicts, targetRunId);

  const startMs = Date.parse(first.ts);
  const endMs = Date.parse(last.ts);
  return {
    runId: targetRunId ?? null,
    startedAt: first.ts,
    endedAt: last.ts,
    totalUptimeSec: Math.round((endMs - startMs) / 1000),
    longestUninterruptedSec: longestUninterruptedSec(sorted, startMs, endMs),
    restartCount: sorted.filter((l) => l.healed === true).length,
    tasksAttempted: attemptCount(verdicts),
    tasksMerged: distinctMergedCount(sorted),
  };
}

/**
 * Build a consolidated, timestamp-ordered run log from the STRUCTURED ledger
 * events (each carries a real `ts`). Raw `tick-loop.{out,err}.log` text is NOT
 * inlined — it has no per-line ts to interleave faithfully, so we link it from
 * the runbook instead of producing a lossy merge (the task's Pivot).
 * @param {Array<{ ts: string, kind: string, detail: string }>} events
 * @returns {string}
 */
export function buildRunLog(events = []) {
  return (
    events
      .filter((e) => e && Number.isFinite(Date.parse(e.ts)))
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
      .map((e) => `${e.ts}  [${e.kind}]  ${e.detail}`)
      .join("\n") + (events.length ? "\n" : "")
  );
}

/**
 * Turn ledger tick lines into run-log events.
 * @param {TickLine[]} lines
 * @returns {Array<{ ts: string, kind: string, detail: string }>}
 */
function ledgerEvents(lines) {
  return lines.map((l) => ({
    ts: l.ts,
    kind: l.healed ? "heal" : l.sweepError ? "error" : "tick",
    detail: l.sweepError
      ? `sweepError: ${l.sweepError}`
      : `workerAlive=${l.workerAlive} healed=${!!l.healed} merged=[${(l.merged ?? []).join(",")}]`,
  }));
}

/** Read `.minsky/orchestrate.jsonl` — tolerate both a JSON array and JSON-lines. */
function readLedger() {
  const p = join(REPO, ".minsky", "orchestrate.jsonl");
  if (!existsSync(p)) return [];
  const raw = readFileSync(p, "utf8").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* fall through to line-by-line */
  }
  return raw
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** @typedef {ReturnType<typeof summarizeRun>} Summary */

/**
 * Best-effort: write run-summary.json + run.log under `.minsky/runs/<id>/`.
 * @param {Summary} summary @param {TickLine[]} ledger
 */
function persistRun(summary, ledger) {
  if (!summary.runId) return;
  const dir = join(REPO, ".minsky", "runs", summary.runId);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    const runLines = ledger.filter((l) => l && l.runId === summary.runId);
    writeFileSync(join(dir, "run.log"), buildRunLog(ledgerEvents(runLines)));
  } catch {
    /* best-effort persistence; printing still works */
  }
}

/** @param {Summary} summary */
function renderPretty(summary) {
  return `${[
    `run-summary (${summary.runId ?? "no active run"})`,
    `  uptime:             ${summary.totalUptimeSec ?? "—"}s`,
    `  longest no-restart: ${summary.longestUninterruptedSec ?? "—"}s`,
    `  restarts:           ${summary.restartCount}`,
    `  tasks merged:       ${summary.tasksMerged}`,
  ].join("\n")}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const runIdx = args.indexOf("--run");
  const runArg = runIdx >= 0 ? args[runIdx + 1] : "latest";
  const runId = !runArg || runArg === "latest" ? null : runArg;

  const ledger = readLedger();
  const summary = summarizeRun({ ledger, runId });
  persistRun(summary, ledger);

  process.stdout.write(
    args.includes("--json") ? `${JSON.stringify(summary)}\n` : renderPretty(summary),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
