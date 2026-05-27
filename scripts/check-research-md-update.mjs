#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-research-md-update-on-dep-change (PR #911) -->
//
// check-research-md-update — diff-relative lint: any branch that
// adds/removes a dependency (package.json change to dependencies
// section) MUST also update research.md with a rationale.
//
// vision.md §"What Minsky is not" says deps are evaluated against
// research.md (the building-block evaluation log). Enforces that
// mechanically per vision rule #10.
//
// How it works:
//  1. Detect package.json changes in the branch's diff.
//  2. For each, parse the BASE and HEAD versions and diff the
//     `dependencies` + `devDependencies` keys.
//  3. If any key was added/removed AND research.md is NOT in the
//     diff → fail.
//  4. Opt-out: `<!-- no-research-update: <reason ≥3 chars> -->` in
//     PR body or commit message.
//
// Anchors: vision.md §"What Minsky is not" (research log); vision
// rule #10.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** @type {string} */
export const DEFAULT_DIFF_BASE = process.env["RESEARCH_DIFF_BASE"] ?? "origin/main";

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {string[]} depsChanged
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [repoRoot]
 * @property {string} [diffBase]
 * @property {string[]} [changedFiles]
 * @property {(file: string) => string} [readCurrent]
 * @property {(file: string, ref: string) => string} [readAtRef]
 * @property {string} [prBody]
 */

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkResearchMdUpdate(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const diffBase = opts.diffBase ?? DEFAULT_DIFF_BASE;
  const changedFiles = opts.changedFiles ?? defaultChangedFiles(repoRoot, diffBase);
  const readCurrent = opts.readCurrent ?? defaultReadCurrent(repoRoot);
  const readAtRef = opts.readAtRef ?? defaultReadAtRef(repoRoot);
  const prBody = opts.prBody ?? readMaybePrBody(repoRoot);

  if (hasOptOut(prBody)) return passResult([]);

  const pkgFiles = changedFiles.filter((p) => p === "package.json" || p.endsWith("/package.json"));
  if (pkgFiles.length === 0) return passResult([]);

  const depsChanged = collectDepChanges(pkgFiles, readAtRef, readCurrent, diffBase);
  if (depsChanged.length === 0) return passResult([]);
  if (changedFiles.includes("research.md")) return passResult(depsChanged);

  return failResult(depsChanged);
}

/**
 * @param {string} prBody
 * @returns {boolean}
 */
function hasOptOut(prBody) {
  return /<!--\s*no-research-update:\s*\S.{2,}\s*-->/.test(prBody);
}

/**
 * @param {string[]} pkgFiles
 * @param {(file: string, ref: string) => string} readAtRef
 * @param {(file: string) => string} readCurrent
 * @param {string} diffBase
 * @returns {string[]}
 */
function collectDepChanges(pkgFiles, readAtRef, readCurrent, diffBase) {
  /** @type {string[]} */
  const out = [];
  for (const pkgPath of pkgFiles) {
    const added = diffDependencyKeys(readAtRef(pkgPath, diffBase), readCurrent(pkgPath));
    out.push(...added.map((k) => `${pkgPath}: ${k}`));
  }
  return out;
}

/**
 * @param {string[]} depsChanged
 * @returns {CheckResult}
 */
function passResult(depsChanged) {
  return { ok: true, violations: [], depsChanged };
}

/**
 * @param {string[]} depsChanged
 * @returns {CheckResult}
 */
function failResult(depsChanged) {
  return {
    ok: false,
    violations: [
      `${depsChanged.length} dependency change(s) but research.md was not updated:`,
      ...depsChanged.map((d) => `  - ${d}`),
      "",
      "Add a research.md entry explaining the build/buy/borrow decision OR add `<!-- no-research-update: <reason ≥3 chars> -->` to the PR body (e.g. version bump for security patch, no design decision).",
    ],
    depsChanged,
  };
}

/**
 * Parse the dependencies + devDependencies + peerDependencies sections
 * of base vs head package.json and return added/removed/changed keys.
 *
 * @param {string} baseText
 * @param {string} headText
 * @returns {string[]}  list of changed keys (added/removed; version-only
 *                     changes excluded)
 */
function diffDependencyKeys(baseText, headText) {
  const baseDeps = parseDeps(baseText);
  const headDeps = parseDeps(headText);
  /** @type {string[]} */
  const out = [];
  for (const key of Object.keys(headDeps)) {
    if (!(key in baseDeps)) out.push(`+${key}`);
  }
  for (const key of Object.keys(baseDeps)) {
    if (!(key in headDeps)) out.push(`-${key}`);
  }
  return out;
}

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseDeps(text) {
  if (text.length === 0) return {};
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof obj !== "object" || obj === null) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
    collectSection(obj[section], out);
  }
  return out;
}

/**
 * @param {unknown} section
 * @param {Record<string, string>} out
 */
function collectSection(section, out) {
  if (typeof section !== "object" || section === null) return;
  for (const [k, v] of Object.entries(section)) {
    if (typeof v === "string") out[k] = v;
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
      return "";
    }
  };
}

/**
 * @param {string} repoRoot
 * @returns {string}
 */
function readMaybePrBody(repoRoot) {
  const parts = [];
  const prBodyPath = `${repoRoot}/pr-body.md`;
  if (existsSync(prBodyPath)) {
    try {
      parts.push(readFileSync(prBodyPath, "utf8"));
    } catch {
      /* swallow — read failure means no PR body */
    }
  }
  try {
    const log = execSync(`git log ${DEFAULT_DIFF_BASE}...HEAD --pretty=%B`, {
      cwd: repoRoot,
      encoding: "utf8",
    });
    parts.push(log);
  } catch {
    /* swallow — read failure means no PR body */
  }
  return parts.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkResearchMdUpdate();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-research-md-update: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}
