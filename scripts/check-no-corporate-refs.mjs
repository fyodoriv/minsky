#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved port of the agentbrew/dotfiles no-corporate-refs guard; operator directive 2026-05-29 to add the same stable check to minsky -->
// Deterministic "no corporate references" content guard.
//
// minsky is a public repo. This guard pins the invariant that the tree
// contains ZERO corporate identifiers (company names, internal product /
// codebase names, internal endpoints, Jira project keys, GHE org prefix)
// outside an explicit allowlist. It mirrors agentbrew's no-intuit-refs guard
// and dotfiles' oss-readiness gate so all three repos in the family share one
// taxonomy (the regex below is kept identical to those, plus minsky-specific
// alternates).
//
// Shape: a single case-insensitive regex pass over every tracked text file
// (via `git ls-files`, so `.gitignore` is respected), plus a ratcheting
// allowlist (PERMANENT for files that must carry the tokens forever — e.g.
// this guard's own regex — and TEMPORARY for migration backlog). A
// dead-entry check prevents allowlist rot.
//
// Deterministic, no LLM, no network (rule #10). Enforced in CI by its paired
// test `check-no-corporate-refs.test.mjs` (the "live repo scan" case), which
// the `test` job runs on every PR. Also runnable standalone:
//   node scripts/check-no-corporate-refs.mjs
//
// Source: agentbrew/src/oss/no-intuit-refs.test.ts (reference taxonomy);
// scripts/check-no-personal-paths-in-docs.mjs (local convention).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// Case-insensitive pattern matching every corporate identifier the public
// repo must not contain (outside the allowlists). Kept identical to the
// agentbrew/dotfiles taxonomy for cross-repo consistency, with two
// minsky-specific alternates (an internal service name and its Jira host).
//
//   company / domain   : intuit, workday
//   internal products  : appfabric, devportal, asterias, splunkit, ipsr,
//                        kiam, devassist, eiam, genos, oncall-hub
//   internal codebases : iep-, ids-ts, @iep/, @ids-ts/, cws_
//   internal endpoints : federation.intuit, github.intuit, jira.cloud.intuit
//   generated tags     : actions-intuit, slack-intuit, intuit-google-drive
//   Jira projects      : AIFN-
//   GHE org prefix     : expertnetwrk
export const CORPORATE_PATTERN =
  /\b(intuit|workday|appfabric|devportal|asterias|splunkit|ipsr|kiam|devassist|eiam|genos|iep-|ids-ts|@iep\/|@ids-ts\/|cws_|expertnetwrk|federation\.intuit|github\.intuit|jira\.cloud\.intuit|actions-intuit|slack-intuit|intuit-google-drive|oncall-hub|AIFN-)\b/i;

// Permanent allowlist — files that may carry corporate tokens forever because
// they ARE the detector (the tokens appear in the regex / test fixtures).
// Keep this set tiny and justified.
export const PERMANENT_ALLOWLIST = new Set([
  "scripts/check-no-corporate-refs.mjs",
  "scripts/check-no-corporate-refs.test.mjs",
]);

// Temporary allowlist — migration backlog. Each entry must be cleared by
// removing the tokens (or moving them to a private overlay) and tracked in
// TASKS.md. Empty on a scrubbed tree.
export const TEMPORARY_ALLOWLIST = new Set([]);

const SCAN_EXTENSIONS = new Set([
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".sh",
  ".bash",
  ".toml",
  ".py",
  ".bats",
  ".example",
]);

/**
 * Enumerate scannable tracked files via `git ls-files` so the scan respects
 * `.gitignore` and matches what would be published.
 *
 * @returns {string[]}
 */
export function listScanFiles() {
  let out;
  try {
    out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    }).toString();
  } catch {
    return [];
  }
  return out
    .trim()
    .split("\n")
    .filter((rel) => {
      if (!rel) return false;
      const base = rel.slice(rel.lastIndexOf("/") + 1);
      const dot = base.lastIndexOf(".");
      const ext = dot >= 0 ? base.slice(dot) : "";
      return SCAN_EXTENSIONS.has(ext);
    })
    .sort();
}

/**
 * Scan one tracked file for corporate-pattern hits.
 *
 * @param {string} rel
 * @returns {{ path: string, line: number, match: string, content: string }[]}
 */
function scanFile(rel) {
  let content;
  try {
    content = readFileSync(join(REPO_ROOT, rel), "utf-8");
  } catch {
    return [];
  }
  /** @type {{ path: string, line: number, match: string, content: string }[]} */
  const hits = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = CORPORATE_PATTERN.exec(line);
    if (match !== null && match[0] !== undefined) {
      hits.push({
        path: rel,
        line: i + 1,
        match: match[0],
        content: line.length > 200 ? `${line.slice(0, 200)}…` : line,
      });
    }
  }
  return hits;
}

/**
 * Scan the tree and return every line that matches the corporate pattern.
 *
 * @returns {{ path: string, line: number, match: string, content: string }[]}
 */
export function findOffenders() {
  /** @type {{ path: string, line: number, match: string, content: string }[]} */
  const offenders = [];
  for (const rel of listScanFiles()) {
    offenders.push(...scanFile(rel));
  }
  return offenders;
}

/**
 * Allowlist entries that are missing on disk or no longer contain a token
 * (allowlist rot). Returns human-readable reasons.
 *
 * @param {Set<string>} allowlist
 * @param {Set<string>} offendingPaths
 * @returns {string[]}
 */
export function deadAllowlistEntries(allowlist, offendingPaths) {
  /** @type {string[]} */
  const dead = [];
  for (const f of allowlist) {
    if (!existsSync(join(REPO_ROOT, f))) {
      dead.push(`${f} (missing on disk)`);
    } else if (!offendingPaths.has(f)) {
      dead.push(`${f} (no corporate references — remove from allowlist)`);
    }
  }
  return dead;
}

const isCli =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isCli) {
  const offenders = findOffenders();
  const allowed = new Set([...PERMANENT_ALLOWLIST, ...TEMPORARY_ALLOWLIST]);
  const unexpected = offenders.filter((o) => !allowed.has(o.path));
  const offendingPaths = new Set(offenders.map((o) => o.path));
  const dead = [
    ...deadAllowlistEntries(PERMANENT_ALLOWLIST, offendingPaths),
    ...deadAllowlistEntries(TEMPORARY_ALLOWLIST, offendingPaths),
  ];

  if (unexpected.length > 0) {
    process.stderr.write(
      `no-corporate-refs: ${unexpected.length} file(s) contain corporate identifiers but are NOT allowlisted:\n`,
    );
    for (const o of unexpected) {
      process.stderr.write(`  ${o.path}:${o.line}  [${o.match}]\n    ${o.content}\n`);
    }
    process.stderr.write(
      "\nFix: remove the corporate reference, or (if intentional) add the path to TEMPORARY_ALLOWLIST with a TASKS.md migration task.\n",
    );
    process.exit(1);
  }

  if (dead.length > 0) {
    process.stderr.write("no-corporate-refs: dead allowlist entries (remove them):\n");
    for (const d of dead) process.stderr.write(`  ${d}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `no-corporate-refs ok: scanned ${listScanFiles().length} file(s), 0 corporate identifiers outside allowlist.\n`,
  );
  process.exit(0);
}
