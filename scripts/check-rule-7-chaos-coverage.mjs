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
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
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

  /** @type {{ readme: string, row: number | null, message: string }[]} */
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
 * @typedef {{ ok: true } | { ok: false, reason: string }} ChaosCellVerdict
 */

/**
 * @param {string} cell
 * @param {Set<string>} knownTaskIds
 * @param {Set<string>} gitClosedTaskIds
 * @returns {ChaosCellVerdict | null}
 */
function classifyDeferred(cell, knownTaskIds, gitClosedTaskIds) {
  const deferredMatch = cell.match(DEFERRED_RE);
  if (!deferredMatch) return null;
  const taskId = deferredMatch[1];
  if (taskId !== undefined && (knownTaskIds.has(taskId) || gitClosedTaskIds.has(taskId))) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `"Chaos test" cell defers to unknown task-id "${taskId ?? ""}" (not in TASKS.md or git log)`,
  };
}

/**
 * @param {string} cell
 * @param {Set<string>} testFiles
 * @returns {ChaosCellVerdict | null}
 */
function classifyTestPath(cell, testFiles) {
  const pathMatch = cell.match(TEST_PATH_RE);
  if (!pathMatch) return null;
  const path = pathMatch[1];
  if (path !== undefined && testFiles.has(path)) return { ok: true };
  return {
    ok: false,
    reason: `"Chaos test" cell names test file "${path ?? ""}" but it does not exist`,
  };
}

/**
 * @param {{ cell: string, knownTaskIds: Set<string>, gitClosedTaskIds: Set<string>, testFiles: Set<string> }} args
 * @returns {ChaosCellVerdict}
 */
function classifyChaosCell({ cell, knownTaskIds, gitClosedTaskIds, testFiles }) {
  if (cell === "") return { ok: false, reason: `"Chaos test" cell is empty` };

  const deferred = classifyDeferred(cell, knownTaskIds, gitClosedTaskIds);
  if (deferred !== null) return deferred;

  // Cells that *start* with `(deferred` but don't match the strict form are
  // rejected — the deferral substrate must be machine-readable so an external
  // task-id is locatable.
  if (/^\s*\(deferred\b/i.test(cell)) {
    return {
      ok: false,
      reason: `"Chaos test" cell uses the deferred prefix but not the strict form \`(deferred — covered when <task-id> ships)\``,
    };
  }

  const pathVerdict = classifyTestPath(cell, testFiles);
  if (pathVerdict !== null) return pathVerdict;

  if (LENIENT_TOKENS.test(cell)) return { ok: true };

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
  /** @type {Set<string>} */
  const ids = new Set();
  // Match "  - **ID**: my-task-id" or "**ID**: my-task-id".
  const re = /\*\*ID\*\*:\s*`?([a-z][a-z0-9-]*[a-z0-9])`?/g;
  for (const m of content.matchAll(re)) {
    const id = m[1];
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

// ---- Markdown helpers -------------------------------------------------------

/**
 * Returns the byte offset of the heading line, or -1.
 * Matches a level-2 heading with the exact title (allowing trailing spaces).
 *
 * @param {string} content
 * @param {string} heading
 * @returns {number}
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
 *
 * @param {string} content
 * @param {number} startOffset
 * @param {number} level
 * @returns {number}
 */
function findNextHeadingAtOrBelow(content, startOffset, level) {
  const tail = content.slice(startOffset);
  const lines = tail.split(/\r?\n/);
  let offset = 0;
  // Skip the first line (the heading itself).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (i > 0) {
      const m = line.match(/^(#{1,6})\s/);
      if (m !== null && m[1] !== undefined && m[1].length <= level) {
        return startOffset + offset;
      }
    }
    offset += line.length + 1;
  }
  return content.length;
}

/**
 * Collect contiguous pipe-rows starting at `startIdx` in `lines`.
 *
 * @param {string[]} lines
 * @param {number} startIdx
 * @returns {string[][]}
 */
function collectTableRows(lines, startIdx) {
  /** @type {string[][]} */
  const rows = [];
  for (let j = startIdx; j < lines.length; j++) {
    const r = lines[j];
    if (r === undefined || !isPipeRow(r)) break;
    rows.push(splitPipeRow(r));
  }
  return rows;
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
    if (header === undefined || sep === undefined) continue;
    if (!isPipeRow(header) || !isSeparatorRow(sep)) continue;
    return { headers: splitPipeRow(header), rows: collectTableRows(lines, i + 2) };
  }
  return null;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isPipeRow(line) {
  // A line that contains at least one `|` and isn't a fenced-code line.
  if (!line.includes("|")) return false;
  if (/^\s*```/.test(line)) return false;
  return true;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isSeparatorRow(line) {
  // `| --- | --- |` or `|---|---|`. Each cell is hyphens with optional `:`.
  if (!isPipeRow(line)) return false;
  const cells = splitPipeRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

/**
 * @param {string} line
 * @returns {string[]}
 */
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

/**
 * @param {string} rootDir
 * @returns {{ path: string, content: string }[]}
 */
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

/**
 * @param {string} rootDir
 * @returns {Set<string>}
 */
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

/**
 * Resolve `dir` to its canonical path. Returns null if the path can't be
 * stat'd (deleted under us, permission denied, etc.).
 *
 * @param {string} dir
 * @returns {string | null}
 */
function safeRealpath(dir) {
  try {
    return realpathSync(dir);
  } catch {
    return null;
  }
}

/**
 * Read the directory entries, returning [] on any I/O error rather than
 * propagating — the linter is best-effort, not transactional.
 *
 * @param {string} dir
 * @returns {import("node:fs").Dirent[]}
 */
function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * @param {import("node:fs").Dirent} entry
 * @returns {boolean}
 */
function shouldSkipEntry(entry) {
  const name = entry.name;
  if (name === "node_modules" || name.startsWith(".")) return true;
  if (entry.isSymbolicLink()) return true; // skip symlinks to avoid loops
  return false;
}

/**
 * Recursively walk `dir`, yielding every regular-file path. Symlinks are
 * skipped entirely (rather than followed) so that pathological loops like
 * `a -> b/`, `b -> a/` cannot inode-exhaust the linter. The walker is also
 * defensive against multiple paths into the same canonical directory by
 * tracking visited canonical paths via `realpathSync`.
 *
 * @param {string} dir
 * @param {Set<string>} [visited]
 * @returns {Generator<string, void, void>}
 */
export function* walkDir(dir, visited = new Set()) {
  const canonical = safeRealpath(dir);
  if (canonical === null || visited.has(canonical)) return;
  visited.add(canonical);

  for (const entry of safeReaddir(dir)) {
    if (shouldSkipEntry(entry)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(full, visited);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/**
 * Parse a `git log` text blob and return every `closes <task-id>` reference
 * as a lower-cased Set. Pure helper — exported for tests.
 *
 * @param {string} gitLogText
 * @returns {Set<string>}
 */
export function parseClosesIdsFromGitLog(gitLogText) {
  /** @type {Set<string>} */
  const ids = new Set();
  const re = /closes\s+([a-z][a-z0-9-]*[a-z0-9])\b/gi;
  for (const m of gitLogText.matchAll(re)) {
    const id = m[1];
    if (id !== undefined) ids.add(id.toLowerCase());
  }
  return ids;
}

/**
 * Read every `closes <task-id>` reference from the repo's git log. Uses
 * `--grep='closes '` to filter at the git layer (10–100× smaller output than
 * an unfiltered `--format=%B` capture), avoiding the
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` ceiling on large repos.
 *
 * The default `runner` is `execFileSync`; tests may inject a stub. The
 * try/catch fallback is preserved — git failures still yield an empty Set.
 *
 * @param {string} rootDir
 * @param {(file: string, args: string[], opts: { cwd: string, encoding: "utf-8", maxBuffer: number }) => string} [runner]
 * @returns {Set<string>}
 */
export function readGitClosedTaskIds(rootDir, runner = execFileSync) {
  try {
    const out = runner("git", ["log", "--all", "--grep=closes ", "--format=%s%n%b"], {
      cwd: rootDir,
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return parseClosesIdsFromGitLog(out);
  } catch {
    // Git not available or grep filter failed — fine; the linter still works
    // against TASKS.md alone.
    return new Set();
  }
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
