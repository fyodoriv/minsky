#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved cto-audit-merge-rate-metric — aggregator for the
//   user-story-007 secondary metric `cto_audit_filed_tasks_merged_within_30d`
//   (the merge rate of daemon-CTO-audit-filed tasks). Rule-#4 visibility
//   (everything measurable), rule-#11 (no flaky metric is load-bearing —
//   the aggregation is deterministic given the same git+gh inputs). -->
//
// aggregate-cto-audit-metrics — compute the merge rate of TASKS.md task
// blocks the daemon's CTO audit filed, over a date window.
//
// What it does
// ------------
// 1. Reads the committed history of TASKS.md (`git log -p -- TASKS.md`) and
//    extracts every task ID whose block carries a `**Surfaced-by**: daemon
//    CTO audit <iso-date>` line (the marker user-story 007 § "Acceptance
//    criteria" requires on every audit-filed task). The first commit in
//    which a given ID's surfaced-by line appears is its "filed-at" time.
// 2. Filters to the IDs filed inside `[--since, --until]`.
// 3. Joins each ID against `gh pr list --json number,title,state,mergedAt`
//    (matched by task ID appearing in the PR title) to learn whether — and
//    when — a PR that fixes the task was merged.
// 4. A filed task counts as "merged within 30d" when a matching PR's
//    `mergedAt` is within 30 days *after* the task's filed-at time.
// 5. Emits a single JSON line: `{ts, audit_filed_count,
//    merged_within_30d_count, merge_rate}`. The dashboard's
//    `metric-snapshots` ingestion consumes the stream.
//
// Exit codes:
//   0 — aggregation succeeded; the JSON line is on stdout. The metric is
//       observational, not a gate — the script never fails on a low
//       merge rate (that judgement belongs to the Pivot threshold in
//       TASKS.md, evaluated by `jq -e '.merge_rate >= 0.4'`, not here).
//   2 — a flag was malformed (`--since`/`--until` not ISO-8601).
//
// Usage
// -----
//   node scripts/aggregate-cto-audit-metrics.mjs --since=2026-05-01 --until=2026-05-31
//   node scripts/aggregate-cto-audit-metrics.mjs --since=2026-05-01 --until=2026-05-31 | jq -e '.merge_rate >= 0.4'
//   node scripts/aggregate-cto-audit-metrics.mjs --repo=fyodoriv/minsky      # non-default repo for gh
//
// Pattern
// -------
// Pure-function-with-I/O-at-edge (Martin, *Clean Architecture* 2017): the
// join + merge-rate logic lives in pure functions (`extractAuditFiledTasks`,
// `joinMergedPrs`, `computeMergeRate`, `aggregate`) that take already-read
// data; the file/`gh` I/O lives only in `main`'s default dependency closures,
// replaceable via DI for the paired tests. Same shape as
// `scripts/check-cross-repo-pr-rate.mjs`.
//
// Anchors
// -------
//   - rule #11 (vision.md § 11 — no flaky metric is load-bearing): the
//     aggregation is a pure function of (git log, gh pr list); same inputs
//     → same `merge_rate` (rule #10 deterministic).
//   - rule #4 (vision.md § 4 — everything measurable, everything visible):
//     the secondary quality metric for the CTO audit becomes observable.
//   - user-stories/007-cto-audit-files-new-tasks.md § Metric — the >40%
//     merge-rate quality threshold this aggregator makes verifiable.
//   - Forsgren/Humble/Kim, *Accelerate* 2018 — DORA keys are ratios over a
//     fixed window, not per-iteration spot checks.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Milliseconds in 30 days — the merge-within window from user-story 007. */
export const MERGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The `**Surfaced-by**: daemon CTO audit` marker user-story 007 requires on
 * every audit-filed task. Match is case-insensitive on the phrase, tolerant
 * of the leading list indentation `git log -p` preserves.
 *
 * @type {RegExp}
 */
export const SURFACED_BY_CTO_AUDIT_RE = /\*\*Surfaced-by\*\*:\s*daemon CTO audit\b/i;

/** Matches `**ID**: <kebab-id>` (the tasks.md-spec ID field). */
export const TASK_ID_RE = /\*\*ID\*\*:\s*([a-z0-9][a-z0-9-]*)/i;

/**
 * @typedef {object} AuditFiledTask
 * @property {string} id        the task's kebab-case ID
 * @property {number} filedAtMs epoch ms of the commit that first introduced
 *   the surfaced-by marker for this ID
 */

/**
 * @typedef {object} PrRecord
 * @property {number} number
 * @property {string} title
 * @property {string} state      "OPEN" | "MERGED" | "CLOSED"
 * @property {string | null} mergedAt  ISO-8601, or null when never merged
 */

/**
 * @typedef {object} GitTaskCommit
 * @property {number} tsMs    commit committer-date epoch ms
 * @property {string} addedText  the lines this commit ADDED to TASKS.md
 *   (the `+`-prefixed body of the unified diff, stripped of the `+`)
 */

/**
 * @typedef {object} AuditLogEntry
 * @property {string} ts                  ISO-8601 timestamp
 * @property {"audit-skip"|"audit-retry-success"} event  entry type
 * @property {string} task                kebab-case task ID
 * @property {string|undefined} reason    reason (audit-skip only)
 * @property {number|undefined} retriesAttempted  (audit-skip only)
 * @property {number|undefined} retryCount        (audit-retry-success only)
 */

/**
 * @typedef {object} Rule9Metrics
 * @property {number} rule_9_reject_count        tasks skipped due to rule-9 failure (after retries)
 * @property {number} rule_9_retry_success_count tasks that succeeded on a retry
 * @property {number} rule_9_reject_rate         reject_count / (reject_count + filed_count)
 */

/**
 * @typedef {object} AggregateResult
 * @property {string} ts                         ISO-8601 generation time
 * @property {number} audit_filed_count          tasks filed in the window
 * @property {number} merged_within_30d_count    of those, merged ≤30d after filing
 * @property {number} merge_rate                 merged / filed (0 when filed=0)
 * @property {number} rule_9_reject_count        tasks rejected by rule-9 checker (audit-skipped)
 * @property {number} rule_9_retry_success_count tasks that were retried and succeeded
 * @property {number} rule_9_reject_rate         reject_count / (reject_count + filed_count)
 */

/**
 * Extract the audit-filed tasks from the per-commit TASKS.md additions.
 *
 * A task is "filed" at the EARLIEST commit that added a block carrying both
 * the surfaced-by-CTO-audit marker AND an `**ID**:` line. Processing commits
 * oldest-first and recording only the first occurrence of each ID makes the
 * filed-at time stable regardless of later edits to the same block
 * (idempotent re-files, priority bumps).
 *
 * Pure: same `commits` → same map. No I/O.
 *
 * @param {readonly GitTaskCommit[]} commits  oldest-first
 * @returns {Map<string, AuditFiledTask>}  keyed by task ID
 */
export function extractAuditFiledTasks(commits) {
  /** @type {Map<string, AuditFiledTask>} */
  const filed = new Map();
  for (const commit of commits) {
    if (!SURFACED_BY_CTO_AUDIT_RE.test(commit.addedText)) continue;
    for (const id of idsInAuditBlocks(commit.addedText)) {
      if (!filed.has(id)) {
        filed.set(id, { id, filedAtMs: commit.tsMs });
      }
    }
  }
  return filed;
}

/**
 * Find the IDs of task blocks in `addedText` that carry the CTO-audit
 * marker. A "block" is delimited by blank lines; the marker and the
 * `**ID**:` line must co-occur in the same block so we don't mis-attribute
 * an unrelated ID that happens to sit near the marker in the diff.
 *
 * @param {string} addedText
 * @returns {string[]}
 */
function idsInAuditBlocks(addedText) {
  /** @type {string[]} */
  const ids = [];
  for (const block of addedText.split(/\n\s*\n/)) {
    if (!SURFACED_BY_CTO_AUDIT_RE.test(block)) continue;
    const m = TASK_ID_RE.exec(block);
    if (m?.[1] !== undefined) ids.push(m[1].toLowerCase());
  }
  return ids;
}

/**
 * Join filed tasks against PR records. For each filed task, find a PR whose
 * title contains the task ID as a whole token; if that PR is merged within
 * `MERGE_WINDOW_MS` *after* the task's filed-at time, mark it merged.
 *
 * Pure: same inputs → same output.
 *
 * @param {ReadonlyMap<string, AuditFiledTask>} filed
 * @param {readonly PrRecord[]} prs
 * @returns {Map<string, boolean>}  task ID → mergedWithinWindow
 */
export function joinMergedPrs(filed, prs) {
  /** @type {Map<string, boolean>} */
  const merged = new Map();
  for (const task of filed.values()) {
    merged.set(task.id, isMergedInWindow(task, prs));
  }
  return merged;
}

/**
 * @param {AuditFiledTask} task
 * @param {readonly PrRecord[]} prs
 * @returns {boolean}
 */
function isMergedInWindow(task, prs) {
  for (const pr of prs) {
    if (pr.mergedAt === null) continue;
    if (!titleMentionsId(pr.title, task.id)) continue;
    const mergedMs = Date.parse(pr.mergedAt);
    if (Number.isNaN(mergedMs)) continue;
    const deltaMs = mergedMs - task.filedAtMs;
    if (deltaMs >= 0 && deltaMs <= MERGE_WINDOW_MS) return true;
  }
  return false;
}

/**
 * Whole-token match of `id` inside `title`. Avoids `foo` matching `foobar`
 * by requiring non-`[a-z0-9-]` boundaries (or string edges). Case-folded.
 *
 * @param {string} title
 * @param {string} id
 * @returns {boolean}
 */
export function titleMentionsId(title, id) {
  const lowerTitle = title.toLowerCase();
  const lowerId = id.toLowerCase();
  let from = 0;
  for (;;) {
    const idx = lowerTitle.indexOf(lowerId, from);
    if (idx === -1) return false;
    const before = idx === 0 ? "" : lowerTitle[idx - 1];
    const afterIdx = idx + lowerId.length;
    const after = afterIdx >= lowerTitle.length ? "" : lowerTitle[afterIdx];
    if (!isIdChar(before) && !isIdChar(after)) return true;
    from = idx + 1;
  }
}

/**
 * @param {string | undefined} ch
 * @returns {boolean}
 */
function isIdChar(ch) {
  return ch !== undefined && /[a-z0-9-]/.test(ch);
}

/**
 * Parse the audit-log JSONL text produced by `writeProposedTask` in
 * `novel/cross-repo-runner/src/host-cto-audit.ts`. Returns one typed entry
 * per non-blank line; malformed lines are silently skipped (graceful-degrade
 * rule #6 — the metric degrades to "no rejections observed" rather than
 * crashing the aggregator).
 *
 * Pure over the captured text so the test suite can exercise without I/O.
 *
 * @param {string} auditLogText  raw JSONL contents of `.minsky/audit-log.jsonl`
 * @returns {readonly AuditLogEntry[]}
 */
export function parseAuditLog(auditLogText) {
  /** @type {AuditLogEntry[]} */
  const entries = [];
  for (const line of auditLogText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && (parsed.event === "audit-skip" || parsed.event === "audit-retry-success")) {
        entries.push(/** @type {AuditLogEntry} */ (parsed));
      }
    } catch {
      // malformed line — skip
    }
  }
  return entries;
}

/**
 * Read the audit log from `.minsky/audit-log.jsonl` relative to `repoRoot`.
 * Returns [] when the file is missing (first run; no rejects yet).
 *
 * @param {string} repoRoot
 * @returns {readonly AuditLogEntry[]}
 */
export function readAuditLog(repoRoot) {
  const logPath = resolve(repoRoot, ".minsky", "audit-log.jsonl");
  if (!existsSync(logPath)) return [];
  try {
    return parseAuditLog(readFileSync(logPath, "utf8"));
  } catch {
    return [];
  }
}

/**
 * Compute rule-9 reject metrics from audit-log entries in a date window.
 * Pure: same inputs → same result.
 *
 * @param {readonly AuditLogEntry[]} entries
 * @param {number} sinceMs
 * @param {number} untilMs
 * @param {number} audit_filed_count  already-computed filed count (from git history)
 * @returns {Rule9Metrics}
 */
export function computeRule9Metrics(entries, sinceMs, untilMs, audit_filed_count) {
  let rule_9_reject_count = 0;
  let rule_9_retry_success_count = 0;
  for (const entry of entries) {
    const tsMs = Date.parse(entry.ts);
    if (Number.isNaN(tsMs) || tsMs < sinceMs || tsMs > untilMs) continue;
    if (entry.event === "audit-skip") rule_9_reject_count += 1;
    else if (entry.event === "audit-retry-success") rule_9_retry_success_count += 1;
  }
  const total = rule_9_reject_count + audit_filed_count;
  const rule_9_reject_rate = total === 0 ? 0 : roundTo(rule_9_reject_count / total, 4);
  return { rule_9_reject_count, rule_9_retry_success_count, rule_9_reject_rate };
}

/**
 * Compute the aggregate metric from the filed set + the merged-map.
 * Pure: same inputs → same result.
 *
 * @param {ReadonlyMap<string, AuditFiledTask>} filed
 * @param {ReadonlyMap<string, boolean>} mergedMap
 * @param {number} nowMs  generation clock (caller supplies for determinism)
 * @param {Rule9Metrics} [rule9]  optional rule-9 metrics (defaults to zeros)
 * @returns {AggregateResult}
 */
export function computeMergeRate(filed, mergedMap, nowMs, rule9) {
  const audit_filed_count = filed.size;
  let merged_within_30d_count = 0;
  for (const isMerged of mergedMap.values()) {
    if (isMerged) merged_within_30d_count += 1;
  }
  const merge_rate =
    audit_filed_count === 0 ? 0 : roundTo(merged_within_30d_count / audit_filed_count, 4);
  const r9 = rule9 ?? {
    rule_9_reject_count: 0,
    rule_9_retry_success_count: 0,
    rule_9_reject_rate: 0,
  };
  return {
    ts: new Date(nowMs).toISOString(),
    audit_filed_count,
    merged_within_30d_count,
    merge_rate,
    rule_9_reject_count: r9.rule_9_reject_count,
    rule_9_retry_success_count: r9.rule_9_retry_success_count,
    rule_9_reject_rate: r9.rule_9_reject_rate,
  };
}

/**
 * @param {number} n
 * @param {number} digits
 * @returns {number}
 */
function roundTo(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Full pure pipeline: commits + PRs + audit-log entries + window + clock → AggregateResult.
 * Filters filed tasks to the `[sinceMs, untilMs]` window before the join.
 *
 * @param {{
 *   commits: readonly GitTaskCommit[],
 *   prs: readonly PrRecord[],
 *   auditLogEntries?: readonly AuditLogEntry[],
 *   sinceMs: number,
 *   untilMs: number,
 *   nowMs: number,
 * }} input
 * @returns {AggregateResult}
 */
export function aggregate({ commits, prs, auditLogEntries, sinceMs, untilMs, nowMs }) {
  const allFiled = extractAuditFiledTasks(commits);
  /** @type {Map<string, AuditFiledTask>} */
  const inWindow = new Map();
  for (const [id, task] of allFiled) {
    if (task.filedAtMs >= sinceMs && task.filedAtMs <= untilMs) {
      inWindow.set(id, task);
    }
  }
  const mergedMap = joinMergedPrs(inWindow, prs);
  const rule9 = computeRule9Metrics(auditLogEntries ?? [], sinceMs, untilMs, inWindow.size);
  return computeMergeRate(inWindow, mergedMap, nowMs, rule9);
}

// --------------------------------------------------------------- args ------

/**
 * @typedef {object} ParsedArgs
 * @property {number} sinceMs
 * @property {number} untilMs
 * @property {string | undefined} repo
 * @property {number | undefined} nowMs
 */

/**
 * Parse an ISO-8601 date (or `YYYY-MM-DD`) into epoch ms. `--until` is
 * end-inclusive: a bare date snaps to the end of that UTC day so the window
 * covers the whole day, matching the operator's mental model of
 * `--until=2026-05-31` ("through May 31").
 *
 * @param {string} value
 * @param {"since" | "until"} kind
 * @returns {number}
 */
export function parseWindowDate(value, kind) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const suffix = dateOnly ? (kind === "until" ? "T23:59:59.999Z" : "T00:00:00.000Z") : "";
  const ms = Date.parse(`${value}${suffix}`);
  if (Number.isNaN(ms)) {
    throw new Error(`--${kind} must be ISO-8601 or YYYY-MM-DD; got '${value}'`);
  }
  return ms;
}

/**
 * Parse argv. Pure: returns the parsed shape, throws on malformed flags.
 *
 * @param {readonly string[]} argv
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  /** @type {ParsedArgs} */
  const result = {
    sinceMs: Number.NEGATIVE_INFINITY,
    untilMs: Number.POSITIVE_INFINITY,
    repo: undefined,
    nowMs: undefined,
  };
  for (const arg of argv) {
    applyOneArg(result, arg);
  }
  return result;
}

/**
 * Per-flag setter table. Table-driven so `applyOneArg` stays under biome's
 * cognitive-complexity ceiling (same shape as `check-cross-repo-pr-rate.mjs`
 * FLAG_HANDLERS). Each setter mutates the accumulator in place.
 *
 * @type {Record<string, (result: ParsedArgs, value: string) => void>}
 */
const FLAG_SETTERS = {
  "--since": (r, v) => {
    r.sinceMs = parseWindowDate(v, "since");
  },
  "--until": (r, v) => {
    r.untilMs = parseWindowDate(v, "until");
  },
  "--repo": (r, v) => {
    r.repo = v;
  },
  "--now": (r, v) => {
    const epoch = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    if (Number.isNaN(epoch)) throw new Error(`--now must be ISO-8601 or epoch ms; got '${v}'`);
    r.nowMs = epoch;
  },
};

/**
 * Apply one argv token to the accumulator. Extracted so `parseArgs` stays
 * under biome's cognitive-complexity ceiling.
 *
 * @param {ParsedArgs} result
 * @param {string} arg
 */
function applyOneArg(result, arg) {
  if (arg === "--help" || arg === "-h") {
    console.info(
      "Usage: aggregate-cto-audit-metrics.mjs [--since=ISO] [--until=ISO] [--repo=owner/name] [--now=ISO|EPOCH]",
    );
    process.exit(0);
  }
  const eqIdx = arg.indexOf("=");
  if (eqIdx === -1) throw new Error(`unknown flag: '${arg}'`);
  const key = arg.slice(0, eqIdx);
  const setter = FLAG_SETTERS[key];
  if (!setter) throw new Error(`unknown flag: '${key}'`);
  setter(result, arg.slice(eqIdx + 1));
}

// ----------------------------------------------------------------- I/O -----

/**
 * Read the per-commit TASKS.md additions from git history. Each commit's
 * committer-date + the `+`-added diff body (stripped of the `+` prefix)
 * becomes one `GitTaskCommit`. Oldest-first so the earliest-occurrence
 * dedupe in `extractAuditFiledTasks` is correct.
 *
 * Let-it-crash (rule #6): a non-git cwd throws from `execFileSync`; the CLI
 * entry's try/catch turns that into a non-zero exit with a one-line message.
 *
 * @param {string} repoRoot
 * @returns {GitTaskCommit[]}
 */
export function readTasksMdCommits(repoRoot) {
  // %x1e (record sep) between commits; %x1f (unit sep) between the timestamp
  // header and the patch body. `--reverse` gives oldest-first.
  const out = execFileSync(
    "git",
    ["log", "--reverse", "--format=%x1e%ct%x1f", "-p", "--no-color", "--", "TASKS.md"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  return parseGitLogPatches(out);
}

/**
 * Parse the `git log -p` stream into per-commit added-text records. Pure
 * over the captured stream so the test can exercise the parser without git.
 *
 * @param {string} stream
 * @returns {GitTaskCommit[]}
 */
export function parseGitLogPatches(stream) {
  /** @type {GitTaskCommit[]} */
  const commits = [];
  for (const record of stream.split("\x1e")) {
    if (record.trim().length === 0) continue;
    const sepIdx = record.indexOf("\x1f");
    if (sepIdx === -1) continue;
    const tsRaw = record.slice(0, sepIdx).trim();
    const tsMs = Number.parseInt(tsRaw, 10) * 1000;
    if (!Number.isFinite(tsMs)) continue;
    const patch = record.slice(sepIdx + 1);
    commits.push({ tsMs, addedText: collectAddedLines(patch) });
  }
  return commits;
}

/**
 * Pull the added lines (`+`-prefixed, excluding the `+++` file header) out of
 * a unified-diff patch body and return them joined, prefix-stripped.
 *
 * @param {string} patch
 * @returns {string}
 */
function collectAddedLines(patch) {
  /** @type {string[]} */
  const added = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added.push(line.slice(1));
    }
  }
  return added.join("\n");
}

/**
 * Read merged-PR records via `gh pr list`. Returns [] when `gh` is missing,
 * unauthenticated, or errors — the metric degrades to "no merges observed"
 * (graceful-degrade, rule #7) rather than crashing the daily snapshot.
 *
 * @param {string | undefined} repo
 * @returns {PrRecord[]}
 */
export function readMergedPrs(repo) {
  const args = [
    "pr",
    "list",
    "--state",
    "merged",
    "--limit",
    "1000",
    "--json",
    "number,title,state,mergedAt",
  ];
  if (repo !== undefined) args.push("--repo", repo);
  try {
    const out = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [];
    // rule-6: handled-locally — gh missing / 401 / non-JSON is an I/O
    // boundary failure, not a programming bug; the metric reads as
    // "no merges observed" so the daily snapshot still renders.
  } catch {
    return [];
  }
}

/**
 * Run the CLI. Returns the exit code so tests can assert without
 * `process.exit`. I/O is injected via `deps` (DI seam — rule #2).
 *
 * @param {readonly string[]} argv
 * @param {{
 *   readCommits?: (repoRoot: string) => GitTaskCommit[],
 *   readPrs?: (repo: string | undefined) => PrRecord[],
 *   readLog?: (repoRoot: string) => readonly AuditLogEntry[],
 *   writeLine?: (line: string) => void,
 *   repoRoot?: string,
 *   nowMs?: number,
 * }} [deps]
 * @returns {number}
 */
export function main(argv, deps = {}) {
  const {
    readCommits = readTasksMdCommits,
    readPrs = readMergedPrs,
    readLog = readAuditLog,
    writeLine = console.info,
    repoRoot = REPO_ROOT,
  } = deps;
  const args = parseArgs(argv);
  const nowMs = args.nowMs ?? deps.nowMs ?? Date.now();
  const commits = readCommits(repoRoot);
  const prs = readPrs(args.repo);
  const auditLogEntries = readLog(repoRoot);
  const result = aggregate({
    commits,
    prs,
    auditLogEntries,
    sinceMs: args.sinceMs,
    untilMs: args.untilMs,
    nowMs,
  });
  writeLine(JSON.stringify(result));
  return 0;
}

/**
 * CLI-entry guard that survives macOS's `/tmp` → `/private/tmp` symlink.
 *
 * @returns {boolean}
 */
function isCliEntry() {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return resolve(argv1) === fileURLToPath(import.meta.url);
}

if (isCliEntry()) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`aggregate-cto-audit-metrics: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}

export { REPO_ROOT };
