#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-deprecated-md-respect-no-new-references-to-deprecated-features (PR #911) -->
//
// check-deprecated-md-respect — diff-relative lint that fails when the
// branch's NEW references to a docs/DEPRECATED.md-listed surface would
// expand its footprint.
//
// AGENTS.md says "Before implementing any feature, check DEPRECATED.md".
// This lint enforces that — if you add code that uses a deprecated env
// var / script / module / function, fail. Existing references are
// grandfathered (the parent task already says "Keep for now").
//
// How it works:
//  1. Parse docs/DEPRECATED.md to extract every deprecated identifier
//     (env var names, file paths, package names) from H3 headings.
//  2. For each, count occurrences in `git show origin/main:<file>` for
//     every file in the diff. That's the BASELINE.
//  3. Count occurrences in the working tree's version of each file.
//     That's CURRENT.
//  4. If CURRENT > BASELINE for any (file, identifier), report.
//
// Pure file-IO + git plumbing; no AST parsing.
//
// Anchors: AGENTS.md §"What this file is not" → DEPRECATED.md;
// vision rule #10.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Diff base ref. Resolves to the merge-base with the env-overridable
 * default of `origin/main`.
 *
 * @type {string}
 */
export const DEFAULT_DIFF_BASE = process.env["DEPRECATED_DIFF_BASE"] ?? "origin/main";

/**
 * Allowlist regex for diff files that are EXEMPT from the lint —
 * docs that discuss the deprecation, CHANGELOG, the lint itself.
 *
 * @type {readonly RegExp[]}
 */
export const ALLOWLIST = Object.freeze([
  /^docs\/DEPRECATED\.md$/,
  /^CHANGELOG\.md$/,
  /^AGENTS\.md$/,
  /^vision\.md$/,
  /^TASKS\.md$/, // task descriptions discuss deprecation
  /^research\.md$/,
  /^docs\/.*\.md$/, // any doc may discuss
  /^scripts\/check-deprecated-md-respect\.mjs$/,
  /^scripts\/check-deprecated-md-respect\.test\.mjs$/,
  // Tests that exist precisely to ASSERT the deprecated substrate
  // is not used — they BAN the string, which the lint would otherwise
  // count as a use. Per AGENTS.md §"Self-referential lints": a lint
  // pinning the deprecated path's absence may name the path.
  /^test\/integration\/pnpm-minsky-aliases\.test\.ts$/,
  /^scripts\/check-pnpm-minsky-aliases\.mjs$/,
  /^scripts\/check-pnpm-minsky-aliases\.test\.mjs$/,
  // Same self-referential carve-out: this regression test pins a
  // specific bug-fix WITHIN setup.sh (the foreign-orphan-plist
  // bootstrap failure surfaced 2026-05-28) — it MUST reference
  // setup.sh by name to assert the heal landed in that file.
  // Removing this allowlist row when setup.sh is ultimately retired
  // (per docs/DEPRECATED.md § 5 — "Keep until `minsky init` ships")
  // is the ratchet.
  /^test\/integration\/setup-rendered-only-bootstrap\.test\.ts$/,
  // Same self-referential carve-out: this regression test pins the
  // 2026-05-29 IRON gate (supervisor bootstrap requires explicit
  // --with-supervisor flag). It MUST name setup.sh and the flag to
  // assert the gate landed in that file. Source: operator directive
  // "It must only run when I explicitly tell it so. Fix immediately"
  // (machine reload silently brought 7 com.minsky.* plists back
  // online). Removed when setup.sh retires per DEPRECATED.md § 5.
  /^test\/integration\/setup-supervisor-opt-in\.test\.ts$/,
  // setup.sh itself: bug-fix extensions to a "Keep until X" deprecated
  // surface are allowed during the keep-window, per the precedent set
  // by the setup-rendered-only-bootstrap.test.ts carve-out. setup.sh
  // is the canonical location for supervisor bootstrap until
  // `minsky init` ships (DEPRECATED.md § 5) — the operator's
  // explicit-start contract MUST be enforced here, in the file the
  // operator actually invokes. Without this allowlist row, the IRON
  // gate landed in this PR would have been impossible to express
  // without contorting the user-facing dim "Re-run: ./setup.sh ..."
  // messages into something the operator can't copy-paste. Remove
  // when setup.sh retires.
  /^setup\.sh$/,
]);

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {string[]} identifiers
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [repoRoot]
 * @property {string} [diffBase]
 * @property {string} [deprecatedMdContent]
 * @property {string[]} [changedFiles]
 * @property {(file: string) => string} [readCurrent]
 * @property {(file: string, ref: string) => string} [readAtRef]
 */

/**
 * Extract deprecated identifiers from docs/DEPRECATED.md.
 * Looks for inline code spans `\``...\``\`` inside H3 headings.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function parseDeprecatedIdentifiers(content) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const line of content.split("\n")) {
    if (!/^###\s/.test(line)) continue;
    addHeadingIdentifiers(line, ids);
  }
  return Array.from(ids);
}

/**
 * Extract every backtick-span from a heading and add valid identifiers.
 *
 * @param {string} line
 * @param {Set<string>} ids
 */
function addHeadingIdentifiers(line, ids) {
  const matches = line.match(/`([^`]+)`/g);
  if (!matches) return;
  for (const m of matches) {
    const inner = m.slice(1, -1).trim();
    if (inner.length > 0 && inner.length < 100) {
      ids.add(inner);
    }
  }
}

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkDeprecatedMdRespect(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const diffBase = opts.diffBase ?? DEFAULT_DIFF_BASE;
  const deprecatedMdContent =
    opts.deprecatedMdContent ?? readMaybe(`${repoRoot}/docs/DEPRECATED.md`);
  const identifiers = parseDeprecatedIdentifiers(deprecatedMdContent);
  const changedFiles = opts.changedFiles ?? defaultChangedFiles(repoRoot, diffBase);
  const readCurrent = opts.readCurrent ?? defaultReadCurrent(repoRoot);
  const readAtRef = opts.readAtRef ?? defaultReadAtRef(repoRoot);

  /** @type {string[]} */
  const violations = [];

  for (const relPath of changedFiles) {
    if (ALLOWLIST.some((re) => re.test(relPath))) continue;
    scanOneFile(
      relPath,
      readCurrent(relPath),
      readAtRef(relPath, diffBase),
      identifiers,
      violations,
    );
  }

  return { ok: violations.length === 0, violations, identifiers };
}

/**
 * Scan a single file's current + baseline contents for net-new
 * references to each deprecated identifier.
 *
 * @param {string} relPath
 * @param {string} current
 * @param {string} baseline
 * @param {readonly string[]} identifiers
 * @param {string[]} violations
 */
function scanOneFile(relPath, current, baseline, identifiers, violations) {
  for (const id of identifiers) {
    const curCount = countOccurrences(current, id);
    const baseCount = countOccurrences(baseline, id);
    if (curCount > baseCount) {
      violations.push(
        `${relPath}: NEW reference(s) to deprecated identifier "${id}" (current ${curCount} > baseline ${baseCount}). See docs/DEPRECATED.md for the replacement.`,
      );
    }
  }
}

/**
 * @param {string} haystack
 * @param {string} needle
 * @returns {number}
 */
function countOccurrences(haystack, needle) {
  if (haystack.length === 0 || needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    idx = haystack.indexOf(needle, idx);
    if (idx === -1) break;
    count++;
    idx += needle.length;
  }
  return count;
}

/**
 * @param {string} path
 * @returns {string}
 */
function readMaybe(path) {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

/**
 * @param {string} repoRoot
 * @param {string} diffBase
 * @returns {string[]}
 */
function defaultChangedFiles(repoRoot, diffBase) {
  try {
    const out = execSync(`git diff --name-only ${diffBase}...HEAD`, {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return out.split("\n").filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * @param {string} repoRoot
 * @returns {(file: string) => string}
 */
function defaultReadCurrent(repoRoot) {
  return (file) => {
    try {
      return readFileSync(`${repoRoot}/${file}`, "utf8");
    } catch {
      return "";
    }
  };
}

/**
 * @param {string} repoRoot
 * @returns {(file: string, ref: string) => string}
 */
function defaultReadAtRef(repoRoot) {
  return (file, ref) => {
    try {
      return execSync(`git show ${ref}:${file}`, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      // file didn't exist at ref — counts as 0
      return "";
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkDeprecatedMdRespect();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-deprecated-md-respect: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  console.error("");
  console.error(
    "Fix: see docs/DEPRECATED.md for the replacement for the named identifier. If you GENUINELY need to extend the deprecated path (e.g. shim work), document the reason in a comment + remove the lint entry.",
  );
  process.exit(1);
}
