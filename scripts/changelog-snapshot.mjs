#!/usr/bin/env node
// <!-- scope: human-approved 2026-05-05 user request "implement a meaningful changelog for humans … as a part of the minsky loop. It must show also which metrics improved." — task `daily-changelog-for-humans` Details (e) "Snapshots persisted at .minsky/metric-snapshots/<date>.json". Closes the producer half of the snapshot pipeline; `pnpm changelog:today` already consumes via `loadSnapshot`. -->
// Pattern: pure data-shape transforms (`parseGhCount`, `composeSnapshot`)
// composed with two I/O seams (`runGh`, `save`) above a thin CLI — same
// shape as `changelog-today.mjs` so the operator surface stays uniform.
// Anchor: 2026-05-05 user request — "It must show also which metrics
//   improved" requires per-day snapshots to diff against; `saveSnapshot`
//   shipped in #186 had zero production callers until this script. Rule #2
//   (data-not-code: the JSON file is the source of truth) + rule #9 (the
//   snapshot is the falsifiable observable graded next day).
// Conformance: full — pure transforms have no I/O; the orchestrator
//   composes injected seams; the CLI is the only `gh` + fs call site.
// Pivot (rule #9): if `open_prs` / `open_issues` prove non-actionable
//   (operators ignore them, OR they oscillate around a noise floor that
//   masks real movement), swap the captured set — don't retire the
//   writer surface. The pipeline contract (date → MetricSnapshot → file)
//   is what `pnpm changelog:today`'s rendering depends on.

import { spawn } from "node:child_process";
import { mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import process from "node:process";

import { saveSnapshot } from "./metric-snapshot-store.mjs";

/**
 * Parse `gh … --json number` output (an array of `{number}` records) and
 * return its length. Throws on malformed JSON or non-array input — the
 * caller wants a hard failure over silently writing `0` and masking a
 * real `gh` outage.
 *
 * @param {string} raw
 * @returns {number}
 */
export function parseGhCount(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("expected gh JSON output to be an array");
  }
  return parsed.length;
}

/**
 * @typedef {Object} SnapshotInputs
 * @property {number} openPRs    count of open PRs (`gh pr list --state open`)
 * @property {number} openIssues count of open issues (`gh issue list --state open`)
 */

/**
 * Compose typed snapshot inputs into the on-disk `MetricSnapshot` shape.
 * Both metrics are `higherIsBetter: false` — a healthy repo trends
 * toward fewer open PRs and fewer open issues (Forsgren/Humble/Kim 2018,
 * "Accelerate" — lower WIP correlates with higher throughput).
 *
 * @param {SnapshotInputs} inputs
 * @returns {import("./metric-snapshot-store.mjs").MetricSnapshot}
 */
export function composeSnapshot({ openPRs, openIssues }) {
  if (!Number.isFinite(openPRs) || openPRs < 0) {
    throw new Error(`openPRs must be a non-negative finite number, got ${openPRs}`);
  }
  if (!Number.isFinite(openIssues) || openIssues < 0) {
    throw new Error(`openIssues must be a non-negative finite number, got ${openIssues}`);
  }
  return {
    open_prs: { value: openPRs, higherIsBetter: false },
    open_issues: { value: openIssues, higherIsBetter: false },
  };
}

/**
 * @typedef {(args: ReadonlyArray<string>) => Promise<string>} GhRunner
 *   Async runner returning stdout from `gh <args…>`. Tests inject a stub;
 *   the production binding shells out to the real `gh`.
 */

/**
 * @typedef {(args: {
 *   date: string,
 *   snapshot: import("./metric-snapshot-store.mjs").MetricSnapshot,
 * }) => Promise<string>} SaveSeam
 *   Persist `date`'s snapshot, returning the path written. Tests inject a
 *   stub that records the call; the production binding wraps
 *   `saveSnapshot({rootDir, date, snapshot, writeFile, mkdir})`.
 */

/**
 * Top-level orchestrator: fetch → compose → save. Runs the two `gh`
 * calls in parallel (independent — Promise.all) and persists the
 * snapshot via the injected `save` seam. Returns the path written so the
 * CLI can echo it.
 *
 * @param {{ date: string, runGh: GhRunner, save: SaveSeam }} opts
 * @returns {Promise<string>}
 */
export async function runChangelogSnapshot({ date, runGh, save }) {
  const [openPRsRaw, openIssuesRaw] = await Promise.all([
    runGh(["pr", "list", "--state", "open", "--json", "number", "--limit", "1000"]),
    runGh(["issue", "list", "--state", "open", "--json", "number", "--limit", "1000"]),
  ]);
  const snapshot = composeSnapshot({
    openPRs: parseGhCount(openPRsRaw),
    openIssues: parseGhCount(openIssuesRaw),
  });
  return save({ date, snapshot });
}

// ---- CLI thin wrapper -------------------------------------------------

/** @returns {string} */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** @type {GhRunner} */
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

/** @type {SaveSeam} */
function saveProd({ date, snapshot }) {
  return saveSnapshot({
    rootDir: process.cwd(),
    date,
    snapshot,
    writeFile: (path, contents) => fsWriteFile(path, contents),
    mkdir: (dir, opts) => fsMkdir(dir, opts),
  });
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ date: string | null }} */
  const args = { date: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date") args.date = argv[++i] ?? null;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date ?? todayUtc();
  const path = await runChangelogSnapshot({ date, runGh: spawnGh, save: saveProd });
  process.stdout.write(`${path}\n`);
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("changelog-snapshot.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
