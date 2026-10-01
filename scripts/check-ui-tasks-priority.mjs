#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-ui-tasks-default-p0-p1-not-p2-p3 (PR #911) -->
//
// check-ui-tasks-priority — every user-facing CLI surface task defaults
// to P0/P1 priority per AGENTS.md §"All user interface is P0-P1 (by
// definition)". Operator directive 2026-05-27.
//
// Walks every task block in TASKS.md under `## P2` / `## P3` sections and
// fails if any of them carries a UI-shaped tag or matches a UI-shaped
// keyword in the description, UNLESS the block explicitly opts out via
// `**Deferred-because**: <reason ≥3 chars>`.
//
// Anchors: AGENTS.md §"All user interface is P0-P1 (by definition)"
// (operator directive 2026-05-27); vision rule #10.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Tag set that, if present on a task's `**Tags**:` line, marks it as a
 * UI task. Lowercased + trim-compared.
 *
 * @type {readonly string[]}
 */
export const UI_TAGS = Object.freeze([
  "ux",
  "ui",
  "cli",
  "cli-consolidation",
  "dashboard",
  "operator-ux",
  "operator-facing",
  "minsky-supervisor",
  "watch",
  "install",
  "install-success",
  "doctor",
]);

/**
 * Keyword regex set that, if present in a task's title or description,
 * marks it as a UI task. Each is applied to the first line of the task
 * block (the `- [ ] \`<id>\` — <description>` line).
 *
 * @type {readonly RegExp[]}
 */
export const UI_KEYWORDS = Object.freeze([
  /`bin\/minsky\b/,
  /`pnpm minsky:/,
  /minsky watch\b/i,
  /\b--help\b/,
  /\bsane defaults?\b/i,
  /\bdashboard widget\b/i,
]);

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {number} scannedCount
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [tasksMdPath]
 * @property {string} [tasksMdContent]   override; takes precedence over path
 * @property {(p: string) => string} [readText]
 */

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkUiTasksPriority(opts = {}) {
  const readText = opts.readText ?? ((p) => readFileSync(p, "utf8"));
  const path = opts.tasksMdPath ?? `${REPO_ROOT}/TASKS.md`;
  const content = opts.tasksMdContent ?? readText(path);

  const sections = extractSections(content);
  /** @type {string[]} */
  const violations = [];
  let scanned = 0;

  for (const section of ["P2", "P3"]) {
    scanned += scanSection(section, sections[section], violations);
  }

  return { ok: violations.length === 0, violations, scannedCount: scanned };
}

/**
 * @param {string} section
 * @param {string | undefined} body
 * @param {string[]} violations
 * @returns {number}
 */
function scanSection(section, body, violations) {
  if (body === undefined) return 0;
  const tasks = parseTaskBlocks(body);
  for (const t of tasks) {
    if (isUiTask(t) && !hasDeferralOptOut(t)) {
      violations.push(
        `${t.id} (in ${section}): UI-tagged task at ${section}; per AGENTS.md §"All UI is P0-P1" must be P0 or P1, OR carry **Deferred-because**: <reason ≥3 chars>`,
      );
    }
  }
  return tasks.length;
}

/**
 * @typedef {object} TaskBlock
 * @property {string} id          parsed from `**ID**:` or first-line backticks
 * @property {string} firstLine
 * @property {string} body        full block text
 */

/**
 * Split content into priority sections. Returns a map `{P0, P1, P2, P3} → body`.
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
function extractSections(content) {
  /** @type {Record<string, string>} */
  const out = {};
  // Split on top-level priority headings; `## P0` / `## P1` etc. anchored
  // at line start. Each split chunk corresponds to one section's body.
  const lines = content.split("\n");
  /** @type {string | null} */
  let current = null;
  /** @type {string[]} */
  let buf = [];
  const flush = () => {
    if (current !== null) {
      out[current] = buf.join("\n");
    }
    buf = [];
  };
  for (const line of lines) {
    const m = /^## (P[0-3])\b/.exec(line);
    if (m !== null && m[1] !== undefined) {
      flush();
      current = m[1];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/**
 * Parse a section's body into task blocks. A block starts with a checkbox
 * (`- [ ] \`<id>\` …`) and continues until the next checkbox or end.
 *
 * @param {string} body
 * @returns {TaskBlock[]}
 */
function parseTaskBlocks(body) {
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

/**
 * @param {TaskBlock} task
 * @returns {boolean}
 */
function isUiTask(task) {
  // Check Tags line
  const tagsMatch = /\*\*Tags\*\*:\s*(.+)$/m.exec(task.body);
  if (tagsMatch?.[1] !== undefined) {
    const tags = tagsMatch[1].split(",").map((s) => s.trim().toLowerCase());
    if (tags.some((t) => UI_TAGS.includes(t))) {
      return true;
    }
  }
  // Check keyword regexes against the first line (description).
  return UI_KEYWORDS.some((re) => re.test(task.firstLine));
}

/**
 * @param {TaskBlock} task
 * @returns {boolean}
 */
function hasDeferralOptOut(task) {
  const m = /\*\*Deferred-because\*\*:\s*(.{3,})/m.exec(task.body);
  return m !== null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkUiTasksPriority();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-ui-tasks-priority: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  console.error("");
  console.error(
    "Fix: promote the task to P0/P1, OR add `**Deferred-because**: <reason ≥3 chars>` on a new line in the task block.",
  );
  process.exit(1);
}
