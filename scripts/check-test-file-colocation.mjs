#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-test-file-colocation-novel-pkg-src (PR #911) -->
//
// check-test-file-colocation — every `novel/*/src/**/*.ts` file must
// have a sibling `<basename>.test.ts` file. Per AGENTS.md §"Test
// conventions": "tests live next to the source".
//
// Allowlist via top-of-file comment: `// no-test: <reason ≥3 chars>`.
// File-pattern allowlist for pure type re-exports (index.ts, types.ts,
// *.d.ts, *.test.ts itself, *.fixtures.ts).
//
// Anchors: AGENTS.md §"Test conventions"; vision rule #3 (test-first);
// det-test-file-colocation.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * File-name patterns that are EXEMPT from the colocation rule:
 *  - Pure type re-export files (no behavior to test)
 *  - The test files themselves
 *  - Fixture files
 *
 * @type {readonly RegExp[]}
 */
export const ALLOWLIST_PATTERNS = Object.freeze([
  /^index\.ts$/,
  /^types\.ts$/,
  /\.d\.ts$/,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\.fixture\.ts$/,
  /\.fixtures\.ts$/,
]);

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {number} scannedCount
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [repoRoot]
 * @property {string[]} [files]
 * @property {(p: string) => boolean} [fileExists]
 * @property {(p: string) => string} [readText]
 */

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkTestFileColocation(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const fileExists = opts.fileExists ?? ((p) => existsSync(p));
  const readText = opts.readText ?? ((p) => readFileSync(p, "utf8"));
  const files = opts.files ?? defaultFileList(repoRoot);
  /** @type {string[]} */
  const violations = [];

  for (const relPath of files) {
    const v = checkOneSource(relPath, repoRoot, fileExists, readText);
    if (v !== null) violations.push(v);
  }

  return { ok: violations.length === 0, violations, scannedCount: files.length };
}

/**
 * Check one source file. Returns a violation message OR null on pass.
 *
 * @param {string} relPath
 * @param {string} repoRoot
 * @param {(p: string) => boolean} fileExists
 * @param {(p: string) => string} readText
 * @returns {string | null}
 */
function checkOneSource(relPath, repoRoot, fileExists, readText) {
  if (isAllowlistedByName(relPath)) return null;
  if (hasNoTestComment(repoRoot, relPath, readText)) return null;
  const sibling = siblingTestPath(relPath);
  if (fileExists(`${repoRoot}/${sibling}`)) return null;
  return `${relPath}: missing sibling test file (expected ${sibling}). Add a test OR a top-of-file comment \`// no-test: <reason ≥3 chars>\`.`;
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function isAllowlistedByName(relPath) {
  const basename = relPath.split("/").pop() ?? "";
  return ALLOWLIST_PATTERNS.some((re) => re.test(basename));
}

/**
 * Allow opt-out via `// no-test:` comment in the first 10 lines.
 *
 * @param {string} repoRoot
 * @param {string} relPath
 * @param {(p: string) => string} readText
 * @returns {boolean}
 */
function hasNoTestComment(repoRoot, relPath, readText) {
  try {
    const text = readText(`${repoRoot}/${relPath}`);
    const head = text.split("\n").slice(0, 10);
    // Per-line match: `// no-test: <reason ≥3 chars>` MUST be on a single
    // line — \s* in a multi-line head would otherwise eat the newline
    // and grab the next line's content as the "reason".
    return head.some((line) => /\/\/\s*no-test:[ \t]*\S.{2,}/.test(line));
  } catch {
    return false;
  }
}

/**
 * @param {string} relPath
 * @returns {string}
 */
function siblingTestPath(relPath) {
  return relPath.replace(/\.ts$/, ".test.ts");
}

/**
 * @param {string} repoRoot
 * @returns {string[]}
 */
function defaultFileList(repoRoot) {
  try {
    const out = execSync(
      '/usr/bin/find novel -type d \\( -name dist -o -name node_modules \\) -prune -o -type f -name "*.ts" -path "*/src/*" -print 2>/dev/null',
      { cwd: repoRoot, encoding: "utf8" },
    );
    return out.split("\n").filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkTestFileColocation();
  if (result.ok) {
    process.exit(0);
  }
  console.error(`check-test-file-colocation: ${result.violations.length} violation(s):`);
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  console.error("");
  console.error(
    "Fix: add `<basename>.test.ts` next to each source file, OR add `// no-test: <reason ≥3 chars>` to the first 10 lines.",
  );
  process.exit(1);
}
