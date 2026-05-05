#!/usr/bin/env node
// Pattern: pure data-shape transforms (`parseGhPrList`, `filterByMergeDate`,
// `toMergedPRs`) composed with one I/O seam (`runGh`) above a one-line CLI
// — rule #2 (data-not-code), rule #10 (deterministic transforms). The
// daemon's spawned `claude --print` flow does its own gh-fetching; this
// script is the operator-side manual verification command named in the
// `daily-changelog-for-humans` task's Verification field
// (`pnpm changelog:today`).
// Anchor: 2026-05-05 user request — "implement a meaningful changelog
//   for humans"; rule #9 (this is what the operator runs to confirm the
//   day's section captured the PR chain before grading the daemon's
//   automated output).
// Conformance: full — pure transforms have no I/O; the CLI wrapper is
//   the only `gh` call site.
// Pivot (rule #9): if `gh` rate-limits or returns malformed JSON in
//   practice, fall back to `git log --merges` + PR-number extraction.
//   Don't retire the operator-CLI surface — manual verification is the
//   acceptance hook for the daily cadence.

import { spawn } from "node:child_process";

import { buildChangelogEntry, buildChangelogJson } from "./generate-changelog-entry.mjs";

/**
 * @typedef {Object} GhPrRecord
 * @property {number} number
 * @property {string} title
 * @property {number} additions
 * @property {number} deletions
 * @property {string} mergedAt   ISO-8601 UTC timestamp from `gh`
 */

/**
 * Parse `gh pr list --json …` output into typed records. Throws on
 * malformed JSON or missing fields — the caller wants a hard failure
 * over silently rendering an empty changelog.
 *
 * @param {string} raw
 * @returns {ReadonlyArray<GhPrRecord>}
 */
export function parseGhPrList(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("expected gh pr list to return a JSON array");
  }
  return parsed.map((p, i) => {
    if (
      typeof p?.number !== "number" ||
      typeof p?.title !== "string" ||
      typeof p?.additions !== "number" ||
      typeof p?.deletions !== "number" ||
      typeof p?.mergedAt !== "string"
    ) {
      throw new Error(
        `gh pr list record ${i} missing required fields (number/title/additions/deletions/mergedAt)`,
      );
    }
    return {
      number: p.number,
      title: p.title,
      additions: p.additions,
      deletions: p.deletions,
      mergedAt: p.mergedAt,
    };
  });
}

/**
 * Keep PRs whose `mergedAt` falls within the UTC day `date` (inclusive
 * start, exclusive end). The whole pipeline is UTC-aligned because the
 * CHANGELOG.md heading format is UTC `YYYY-MM-DD` (the genesis 2026-05-05
 * entry was authored against UTC midnight).
 *
 * @param {ReadonlyArray<GhPrRecord>} prs
 * @param {string} date  YYYY-MM-DD (UTC)
 * @returns {ReadonlyArray<GhPrRecord>}
 */
export function filterByMergeDate(prs, date) {
  const startMs = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(startMs)) {
    throw new Error(`invalid date "${date}" — expected YYYY-MM-DD`);
  }
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return prs.filter((pr) => {
    const t = Date.parse(pr.mergedAt);
    return !Number.isNaN(t) && t >= startMs && t < endMs;
  });
}

/**
 * Project the gh record shape down to the `MergedPR` contract
 * `buildChangelogEntry` accepts. Drops `mergedAt`; everything else is
 * a 1:1 copy.
 *
 * @param {ReadonlyArray<GhPrRecord>} prs
 * @returns {ReadonlyArray<{number: number, title: string, additions: number, deletions: number}>}
 */
export function toMergedPRs(prs) {
  return prs.map((p) => ({
    number: p.number,
    title: p.title,
    additions: p.additions,
    deletions: p.deletions,
  }));
}

/**
 * @typedef {(args: ReadonlyArray<string>) => Promise<string>} GhRunner
 *   Async runner returning stdout from `gh <args…>`. Tests inject a stub;
 *   the production binding shells out to the real `gh`.
 */

/**
 * Fetch and filter today's merged PRs via the injected `runGh` seam.
 * Single CLI call: `gh pr list --search "merged:>=DATE" --state merged
 * --json number,title,additions,deletions,mergedAt --limit 100`. Filters
 * the result by UTC day so a `merged:>=DATE` lower bound (which `gh`
 * interprets as repo-local-day inclusive) doesn't bleed in older PRs.
 *
 * @param {{ date: string, runGh: GhRunner }} opts
 * @returns {Promise<ReadonlyArray<GhPrRecord>>}
 */
export async function fetchTodaysPRs({ date, runGh }) {
  const raw = await runGh([
    "pr",
    "list",
    "--state",
    "merged",
    "--search",
    `merged:>=${date}`,
    "--json",
    "number,title,additions,deletions,mergedAt",
    "--limit",
    "100",
  ]);
  return filterByMergeDate(parseGhPrList(raw), date);
}

/**
 * @typedef {Object} RunOpts
 * @property {string} date
 * @property {GhRunner} runGh
 * @property {boolean} [json]    emit structured JSON instead of markdown
 */

/**
 * Top-level orchestrator: fetch → filter → render. Returns the string
 * the CLI writes to stdout. Pure once `runGh` resolves — no clock, no
 * env reads, no FS access.
 *
 * @param {RunOpts} opts
 * @returns {Promise<string>}
 */
export async function runChangelogToday({ date, runGh, json }) {
  const prs = await fetchTodaysPRs({ date, runGh });
  const input = { date, mergedPRs: toMergedPRs(prs) };
  if (json) return `${JSON.stringify(buildChangelogJson(input), null, 2)}\n`;
  return buildChangelogEntry(input);
}

// ---- CLI thin wrapper -------------------------------------------------

/**
 * Default UTC date (today) as YYYY-MM-DD.
 *
 * @returns {string}
 */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Production `runGh` binding. Spawns `gh` and resolves with stdout, or
 * rejects on non-zero exit. Synchronous-feeling for callers via Promise.
 *
 * @type {GhRunner}
 */
function spawnGh(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", [...args], { stdio: ["ignore", "pipe", "pipe"] });
    /** @type {Buffer[]} */ const out = [];
    /** @type {Buffer[]} */ const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out).toString("utf8"));
      } else {
        reject(
          new Error(`gh ${args.join(" ")} exited ${code}: ${Buffer.concat(err).toString("utf8")}`),
        );
      }
    });
  });
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ json: boolean, date: string | null }} */
  const args = { json: false, date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--date") args.date = argv[++i] ?? null;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date ?? todayUtc();
  const out = await runChangelogToday({ date, runGh: spawnGh, json: args.json });
  process.stdout.write(out);
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("changelog-today.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
