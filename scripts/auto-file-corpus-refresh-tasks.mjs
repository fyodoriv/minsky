#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-22 M1.10 self-refresh — converts the check-corpus-freshness.mjs verdict into TASKS.md `corpus-refresh-<id>` entries; closes the loop so the tick-loop picks them up via /next-task and invokes /competitor-research <url> to refresh the reading. -->
//
// Auto-file TASKS.md entries for very-stale corpus readings.
//
// What it does
// ------------
// 1. Run check-corpus-freshness against the local competitors.ts.
// 2. For every entry in `verySaleIds`, ensure a `corpus-refresh-<id>`
//    task block exists in TASKS.md. If absent, append it under P2.
// 3. Idempotent — re-running on the same input is a no-op when all
//    refresh tasks already exist.
//
// Why this exists
// ---------------
// Operator directive 2026-05-22: "add a mechanism so that minsky keeps
// competitors list updated and competitors there too". The freshness
// check is the SIGNAL; this script is the LOOP: it materializes the
// signal into the only thing the tick-loop can act on — a task block.
// The tick-loop then picks the task via /next-task → invokes the
// existing /competitor-research skill on the cited URL → opens a PR
// that updates competitors.ts + the matching competitors/<id>.md
// research file. End-to-end the corpus self-refreshes weekly.
//
// Pattern: pure-function-with-I/O-at-edge (Martin 2017, *Clean
//   Architecture*) — `buildRefreshTaskBlock({ competitorId, asOf, ageDays })`
//   is referentially transparent; the file-read + append are the I/O
//   boundary. Idempotent-write pattern (Helland 2007 *Building on
//   Quicksand* — the same input always produces the same output, so
//   re-running the script on a tree where the tasks already exist is a
//   no-op).
// Source: M1.10 self-refresh loop; vision.md § Pattern conformance
//   index row 95.
// Anchor: rule #17 (proactive healing — observation IS the fix; the
//   freshness signal becomes a filed task in the SAME run); rule #4
//   (visible — the staleness shows up as a file in TASKS.md the
//   operator can read, not just a log line); rule #9 (pre-registered
//   HDD — each refresh task carries Hypothesis/Success/Pivot/
//   Measurement/Anchor fields per the rule-9 lint).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @typedef {import("./check-corpus-freshness.mjs").FreshnessSummary} FreshnessSummary
 */

/**
 * Build the markdown body for a single `corpus-refresh-<id>` task
 * block. Pure — same input always produces the same output.
 *
 * @param {{ competitorId: string, asOf: string, ageDays: number }} input
 * @returns {string}
 *
 * @otel-exempt pure string-template; no I/O, no side effects.
 */
export function buildRefreshTaskBlock(input) {
  const { competitorId, asOf, ageDays } = input;
  return [
    `- [ ] \`corpus-refresh-${competitorId}\` — refresh the published readings for \`${competitorId}\` in \`novel/competitive-benchmark/src/competitors.ts\` (asOf ${asOf}, ${ageDays} days stale; auto-filed by \`scripts/auto-file-corpus-refresh-tasks.mjs\`)`,
    `  - **ID**: corpus-refresh-${competitorId}`,
    `  - **Tags**: p2, milestone-m1, m1-10, metrics, competitive, corpus-refresh, auto-filed`,
    `  - **Milestone**: M1`,
    `  - **Competitive-goal**: keeps the M1.10 scorecard's per-competitor cell density at \`fresh\` (≤90 days). A reading at ${ageDays} days is the freshness gate's "very-stale" bucket; without this refresh the operator's "Minsky vs ${competitorId}" delta is comparing against a multi-quarter-old snapshot, which loses signal as the vendor publishes new numbers.`,
    `  - **Touches**: \`novel/competitive-benchmark/src/competitors.ts\` (the \`${competitorId}\` entry), \`competitors/${competitorId}.md\` (Scorecard readings table), optional \`competitors.test.ts\` if a value moves significantly.`,
    `  - **Details**: invoke \`/competitor-research <url>\` with the vendor's primary publication URL for \`${competitorId}\`. The skill walks the 6 phases (identify → research → draft → validate → verify → file follow-ups). The draft validator (\`scripts/competitor-research-validate.mjs --refresh --draft <path>\`) accepts the existing id with \`--refresh\`. After the skill lands the PR, this auto-filed task can be removed from TASKS.md (per tasks.md spec — history lives in git log).`,
    `  - **Hypothesis**: refreshing \`${competitorId}\` to a publication ≤90 days old keeps the M1.10 scorecard's deltas signal-bearing rather than vanity. After this task lands, \`node scripts/check-corpus-freshness.mjs --json | jq '.entries[] | select(.id == "${competitorId}") | .status'\` returns \`"fresh"\`.`,
    `  - **Success**: \`competitors.ts\`'s \`${competitorId}\` entry has \`asOf\` within the last 90 days; \`competitors/${competitorId}.md\` Scorecard readings table matches; \`pnpm --filter @minsky/competitive-benchmark test\` green; \`bin/minsky competitive\` still exits 0.`,
    `  - **Pivot**: if the vendor has not published a new number in the last 365 days (4+ vendor cycles), mark the entry as "stale-by-vendor" in a comment in \`competitors.ts\` and do NOT refresh \`asOf\` — masking the staleness with a re-stated old number is worse than acknowledging it.`,
    `  - **Measurement**: \`node scripts/check-corpus-freshness.mjs --json | jq '[.entries[] | select(.id == "${competitorId}") | .status] | first'\` returns \`"fresh"\` after the refresh; baseline today is \`"very-stale"\`.`,
    `  - **Anchor**: rule #4 (visible — staleness is now a measured signal); rule #6 (stay alive — the scorecard's claims age out silently without this loop); Beyer SRE 2016 (data-freshness as an SLI); operator directive 2026-05-22 (mechanism for keeping competitors + readings updated).`,
    "",
  ].join("\n");
}

/**
 * Decide which `corpus-refresh-<id>` task ids are already present in
 * the current TASKS.md text. Pure.
 *
 * @param {string} tasksMd
 * @param {readonly string[]} candidateIds
 * @returns {Set<string>} subset of candidateIds already present
 *
 * @otel-exempt pure regex scan; no I/O.
 */
export function findAlreadyFiledIds(tasksMd, candidateIds) {
  const present = new Set();
  for (const id of candidateIds) {
    const re = new RegExp(`\\*\\*ID\\*\\*:\\s*corpus-refresh-${id}\\b`, "m");
    if (re.test(tasksMd)) present.add(id);
  }
  return present;
}

/**
 * Locate the P2 priority section in TASKS.md and return the byte index
 * where new task blocks should be inserted (right after the `## P2`
 * heading + blank line). Falls back to end-of-file when no P2 section
 * exists.
 *
 * @param {string} tasksMd
 * @returns {number}
 *
 * @otel-exempt pure index lookup; no I/O.
 */
export function locateP2InsertionPoint(tasksMd) {
  const headingIdx = tasksMd.search(/^## P2\b/m);
  if (headingIdx === -1) return tasksMd.length;
  // Skip past the heading line + the blank line below it.
  const afterHeading = tasksMd.indexOf("\n", headingIdx);
  if (afterHeading === -1) return tasksMd.length;
  let idx = afterHeading + 1;
  // Skip any number of blank lines so the new block is the first
  // P2 entry. Stop at the first non-blank line.
  while (idx < tasksMd.length && tasksMd[idx] === "\n") idx += 1;
  return idx;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: node scripts/auto-file-corpus-refresh-tasks.mjs [--dry-run] [--help]",
      "",
      "Reads `check-corpus-freshness.mjs --json` output, then APPENDS",
      "`corpus-refresh-<id>` task blocks to TASKS.md for every very-stale",
      "entry that doesn't already have one. Idempotent — re-running on the",
      "same tree is a no-op.",
      "",
      "Options:",
      "  --dry-run    Print the would-be task blocks to stdout but don't",
      "               touch TASKS.md.",
      "  --help, -h   Print this message.",
      "",
      "Exit code:",
      "  0  task blocks filed (or already present — idempotent)",
      "  1  nothing to file — corpus has no very-stale entries",
      "  2  reading error (missing TASKS.md or competitors.ts, parse error)",
      "",
    ].join("\n"),
  );
}

/**
 * @param {string[]} argv
 * @returns {{ dryRun: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const out = { dryRun: false, help: false };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a) {
      process.stderr.write(`auto-file-corpus-refresh-tasks: unknown argument: ${a}\n`);
      process.exit(64);
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printUsage();
    return 0;
  }
  // Lazy-import the sibling so the script works in CI even if the
  // node-resolver path differs.
  const { computeFreshness, extractCorpusEntries } = await import("./check-corpus-freshness.mjs");
  const competitorsPath = resolve(REPO_ROOT, "novel/competitive-benchmark/src/competitors.ts");
  if (!existsSync(competitorsPath)) {
    process.stderr.write(`auto-file-corpus-refresh-tasks: ${competitorsPath} not found\n`);
    return 2;
  }
  const tasksMdPath = resolve(REPO_ROOT, "TASKS.md");
  if (!existsSync(tasksMdPath)) {
    process.stderr.write(`auto-file-corpus-refresh-tasks: ${tasksMdPath} not found\n`);
    return 2;
  }

  const competitors = extractCorpusEntries(readFileSync(competitorsPath, "utf8"));
  const summary = computeFreshness({
    competitors,
    now: new Date().toISOString().slice(0, 10),
  });
  if (summary.verySaleCount === 0) {
    process.stdout.write(
      "auto-file-corpus-refresh-tasks: 0 very-stale entries — nothing to file.\n",
    );
    return 1;
  }

  const tasksMd = readFileSync(tasksMdPath, "utf8");
  const alreadyFiled = findAlreadyFiledIds(tasksMd, summary.verySaleIds);

  /** @type {string[]} */
  const newBlocks = [];
  /** @type {string[]} */
  const skippedExisting = [];
  for (const id of summary.verySaleIds) {
    if (alreadyFiled.has(id)) {
      skippedExisting.push(id);
      continue;
    }
    const row = summary.entries.find((e) => e.id === id);
    if (row === undefined) continue;
    newBlocks.push(buildRefreshTaskBlock({
      competitorId: id,
      asOf: row.asOf,
      ageDays: row.ageDays,
    }));
  }

  if (opts.dryRun) {
    process.stdout.write(
      `auto-file-corpus-refresh-tasks: --dry-run — ${newBlocks.length} block(s) would be filed; ${skippedExisting.length} already present.\n\n`,
    );
    if (newBlocks.length > 0) process.stdout.write(`${newBlocks.join("\n")}\n`);
    return 0;
  }

  if (newBlocks.length === 0) {
    process.stdout.write(
      `auto-file-corpus-refresh-tasks: all ${summary.verySaleCount} very-stale id(s) already have a refresh task — no edit needed.\n`,
    );
    return 0;
  }

  const insertIdx = locateP2InsertionPoint(tasksMd);
  const updated = `${tasksMd.slice(0, insertIdx)}${newBlocks.join("\n")}\n${tasksMd.slice(insertIdx)}`;
  writeFileSync(tasksMdPath, updated);
  process.stdout.write(
    `auto-file-corpus-refresh-tasks: filed ${newBlocks.length} block(s) under ## P2; skipped ${skippedExisting.length} already-present id(s).\n`,
  );
  for (const id of summary.verySaleIds) {
    const tag = alreadyFiled.has(id) ? "(already filed)" : "(new)";
    process.stdout.write(`  ${tag} corpus-refresh-${id}\n`);
  }
  return 0;
}

// Direct-invoke detection — tolerate macOS /tmp → /private/tmp symlink
// quirks by also matching basename. Same idiom as check-rule-9-tasksmd-fields.mjs.
const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("auto-file-corpus-refresh-tasks.mjs");
if (isCli) process.exit(await main());
