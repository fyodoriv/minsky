#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-22 M1.10 self-refresh — pure function that scores the COMPETITORS corpus on staleness; rule-#4 visibility for the M1.10 scorecard's data freshness; operator directive 2026-05-22 "add a mechanism so that minsky keeps competitors list updated and competitors there too". -->
//
// Pure freshness check over the M1.10 competitor corpus.
//
// What it does
// ------------
// Loads `COMPETITORS` from `novel/competitive-benchmark/src/competitors.ts`
// (via regex extraction — same shape as competitor-research-validate.mjs)
// and computes per-competitor `asOf`-age in days. Buckets the entries
// into fresh / stale / very-stale per documented thresholds. Returns a
// summary object the CLI prints + the scorecard surfaces + the
// auto-file-tasks script consumes.
//
// Why this exists
// ---------------
// The scorecard corpus is a dated snapshot — every `resultSource.asOf`
// field pins when the reading was last refreshed. Without a freshness
// signal, the scorecard's claims silently age out: a Devin number from
// 2024-03 looks the same in the JSON whether it's 1 month old or 24
// months old. This check surfaces the age so:
//
//   1. The operator sees it in `competitors/scorecard.md` (Path-A phase-10 — the executable `bin/minsky competitive` CLI was removed; the static scorecard markdown is the readable surface).
//   2. The weekly launchd auto-refresh script consumes the JSON and
//      files `corpus-refresh-<id>` TASKS.md entries when any reading
//      goes very-stale (>180 days).
//   3. The tick-loop picks those tasks up and invokes the existing
//      `/competitor-research` skill to refresh the reading — closing
//      the loop.
//
// Thresholds (research-anchored, see Anchor):
//   - fresh:       ≤ 90 days  — typical vendor publication cadence
//   - stale:       91-180 days — advisory; surface in summary
//   - very-stale:  > 180 days  — file a refresh task automatically
//
// Pattern: pure-function-with-I/O-at-edge (Martin 2017, *Clean
//   Architecture* — `computeFreshness({ competitors, now, thresholds })`
//   is referentially transparent; the CLI's regex-extraction +
//   writeFileSync are the I/O boundary).
// Source: operator directive 2026-05-22 (mechanism for keeping
//   competitors + readings updated); M1.10 milestone — the "scorecard
//   updates weekly" clause now extends to the corpus side, not just
//   the scoreboard rebuild.
// Anchor: rule #4 (visible — every dated reading carries its own
//   freshness signal); rule #6 (stay alive — staleness must surface as
//   an explicit failure mode, not silently degrade the comparison);
//   Beyer SRE 2016 (data-freshness as an SLI when stale data is itself
//   a service-level problem); Cognition Labs 2025 Annual Review
//   (cadence — competitors publish updates ~quarterly, so 90 / 180-day
//   thresholds are 1 / 2 vendor-cycles).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @typedef {{ fresh: number, stale: number }} FreshnessThresholds
 *   Number of days above which the next bucket kicks in. `fresh` is the
 *   upper bound of "fresh" (default 90); `stale` is the upper bound of
 *   "stale" (default 180); anything above `stale` is "very-stale".
 */

/**
 * @typedef {object} CorpusEntry
 * @property {string} id
 * @property {string} asOf   ISO YYYY-MM-DD (parsed from competitors.ts)
 */

/**
 * @typedef {object} FreshnessRow
 * @property {string} id
 * @property {string} asOf
 * @property {number} ageDays
 * @property {"fresh" | "stale" | "very-stale"} status
 */

/**
 * @typedef {object} FreshnessSummary
 * @property {string} generatedAt   ISO timestamp of the check
 * @property {readonly FreshnessRow[]} entries
 * @property {number} meanAgeDays
 * @property {number} staleCount      stale + very-stale
 * @property {number} verySaleCount   very-stale only
 * @property {readonly string[]} verySaleIds   ids needing a refresh task
 */

export const DEFAULT_THRESHOLDS = Object.freeze({ fresh: 90, stale: 180 });

/**
 * Best-effort regex extraction of `{ id, asOf }` from
 * `novel/competitive-benchmark/src/competitors.ts`. Returns the entries
 * in declaration order. Skips `local-harness` source kinds because they
 * don't carry an `asOf` snapshot — those competitors are by-contract
 * runtime-evaluated and have no freshness signal.
 *
 * Walks the file linearly, maintaining state for the current `id`
 * candidate; when an `asOf` line appears AFTER a `kind: "published"`
 * marker for that id (and before the next `id:` line), the entry is
 * accepted. This is permissive enough to parse both the production
 * shape and the compact test fixtures.
 *
 * @param {string} body  raw competitors.ts content
 * @returns {CorpusEntry[]}
 */
export function extractCorpusEntries(body) {
  /** @type {CorpusEntry[]} */
  const out = [];
  /** @type {{ id: string, kindSeen: "published" | "local-harness" | null } | null} */
  let current = null;

  // Each iteration tries id → kind → asOf in order against the SAME
  // line; multiple matches on one line (compact-shape test fixtures
  // and the production shape) both work.
  for (const line of body.split("\n")) {
    current = applyLineToCorpusExtraction(line, current, out);
  }
  return out;
}

/**
 * One step of the corpus-extraction state machine. Each line can
 * advance `current` (start a new id), record a `kind` for the
 * in-flight id, or — once the kind is `published` — record the
 * `asOf` and emit the entry. Pulled out of `extractCorpusEntries`
 * to keep that function's cognitive complexity at ≤10 (biome
 * lint/complexity/noExcessiveCognitiveComplexity gate).
 *
 * @param {string} line
 * @param {{ id: string, kindSeen: "published" | "local-harness" | null } | null} current
 * @param {CorpusEntry[]} out  mutated when an entry is emitted
 * @returns {{ id: string, kindSeen: "published" | "local-harness" | null } | null}  new `current` for the next line
 */
function applyLineToCorpusExtraction(line, current, out) {
  const idMatch = /id:\s*"([a-z0-9-]+)"/.exec(line);
  const next =
    idMatch !== null && idMatch[1] !== undefined
      ? { id: idMatch[1], kindSeen: /** @type {null} */ (null) }
      : current;
  if (next === null) return null;

  const kindMatch = /kind:\s*"(published|local-harness)"/.exec(line);
  if (kindMatch !== null && kindMatch[1] !== undefined) {
    next.kindSeen = /** @type {"published" | "local-harness"} */ (kindMatch[1]);
  }
  if (next.kindSeen !== "published") return next;

  const asOfMatch = /asOf:\s*"(\d{4}-\d{2}-\d{2})"/.exec(line);
  if (asOfMatch !== null && asOfMatch[1] !== undefined) {
    out.push({ id: next.id, asOf: asOfMatch[1] });
    return null; // consumed; move on
  }
  return next;
}

/**
 * @param {number} ageDays
 * @param {FreshnessThresholds} thresholds
 * @returns {"fresh" | "stale" | "very-stale"}
 */
function bucketize(ageDays, thresholds) {
  if (ageDays <= thresholds.fresh) return "fresh";
  if (ageDays <= thresholds.stale) return "stale";
  return "very-stale";
}

/**
 * Compute the freshness summary. Pure — no I/O.
 *
 * @param {{ competitors: readonly CorpusEntry[], now: string, thresholds?: FreshnessThresholds }} input
 * @returns {FreshnessSummary}
 *
 * @otel-exempt pure function — single-pass fold over the corpus entries;
 *   no I/O, no side effects. The CLI shim's read + write are the
 *   I/O boundary.
 */
export function computeFreshness(input) {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const nowMs = Date.parse(input.now);
  if (Number.isNaN(nowMs)) {
    throw new Error(`computeFreshness: invalid now date: ${JSON.stringify(input.now)}`);
  }
  const rows = input.competitors.map((c) => buildFreshnessRow(c, nowMs, thresholds));
  const totalAge = rows.reduce((sum, r) => sum + r.ageDays, 0);
  const staleCount = rows.filter((r) => r.status !== "fresh").length;
  const verySaleIds = rows.filter((r) => r.status === "very-stale").map((r) => r.id);
  const meanAgeDays = rows.length === 0 ? 0 : Math.round(totalAge / rows.length);
  return {
    generatedAt: input.now,
    entries: rows,
    meanAgeDays,
    staleCount,
    verySaleCount: verySaleIds.length,
    verySaleIds,
  };
}

/**
 * Build one FreshnessRow from a corpus entry. Pulled out of
 * `computeFreshness` to keep that function's cognitive complexity
 * at ≤10 (biome lint/complexity/noExcessiveCognitiveComplexity gate).
 *
 * @param {CorpusEntry} c
 * @param {number} nowMs        epoch-ms of the "now" reference
 * @param {FreshnessThresholds} thresholds
 * @returns {FreshnessRow}
 */
function buildFreshnessRow(c, nowMs, thresholds) {
  const asOfMs = Date.parse(c.asOf);
  if (Number.isNaN(asOfMs)) {
    throw new Error(`computeFreshness: invalid asOf for ${c.id}: ${JSON.stringify(c.asOf)}`);
  }
  const ageDays = Math.max(0, Math.floor((nowMs - asOfMs) / 86_400_000));
  return { id: c.id, asOf: c.asOf, ageDays, status: bucketize(ageDays, thresholds) };
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: node scripts/check-corpus-freshness.mjs [--json] [--help]",
      "",
      "Pure freshness check over the M1.10 competitor corpus.",
      "",
      "Options:",
      "  --json       Emit machine-readable JSON; otherwise human summary.",
      "  --help, -h   Print this message.",
      "",
      "Exit code:",
      "  0  corpus is fresh — no entries older than the stale threshold",
      "  1  at least one entry is `very-stale` (>180 days); refresh tasks",
      "     should be filed by the operator (or by",
      "     `scripts/auto-file-corpus-refresh-tasks.mjs`).",
      "  2  reading error (missing competitors.ts, parse error, etc.)",
      "",
      "Anchor: vision.md § Pattern conformance index row 95 — the M1.10",
      "  corpus self-refresh substrate.",
      "",
    ].join("\n"),
  );
}

/**
 * @param {string[]} argv
 * @returns {{ json: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const out = { json: false, help: false };
  for (const a of argv.slice(2)) {
    if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a) {
      process.stderr.write(`check-corpus-freshness: unknown argument: ${a}\n`);
      process.exit(64);
    }
  }
  return out;
}

/**
 * @param {FreshnessSummary} s
 * @returns {string}
 */
function renderSummary(s) {
  const lines = [];
  lines.push("");
  lines.push("══ Corpus freshness (M1.10) ══");
  lines.push(`Generated: ${s.generatedAt}`);
  lines.push(
    `Entries: ${s.entries.length} (mean age ${s.meanAgeDays} days, ${s.staleCount} stale, ${s.verySaleCount} very-stale)`,
  );
  lines.push("");
  for (const row of s.entries) {
    const icon = row.status === "fresh" ? "✓" : row.status === "stale" ? "·" : "✗";
    lines.push(
      `  ${icon} ${row.id.padEnd(20)} ${row.asOf}  ${row.ageDays.toString().padStart(4)}d  ${row.status}`,
    );
  }
  lines.push("");
  if (s.verySaleCount > 0) {
    lines.push(`Refresh recommended for ${s.verySaleCount} entry(ies):`);
    for (const id of s.verySaleIds) lines.push(`  - corpus-refresh-${id}`);
    lines.push("");
    lines.push("Run `scripts/auto-file-corpus-refresh-tasks.mjs` to file the tasks,");
    lines.push("then `/competitor-research <url>` to refresh each one.");
  } else {
    lines.push("All readings within the 180-day refresh window — no action needed.");
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printUsage();
    return 0;
  }
  const competitorsPath = resolve(REPO_ROOT, "novel/competitive-benchmark/src/competitors.ts");
  let body;
  try {
    body = readFileSync(competitorsPath, "utf8");
  } catch (err) {
    process.stderr.write(
      `check-corpus-freshness: failed to read ${competitorsPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  const competitors = extractCorpusEntries(body);
  if (competitors.length === 0) {
    process.stderr.write(
      "check-corpus-freshness: 0 published competitors extracted — competitors.ts shape may have changed\n",
    );
    return 2;
  }
  const summary = computeFreshness({ competitors, now: new Date().toISOString().slice(0, 10) });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(renderSummary(summary));
  }
  return summary.verySaleCount > 0 ? 1 : 0;
}

// Direct-invoke detection — tolerate macOS /tmp → /private/tmp symlink
// quirks by also matching basename. Same idiom as check-rule-9-tasksmd-fields.mjs.
const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-corpus-freshness.mjs");
if (isCli) process.exit(main());
