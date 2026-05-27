#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-filename-casing-cardinal-md-files (PR #911) -->
//
// check-filename-casing — enforces AGENTS.md §"Filename casing" rules.
//
// Cardinal docs (vision.md, AGENTS.md, etc.) have specific casing per
// AGENTS.md. Other top-level `*.md` must be lowercase-kebab.
//
// Anchors: AGENTS.md §"Filename casing"; vision rule #10.

import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Cardinal files with exact-casing requirement. Format: `{lowercase: expected}`.
 * The MATCH key is the lowercased filename (so we catch case variants
 * regardless of which way they drift).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CARDINAL_CASING = Object.freeze({
  "vision.md": "vision.md",
  "agents.md": "AGENTS.md",
  "tasks.md": "TASKS.md",
  "architecture.md": "ARCHITECTURE.md",
  license: "LICENSE",
  "readme.md": "README.md",
  "milestones.md": "MILESTONES.md",
  "changelog.md": "CHANGELOG.md",
  "contributing.md": "CONTRIBUTING.md",
  "metrics.md": "METRICS.md",
  "deprecated.md": "DEPRECATED.md",
  "install.md": "INSTALL.md",
  "research.md": "research.md",
});

/**
 * Directories to scan. Only the repo root and `docs/`.
 *
 * @type {readonly string[]}
 */
export const SCAN_DIRS = Object.freeze(["", "docs"]);

/**
 * Files to skip even if they exist at scan-target paths.
 *
 * @type {readonly string[]}
 */
export const SKIP_FILES = Object.freeze([".DS_Store"]);

/**
 * Kebab-case regex for the catch-all rule on non-cardinal `*.md` files.
 *
 * @type {RegExp}
 */
export const KEBAB_CASE_MD = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [repoRoot]
 * @property {(dir: string) => string[]} [readDir]
 */

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkFilenameCasing(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const readDir = opts.readDir ?? ((p) => readdirSync(p));
  /** @type {string[]} */
  const violations = [];

  for (const dir of SCAN_DIRS) {
    scanOneDir(dir, repoRoot, readDir, violations);
  }

  return { ok: violations.length === 0, violations };
}

/**
 * @param {string} dir
 * @param {string} repoRoot
 * @param {(p: string) => string[]} readDir
 * @param {string[]} violations
 */
function scanOneDir(dir, repoRoot, readDir, violations) {
  const path = dir ? `${repoRoot}/${dir}` : repoRoot;
  let entries;
  try {
    entries = readDir(path);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_FILES.includes(name)) continue;
    checkOneFile(name, dir, violations);
  }
}

/**
 * @param {string} name
 * @param {string} dir
 * @param {string[]} violations
 */
function checkOneFile(name, dir, violations) {
  const lower = name.toLowerCase();
  const relPath = dir ? `${dir}/${name}` : name;

  // Cardinal rule first.
  if (Object.hasOwn(CARDINAL_CASING, lower)) {
    const expected = CARDINAL_CASING[lower];
    if (name !== expected) {
      violations.push(
        `${relPath}: cardinal file has wrong casing; expected "${expected}" (AGENTS.md §"Filename casing")`,
      );
    }
    return;
  }

  // Catch-all for root-level `*.md`: must be kebab-case-lowercase.
  if (dir === "" && name.endsWith(".md") && !KEBAB_CASE_MD.test(name)) {
    violations.push(
      `${relPath}: root-level *.md must be kebab-case-lowercase (AGENTS.md §"Filename casing")`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkFilenameCasing();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-filename-casing: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}
