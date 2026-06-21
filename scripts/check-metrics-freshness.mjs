#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved metrics-freshness-ci-gate — deterministic CI gate for docs/METRICS.md primary-metrics table freshness; scoped to this task -->
// check-metrics-freshness — lint gate for docs/METRICS.md "Primary metrics"
// table freshness. Reads the `## Primary metrics` section, finds rows matching
// `| <name> | <value> | <YYYY-MM-DD> |`, and fails when any row's date is
// >7 days old AND `.minsky/orchestrate.jsonl` exists (active daemon machine).
//
// Skip conditions (all exit 0):
//   1. MINSKY_SKIP_FRESHNESS_CHECK=1 env var is set
//   2. The file (default docs/METRICS.md) does not exist
//   3. No "## Primary metrics" section or no parseable table rows
//   4. .minsky/orchestrate.jsonl is absent AND --file was not explicitly set
//      (skip on fresh clones, CI, machines without a live daemon)
//
// --file <path>   override the file to check (bypasses orchestrate.jsonl gate
//                 for hermetic tests: allows testing with a fixture file)
// --now <YYYY-MM-DD>  pin today's date for hermetic tests
//
// Pattern: deterministic gate (rule #10) — pure function over (markdown, today).
// Source: metrics-freshness-ci-gate task; vision.md rule #4 (visible-not-silent).
// Anchor: Forsgren, Humble, Kim, Accelerate 2018 Ch.2 — DORA metrics retain
//   predictive value only when tracked continuously against a freshness standard;
//   point-in-time snapshots without a staleness gate become vanity within weeks.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

export const STALE_DAYS = 7;

// Matches "## Primary metrics" section header (exact casing, line anchor)
const PRIMARY_SECTION_RE = /^##\s+Primary metrics\s*$/m;

/**
 * @typedef {{ name: string, value: string, date: string }} MetricRow
 */

/**
 * Extract primary metric rows from markdown. Parses rows matching
 * `| <name> | <value> | <YYYY-MM-DD> |` under the `## Primary metrics`
 * section only. Returns [] when no such section exists or no rows parse.
 *
 * @param {string} markdown
 * @returns {MetricRow[]}
 */
export function parsePrimaryMetrics(markdown) {
  const sectionMatch = PRIMARY_SECTION_RE.exec(markdown);
  if (!sectionMatch) return [];

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  // Clip to this section only (stop at next ## heading)
  const rest = markdown.slice(sectionStart);
  const nextSectionIdx = rest.search(/^##\s/m);
  const section = nextSectionIdx === -1 ? rest : rest.slice(0, nextSectionIdx);

  /** @type {MetricRow[]} */
  const rows = [];
  const rowRe = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/gm;
  for (const m of section.matchAll(rowRe)) {
    const name = (m[1] ?? "").trim();
    const date = (m[3] ?? "").trim();
    // Skip markdown table separator rows (e.g. "| --- | --- | --- |")
    if (!/^-+$/.test(name) && !/^-+$/.test(date)) {
      rows.push({ name, value: (m[2] ?? "").trim(), date });
    }
  }
  return rows;
}

/**
 * @typedef {{ metric: string, date: string, daysAgo: number }} StaleRow
 */

/**
 * Returns the subset of rows whose date is >STALE_DAYS before today.
 *
 * @param {MetricRow[]} rows
 * @param {string} today  YYYY-MM-DD
 * @returns {StaleRow[]}
 */
export function findStaleRows(rows, today) {
  const todayMs = Date.parse(today);
  /** @type {StaleRow[]} */
  const stale = [];
  for (const r of rows) {
    const rowMs = Date.parse(r.date);
    const daysAgo = Math.floor((todayMs - rowMs) / (24 * 60 * 60 * 1000));
    if (daysAgo > STALE_DAYS) {
      stale.push({ metric: r.name, date: r.date, daysAgo });
    }
  }
  return stale;
}

// ---- CLI thin wrapper -------------------------------------------------------

/**
 * @param {string[]} argv
 * @returns {{ filePath: string, explicitFile: boolean, todayOverride: string | null }}
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat CLI arg-parser branch chain
function parseCliArgs(argv) {
  let filePath = resolve(REPO_ROOT, "docs", "METRICS.md");
  let explicitFile = false;
  /** @type {string | null} */
  let todayOverride = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg.startsWith("--file=")) {
      filePath = resolve(arg.slice(7));
      explicitFile = true;
    } else if (arg === "--file") {
      filePath = resolve(argv[i + 1] ?? "");
      explicitFile = true;
      i++;
    } else if (arg.startsWith("--now=")) {
      todayOverride = arg.slice(6);
    } else if (arg === "--now") {
      todayOverride = argv[i + 1] ?? null;
      i++;
    }
  }
  return { filePath, explicitFile, todayOverride };
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>}  exit code
 */
export async function main(argv, env) {
  if (env["MINSKY_SKIP_FRESHNESS_CHECK"] === "1") {
    process.stdout.write("[SKIP] MINSKY_SKIP_FRESHNESS_CHECK=1 — skipping freshness check\n");
    return 0;
  }

  const { filePath, explicitFile, todayOverride } = parseCliArgs(argv);

  if (!existsSync(filePath)) {
    process.stdout.write("[WARN] docs/METRICS.md has no parseable primary metrics — skipping\n");
    return 0;
  }

  const markdown = readFileSync(filePath, "utf8");
  const rows = parsePrimaryMetrics(markdown);

  if (rows.length === 0) {
    process.stdout.write("[WARN] docs/METRICS.md has no parseable primary metrics — skipping\n");
    return 0;
  }

  // When reading the default file (not a test fixture), gate on daemon presence.
  // Fresh clones and CI have no .minsky/orchestrate.jsonl → skip.
  if (!explicitFile) {
    const orchestrateMarker = resolve(REPO_ROOT, ".minsky", "orchestrate.jsonl");
    if (!existsSync(orchestrateMarker)) {
      process.stdout.write(
        "[SKIP] .minsky/orchestrate.jsonl absent — no daemon run history, skipping freshness check\n",
      );
      return 0;
    }
  }

  const today = todayOverride ?? new Date().toISOString().slice(0, 10);
  const stale = findStaleRows(rows, today);

  if (stale.length > 0) {
    for (const r of stale) {
      process.stderr.write(`[STALE] ${r.metric} last observed ${r.date} (${r.daysAgo} days ago)\n`);
    }
    return 1;
  }

  process.stdout.write(`[OK] all ${rows.length} primary metric(s) fresh as of ${today}\n`);
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-metrics-freshness.mjs");
if (invokedDirectly) {
  const code = await main(process.argv.slice(2), process.env);
  process.exit(code);
}
