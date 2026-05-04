#!/usr/bin/env node
// Rule #7 (chaos engineering) CI lint.
//
// For each `novel/**/README.md`, verifies:
//   (a) it contains a `## Failure modes & chaos verification` section, per the
//       file-level policy in TASKS.md.
//   (b) below that section is a markdown failure-mode table whose header
//       includes a "Chaos test" column.
//   (c) every data row's "Chaos test" cell is one of:
//       - a path matching `novel/**/*.test.ts` that exists in the repo;
//       - the literal pattern `(deferred — covered when <task-id> ships)`
//         where `<task-id>` is a kebab-case ID present in TASKS.md or in
//         the output of `git log --grep="closes <task-id>"`;
//       - a lenient prose reference that names a test file, fixture, or
//         assertion (the cell must contain at least one of `test`,
//         `fixture`, or `assert` to count). Cells that begin with the
//         literal `(deferred` MUST match the strict deferred-task form
//         above; informal prose that begins with `(deferred …)` is
//         rejected to keep the deferral substrate machine-readable.
//   (d) a cell that fails any of the above is reported, along with the
//       README-relative row number.
//
// The linter wraps a pure function (`checkChaosCoverage`) so the test file
// can drive it deterministically.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const SECTION_HEADING = "## Failure modes & chaos verification";

// `(deferred — covered when <kebab-id> ships)`.
// Em-dash is U+2014. The trailing description after `ships` is allowed but
// not required; everything up through `ships` is mandatory.
const DEFERRED_RE = /\(deferred\s*—\s*covered\s+when\s+`?([a-z][a-z0-9-]*[a-z0-9])`?\s+ships\b/i;

// Anywhere-in-cell reference to a `.test.ts` path under novel/.
const TEST_PATH_RE = /(novel\/[A-Za-z0-9._/-]+?\.test\.ts)/;

// Lenient signal that the prose names a test / fixture / assertion. The cell
// must contain at least one of these tokens (case-insensitive) AFTER the
// strict checks fail, otherwise it's flagged as missing a chaos-test reference.
const LENIENT_TOKENS = /\b(test|fixture|assert)/i;

// ---- pure function ----------------------------------------------------------

/**
 * @param {{
 *   readmes: { path: string, content: string }[],
 *   tasksMdContent: string,
 *   testFiles: Set<string>,
 *   gitClosedTaskIds?: Set<string>,
 * }} input
 * @returns {{ errors: { readme: string, row: number | null, message: string }[] }}
 */
export function checkChaosCoverage({
  readmes,
  tasksMdContent,
  testFiles,
  gitClosedTaskIds = new Set(),
}) {
  const knownTaskIds = parseTaskIds(tasksMdContent);
  const errors = [];
  for (const r of readmes) {
    errors.push(...checkOneReadme(r, { knownTaskIds, gitClosedTaskIds, testFiles }));
  }
  return { errors };
}

/**
 * @param {{ path: string, content: string }} readme
 * @param {{ knownTaskIds: Set<string>, gitClosedTaskIds: Set<string>, testFiles: Set<string> }} ctx
 * @returns {{ readme: string, row: number | null, message: string }[]}
 */
function checkOneReadme({ path, content }, ctx) {
  const sectionStart = findHeadingIndex(content, SECTION_HEADING);
  if (sectionStart === -1) {
    return [
      {
        readme: path,
        row: null,
        message: `missing "${SECTION_HEADING}" section (rule #7 file-level policy)`,
      },
    ];
  }

  const sectionEnd = findNextHeadingAtOrBelow(content, sectionStart, 2);
  const section = content.slice(sectionStart, sectionEnd);

  const table = parseFirstTable(section);
  if (!table) {
    return [
      {
        readme: path,
        row: null,
        message: `"${SECTION_HEADING}" section contains no markdown table`,
      },
    ];
  }

  const chaosColIdx = table.headers.findIndex((h) => h.toLowerCase().trim() === "chaos test");
  if (chaosColIdx === -1) {
    return [
      {
        readme: path,
        row: null,
        message: `failure-mode table is missing a "Chaos test" column`,
      },
    ];
  }

  const errors = [];
  for (const [i, row] of table.rows.entries()) {
    const cell = (row[chaosColIdx] ?? "").trim();
    const verdict = classifyChaosCell({ cell, ...ctx });
    if (verdict.ok) continue;
    errors.push({ readme: path, row: i + 1, message: verdict.reason });
  }
  return errors;
}

/**
 * @param {{ cell: string, knownTaskIds: Set<string>, gitClosedTaskIds: Set<string>, testFiles: Set<string> }} args
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function classifyChaosCell({ cell, knownTaskIds, gitClosedTaskIds, testFiles }) {
  if (cell === "") {
    return { ok: false, reason: `"Chaos test" cell is empty` };
  }

  const deferredMatch = cell.match(DEFERRED_RE);
  if (deferredMatch) {
    const taskId = deferredMatch[1];
    if (knownTaskIds.has(taskId) || gitClosedTaskIds.has(taskId)) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `"Chaos test" cell defers to unknown task-id "${taskId}" (not in TASKS.md or git log)`,
    };
  }

  // Cells that *start* with `(deferred` but don't match the strict form are
  // rejected — the deferral substrate must be machine-readable so an external
  // task-id is locatable.
  if (/^\s*\(deferred\b/i.test(cell)) {
    return {
      ok: false,
      reason: `"Chaos test" cell uses the deferred prefix but not the strict form \`(deferred — covered when <task-id> ships)\``,
    };
  }

  const pathMatch = cell.match(TEST_PATH_RE);
  if (pathMatch) {
    const path = pathMatch[1];
    if (testFiles.has(path)) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `"Chaos test" cell names test file "${path}" but it does not exist`,
    };
  }

  if (LENIENT_TOKENS.test(cell)) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `"Chaos test" cell has no recognizable test / fixture / assertion reference`,
  };
}

// ---- TASKS.md parsing -------------------------------------------------------

/**
 * Extract every `**ID**: <kebab-id>` entry from TASKS.md.
 * @param {string} content
 * @returns {Set<string>}
 */
export function parseTaskIds(content) {
  const ids = new Set();
  // Match "  - **ID**: my-task-id" or "**ID**: my-task-id".
  const re = /\*\*ID\*\*:\s*`?([a-z][a-z0-9-]*[a-z0-9])`?/g;
  for (const m of content.matchAll(re)) {
    ids.add(m[1]);
  }
  return ids;
}

// ---- Markdown helpers -------------------------------------------------------

/**
 * Returns the byte offset of the heading line, or -1.
 * Matches a level-2 heading with the exact title (allowing trailing spaces).
 */
function findHeadingIndex(content, heading) {
  const lines = content.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    if (line.replace(/\s+$/, "") === heading) {
      return offset;
    }
    offset += line.length + 1; // +1 for the newline
  }
  return -1;
}

/**
 * Find the next heading at the given level or shallower (i.e., for level=2,
 * the next `^# ` or `^## `). Returns content.length if none.
 */
function findNextHeadingAtOrBelow(content, startOffset, level) {
  const tail = content.slice(startOffset);
  const lines = tail.split(/\r?\n/);
  let offset = 0;
  // Skip the first line (the heading itself).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0) {
      const m = line.match(/^(#{1,6})\s/);
      if (m && m[1].length <= level) {
        return startOffset + offset;
      }
    }
    offset += line.length + 1;
  }
  return content.length;
}

/**
 * Parse the first markdown pipe-table inside `text` and return its
 * headers + rows. Returns null if no table is found.
 *
 * @param {string} text
 * @returns {{ headers: string[], rows: string[][] } | null}
 */
export function parseFirstTable(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i];
    const sep = lines[i + 1];
    if (!isPipeRow(header)) continue;
    if (!isSeparatorRow(sep)) continue;
    const headers = splitPipeRow(header);
    const rows = [];
    for (let j = i + 2; j < lines.length; j++) {
      const r = lines[j];
      if (!isPipeRow(r)) break;
      rows.push(splitPipeRow(r));
    }
    return { headers, rows };
  }
  return null;
}

function isPipeRow(line) {
  // A line that contains at least one `|` and isn't a fenced-code line.
  if (!line.includes("|")) return false;
  if (/^\s*```/.test(line)) return false;
  return true;
}

function isSeparatorRow(line) {
  // `| --- | --- |` or `|---|---|`. Each cell is hyphens with optional `:`.
  if (!isPipeRow(line)) return false;
  const cells = splitPipeRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

function splitPipeRow(line) {
  // Trim outer whitespace and outer pipes, then split on unescaped pipes.
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  // Split on unescaped pipes. We don't support `\|` escapes inside cells
  // currently — none of the existing tables use them.
  return s.split("|").map((c) => c.trim());
}

// ---- CLI walker -------------------------------------------------------------

function walkReadmes(rootDir) {
  /** @type {{ path: string, content: string }[]} */
  const out = [];
  const novelDir = join(rootDir, "novel");
  if (!existsSync(novelDir)) return out;
  for (const entry of walkDir(novelDir)) {
    if (entry.endsWith("/README.md") || entry.endsWith("\\README.md")) {
      out.push({
        path: relative(rootDir, entry).split(/[\\/]/).join("/"),
        content: readFileSync(entry, "utf-8"),
      });
    }
  }
  return out;
}

function walkTestFiles(rootDir) {
  /** @type {Set<string>} */
  const out = new Set();
  const novelDir = join(rootDir, "novel");
  if (!existsSync(novelDir)) return out;
  for (const entry of walkDir(novelDir)) {
    if (entry.endsWith(".test.ts")) {
      out.add(relative(rootDir, entry).split(/[\\/]/).join("/"));
    }
  }
  return out;
}

function* walkDir(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkDir(full);
    } else if (st.isFile()) {
      yield full;
    }
  }
}

function readGitClosedTaskIds(rootDir) {
  /** @type {Set<string>} */
  const ids = new Set();
  try {
    const out = execFileSync("git", ["log", "--all", "--format=%B"], {
      cwd: rootDir,
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const re = /closes\s+([a-z][a-z0-9-]*[a-z0-9])\b/gi;
    for (const m of out.matchAll(re)) {
      ids.add(m[1].toLowerCase());
    }
  } catch {
    // Git not available — fine; the linter still works against TASKS.md only.
  }
  return ids;
}

// ---- main ------------------------------------------------------------------

function main() {
  const readmes = walkReadmes(REPO_ROOT);
  const testFiles = walkTestFiles(REPO_ROOT);
  const tasksPath = join(REPO_ROOT, "TASKS.md");
  const tasksMdContent = existsSync(tasksPath) ? readFileSync(tasksPath, "utf-8") : "";
  const gitClosedTaskIds = readGitClosedTaskIds(REPO_ROOT);

  const { errors } = checkChaosCoverage({
    readmes,
    tasksMdContent,
    testFiles,
    gitClosedTaskIds,
  });

  if (errors.length === 0) {
    console.info(
      `rule-7-chaos-coverage: OK (${readmes.length} README${readmes.length === 1 ? "" : "s"} checked)`,
    );
    process.exit(0);
  }

  for (const e of errors) {
    const where = e.row === null ? "" : ` row ${e.row}`;
    console.error(`${e.readme}${where}: ${e.message}`);
  }
  console.error(
    `rule-7-chaos-coverage: ${errors.length} violation${errors.length === 1 ? "" : "s"}`,
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
