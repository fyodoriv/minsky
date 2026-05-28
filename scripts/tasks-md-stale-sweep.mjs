#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved tasks-md-hygiene per tasks-md-stale-sweep -->
//
// tasks-md-stale-sweep — find TASKS.md entries whose described
// fix has ALREADY shipped, so the next agent doesn't waste pre-claim
// inspection time rediscovering the closure.
//
// HEURISTIC (single, conservative, evidence-based):
//   For each unblocked, unclaimed task:
//     1. Parse the `**Files**:` field for cited paths.
//     2. For each cited path that exists on disk: grep its content
//        for the task `**ID**:` value.
//     3. If a citation is found, flag the task as a likely-shipped
//        candidate and print the file path + line where the citation
//        appears.
//   The citation signal is strong: 6 of 6 PRs in the 2026-05-28 session
//   that closed stale markers had the same shape — the fix had landed
//   with an inline comment citing the task ID, and the marker just
//   outlived the implementation.
//
// CONSERVATIVE: skips tasks with `**Blocked**:` or `**Blocked by**:`
// (those are handled by separate workflows). Never auto-removes the
// task block — `--dry-run` is the only mode. Operators (or the next
// agent's pre-claim inspection) confirm + remove.
//
// USAGE:
//   node scripts/tasks-md-stale-sweep.mjs --dry-run
//
// EXIT CODES:
//   0 — no candidates flagged (no work)
//   0 — candidates flagged (informational; exit-zero so this can
//       be wired into pre-pr-lint advisory mode without failing CI)
//
// ANCHORS: rule #17 (proactive healing — file the recurring pattern
// as work); operator session pattern 2026-05-28 (6 stale markers
// across one session, PRs #946 #947 #948 #951 #952 #955).

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * @typedef {object} TaskBlock
 * @property {string} id
 * @property {string} firstLine
 * @property {string} body
 */

/**
 * @typedef {object} StaleCandidate
 * @property {string} id
 * @property {string} firstLineSnippet
 * @property {{path: string, line: number, snippet: string}[]} evidence
 */

/**
 * Parse TASKS.md into task blocks. A block starts at a checkbox line
 * (`- [ ] \`<id>\` …`) and continues until the next checkbox or end.
 *
 * @param {string} body
 * @returns {TaskBlock[]}
 */
export function parseTaskBlocks(body) {
  /** @type {TaskBlock[]} */
  const out = [];
  const lines = body.split("\n");
  /** @type {string[]} */
  let buf = [];
  let firstLine = "";
  const flush = () => {
    if (buf.length === 0) return;
    const block = buf.join("\n");
    const idMatch = /\*\*ID\*\*:\s*([a-z0-9-]+)/.exec(block);
    const titleMatch = /^- \[ \]\s+`([a-z0-9-]+)`/.exec(firstLine);
    const id = idMatch?.[1] ?? titleMatch?.[1] ?? "(unknown)";
    out.push({ id, firstLine, body: block });
    buf = [];
    firstLine = "";
  };
  for (const line of lines) {
    if (/^- \[ \]\s+`/.test(line)) {
      flush();
      firstLine = line;
      buf.push(line);
    } else if (buf.length > 0) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

const PATH_SHAPED_RE =
  /\/|\.\w{2,5}$|^(bin|scripts|novel|src|user-stories|distribution|docs|tests)\//;

/**
 * Extract `**Files**:` paths from a task body. Returns absolute path
 * strings (resolved against repoRoot). Handles both inline form
 * `**Files**: a.ts, b.ts` and continuation-line form.
 *
 * @param {string} taskBody
 * @returns {string[]}
 */
export function extractFilePaths(taskBody) {
  const filesMatch = /\*\*Files\*\*:\s*([^\n]+(?:\n {4,}[^\n]+)*)/m.exec(taskBody);
  if (!filesMatch || filesMatch[1] === undefined) return [];
  const raw = filesMatch[1];
  /** @type {string[]} */
  const paths = [];
  for (const match of raw.matchAll(/`([^`]+)`/g)) {
    const value = match[1];
    if (value === undefined) continue;
    const candidate = value.trim();
    if (PATH_SHAPED_RE.test(candidate)) {
      paths.push(candidate);
    }
  }
  return paths;
}

/**
 * Check if a task body has a non-empty `**Blocked**:` or
 * `**Blocked by**:` field.
 *
 * @param {string} taskBody
 * @returns {boolean}
 */
export function isBlocked(taskBody) {
  return /\*\*Blocked( by)?\*\*:\s*\S/.test(taskBody);
}

/**
 * Check if the task's first line has a `(@agent-name)` claim.
 *
 * @param {string} firstLine
 * @returns {boolean}
 */
export function isClaimed(firstLine) {
  return /\(@/.test(firstLine);
}

/**
 * Negative-signal regex: when the citing line contains one of these
 * patterns near the task ID, it likely RECORDS that the task is still
 * unshipped (e.g. "filed as a follow-up", "TODO: address X", or "see
 * TASKS.md X for context"). Treat those as NOT a fix-shipped signal.
 */
const NEGATIVE_SIGNAL_RE =
  /\b(filed as|follow-?up|TODO|FIXME|HACK|deferred|wishlist|backlog|pending|future|will land|next session|not yet implemented|not yet supported|stub|placeholder)\b/i;

/**
 * Read a file's text, returning null on missing or unreadable.
 *
 * @param {string} absPath
 * @returns {string | null}
 */
function readFileOrNull(absPath) {
  if (!existsSync(absPath)) return null;
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Find citations of `taskId` inside `content`, filtering out lines
 * that match NEGATIVE_SIGNAL_RE in the line ±1 context.
 *
 * @param {string} taskId
 * @param {string} content
 * @param {string} cleanPath
 * @returns {{path: string, line: number, snippet: string}[]}
 */
function citationsInContent(taskId, content, cleanPath) {
  /** @type {{path: string, line: number, snippet: string}[]} */
  const hits = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || !line.includes(taskId)) continue;
    const prev = lines[Math.max(0, i - 1)] ?? "";
    const next = lines[i + 1] ?? "";
    if (NEGATIVE_SIGNAL_RE.test(`${prev}\n${line}\n${next}`)) continue;
    hits.push({
      path: cleanPath,
      line: i + 1,
      snippet: line.trim().slice(0, 140),
    });
  }
  return hits;
}

/**
 * For a given task ID, find inline citations across the cited files.
 * Returns ONLY fix-shipped-shaped citations (excludes negative-signal
 * lines like "filed as a follow-up: <task-id>").
 *
 * @param {string} taskId
 * @param {string[]} paths     resolved paths relative to repoRoot
 * @param {string} repoRoot
 * @returns {{path: string, line: number, snippet: string}[]}
 */
export function findCitations(taskId, paths, repoRoot) {
  /** @type {{path: string, line: number, snippet: string}[]} */
  const hits = [];
  for (const relPath of paths) {
    // Strip trailing line refs like `foo.mjs:48` → `foo.mjs`.
    const cleanPath = relPath.replace(/:\d+$/, "");
    const content = readFileOrNull(resolve(repoRoot, cleanPath));
    if (content === null) continue;
    hits.push(...citationsInContent(taskId, content, cleanPath));
  }
  return hits;
}

/**
 * @param {TaskBlock} task
 * @returns {boolean}
 */
function isSweepable(task) {
  if (task.id === "(unknown)") return false;
  if (isBlocked(task.body)) return false;
  if (isClaimed(task.firstLine)) return false;
  return true;
}

/**
 * Pure entry point — given TASKS.md content + a repo root, return the
 * list of stale-marker candidates with evidence.
 *
 * @param {string} tasksMdContent
 * @param {string} repoRoot
 * @returns {StaleCandidate[]}
 */
export function sweepStaleTasksMdMarkers(tasksMdContent, repoRoot) {
  const blocks = parseTaskBlocks(tasksMdContent);
  /** @type {StaleCandidate[]} */
  const candidates = [];
  for (const task of blocks) {
    if (!isSweepable(task)) continue;
    const paths = extractFilePaths(task.body);
    if (paths.length === 0) continue;
    const evidence = findCitations(task.id, paths, repoRoot);
    if (evidence.length === 0) continue;
    candidates.push({
      id: task.id,
      firstLineSnippet: task.firstLine.slice(0, 120),
      evidence,
    });
  }
  return candidates;
}

// ── CLI ─────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun) {
    console.error("usage: node scripts/tasks-md-stale-sweep.mjs --dry-run");
    console.error(
      "  (read-only sweep; auto-remove is not implemented — operators confirm + delete)",
    );
    process.exit(2);
  }
  const tasksMdPath = resolve(REPO_ROOT, "TASKS.md");
  if (!existsSync(tasksMdPath)) {
    console.error(`TASKS.md not found at ${tasksMdPath}`);
    process.exit(1);
  }
  const content = readFileSync(tasksMdPath, "utf8");
  const candidates = sweepStaleTasksMdMarkers(content, REPO_ROOT);
  if (candidates.length === 0) {
    process.exit(0);
  }
  for (const c of candidates) {
    for (const _e of c.evidence) {
    }
  }
  process.exit(0);
}
