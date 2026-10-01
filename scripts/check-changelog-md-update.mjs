#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-changelog-md-update-required-on-code-changes (PR #911) -->
//
// check-changelog-md-update — diff-relative lint: any branch that
// touches code (novel/, scripts/, bin/, distribution/) MUST either
// (a) update CHANGELOG.md directly, OR
// (b) carry at least one conventional-commits commit subject (`feat:`,
//     `fix:`, `perf:`, or a `BREAKING CHANGE:` footer) — semantic-release
//     auto-generates CHANGELOG.md from those.
//
// AGENTS.md + .releaserc.json say CHANGELOG.md is auto-managed by
// semantic-release (per [Keep a Changelog v1.1.0]); the conventional-
// commits subject IS the changelog source. The lint accepts either
// path so manual edits and the auto-generated path both work.
//
// Anchors: repo discipline (.releaserc.json + Keep a Changelog v1.1.0);
// Conventional Commits 1.0.0; vision rule #10.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** @type {string} */
export const DEFAULT_DIFF_BASE = process.env["CHANGELOG_DIFF_BASE"] ?? "origin/main";

/**
 * File-path patterns that count as "code change".
 *
 * @type {readonly RegExp[]}
 */
export const CODE_PATH_PATTERNS = Object.freeze([
  /^novel\/.*\.(ts|tsx|mts|cts|js|mjs|cjs)$/,
  /^scripts\/.*\.(mjs|js|ts|sh|py)$/,
  /^bin\/.*$/,
  /^distribution\/.*\.(sh|service|timer|plist)$/,
  /^.github\/workflows\/.*\.yml$/,
]);

/**
 * Paths that EXCLUDE from the code-change set (test fixtures, dist
 * artifacts, the lint itself).
 *
 * @type {readonly RegExp[]}
 */
export const CODE_PATH_EXCLUDES = Object.freeze([
  /\.test\.(ts|mjs|js)$/,
  /\.spec\.(ts|mjs|js)$/,
  /\.test\.fixture\./,
  /^.*\/dist\/.*/,
  /^.*\/node_modules\/.*/,
  /^test\/fixtures\/.*/,
]);

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {string[]} codeFilesInDiff
 */

/**
 * Conventional-commits subject regex. Matches `<type>(<scope>)?: <subject>`
 * where <type> is one of the release-triggering types. Source:
 * https://www.conventionalcommits.org/en/v1.0.0/#summary
 *
 * @type {RegExp}
 */
export const CONVENTIONAL_COMMIT_SUBJECT_RE =
  /^(?:feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert)(?:\([^)]+\))?!?:\s+\S/;

/**
 * BREAKING CHANGE footer regex (Conventional Commits §"Breaking changes").
 *
 * @type {RegExp}
 */
export const BREAKING_CHANGE_RE = /^BREAKING CHANGE:\s+\S/m;

/**
 * @typedef {object} CheckOpts
 * @property {string} [repoRoot]
 * @property {string} [diffBase]
 * @property {string[]} [changedFiles]
 * @property {string} [prBody]
 * @property {string[]} [commitMessages]
 */

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkChangelogMdUpdate(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const diffBase = opts.diffBase ?? DEFAULT_DIFF_BASE;
  const changedFiles = opts.changedFiles ?? defaultChangedFiles(repoRoot, diffBase);
  const prBody = opts.prBody ?? readMaybePrBody(repoRoot);
  const commitMessages = opts.commitMessages ?? defaultCommitMessages(repoRoot, diffBase);

  if (/<!--\s*no-changelog:\s*\S.{2,}\s*-->/.test(prBody)) {
    return { ok: true, violations: [], codeFilesInDiff: [] };
  }

  const codeFiles = changedFiles.filter((p) => isCodeChange(p));
  if (codeFiles.length === 0) {
    return { ok: true, violations: [], codeFilesInDiff: [] };
  }
  if (changedFiles.includes("CHANGELOG.md")) {
    return { ok: true, violations: [], codeFilesInDiff: codeFiles };
  }
  if (hasConventionalCommit(commitMessages)) {
    // semantic-release will auto-generate the CHANGELOG entry — pass.
    return { ok: true, violations: [], codeFilesInDiff: codeFiles };
  }

  return {
    ok: false,
    violations: [
      `${codeFiles.length} code file(s) changed but neither (a) CHANGELOG.md was updated NOR (b) any commit subject uses Conventional Commits format (feat: / fix: / perf: / etc.). semantic-release auto-generates CHANGELOG.md from conventional-commits subjects; pick one or update CHANGELOG.md manually.`,
      ...codeFiles.map((p) => `  - ${p}`),
    ],
    codeFilesInDiff: codeFiles,
  };
}

/**
 * @param {string[]} commitMessages
 * @returns {boolean}
 */
function hasConventionalCommit(commitMessages) {
  for (const msg of commitMessages) {
    const firstLine = msg.split("\n", 1)[0] ?? "";
    if (CONVENTIONAL_COMMIT_SUBJECT_RE.test(firstLine)) return true;
    if (BREAKING_CHANGE_RE.test(msg)) return true;
  }
  return false;
}

/**
 * @param {string} repoRoot
 * @param {string} diffBase
 * @returns {string[]}
 */
function defaultCommitMessages(repoRoot, diffBase) {
  try {
    const out = execSync(`git log ${diffBase}...HEAD --pretty=%B%x1f`, {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return out
      .split("\x1f")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function isCodeChange(relPath) {
  if (CODE_PATH_EXCLUDES.some((re) => re.test(relPath))) return false;
  return CODE_PATH_PATTERNS.some((re) => re.test(relPath));
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
 * Look for `<!-- no-changelog: <reason> -->` in (a) `pr-body.md` if
 * present, (b) the most recent commit messages between base and HEAD.
 *
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
  const result = checkChangelogMdUpdate();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-changelog-md-update: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}
