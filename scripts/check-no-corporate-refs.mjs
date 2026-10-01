#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved port of the agentbrew/dotfiles no-internal-refs guard; operator directive 2026-05-29 to add the same stable check to minsky -->
// Deterministic "no internal references" content guard.
//
// minsky is a public repo. This guard pins the invariant that the tree
// contains ZERO private identifiers (company names, internal product /
// codebase names, internal endpoints, ticket keys). The pattern is NEVER
// stored in this repo. It loads at runtime from:
//   1. `OSS_READINESS_INTERNAL_PATTERN` (env var), else
//   2. the first existing env file among `OSS_READINESS_ENV_FILE` and
//      `${XDG_CONFIG_HOME:-~/.config}/oss-readiness/oss-readiness.env`
//      (line `OSS_READINESS_INTERNAL_PATTERN='...'`, quotes optional).
//      A file whose `OSS_READINESS_REPO=` names another repo is skipped.
// With no pattern configured the check prints a notice and exits 0. It is a
// local/operator gate. CI on the public repo has no pattern.
//
// Shape: one case-insensitive regex pass over every tracked text file (via
// `git ls-files`, so `.gitignore` is respected), plus a ratcheting
// allowlist (PERMANENT for files that must carry the tokens forever, TEMPORARY
// for migration backlog). A dead-entry check prevents allowlist rot.
//
// Deterministic, no LLM, no network (rule #10). Paired test:
// `check-no-corporate-refs.test.mjs`. Run standalone:
//   node scripts/check-no-corporate-refs.mjs
//
// Source: agentbrew/src/oss/no-internal-refs.test.ts (reference guard);
// scripts/check-no-personal-paths-in-docs.mjs (local convention).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const REPO_NAME = "minsky";

/**
 * Read one `KEY=value` line from env-file text. Quotes are optional.
 *
 * @param {string} text
 * @param {string} key
 * @returns {string | undefined}
 */
function readEnvFileValue(text, key) {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith(`${key}=`)) continue;
    let value = line.slice(key.length + 1).trim();
    const quote = value[0];
    if ((quote === "'" || quote === '"') && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

/**
 * Read the pattern from one env file. Returns undefined when the file is
 * missing, null when it names another repo or has no pattern.
 *
 * @param {string} file
 * @returns {string | null | undefined}
 */
function patternFromEnvFile(file) {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf-8");
  const repo = readEnvFileValue(text, "OSS_READINESS_REPO");
  if (repo && repo !== REPO_NAME) return null;
  return readEnvFileValue(text, "OSS_READINESS_INTERNAL_PATTERN") || null;
}

/**
 * Load the private pattern at runtime. Returns null when none is configured.
 * The pattern never lives in this repo.
 *
 * @param {{ env?: Record<string, string | undefined>, home?: string }} [opts]
 * @returns {RegExp | null}
 */
export function loadInternalPattern(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const direct = env["OSS_READINESS_INTERNAL_PATTERN"];
  if (direct) return new RegExp(direct, "i");
  const xdg = env["XDG_CONFIG_HOME"] || join(home, ".config");
  const candidates = [
    env["OSS_READINESS_ENV_FILE"],
    join(xdg, "oss-readiness", "oss-readiness.env"),
  ].filter((f) => Boolean(f));
  for (const file of candidates) {
    const value = patternFromEnvFile(/** @type {string} */ (file));
    if (value) return new RegExp(value, "i");
    // First existing file wins, even when it yields no pattern.
    if (value !== undefined) return null;
  }
  return null;
}

// Permanent allowlist — files that may carry private tokens forever. Empty:
// the pattern is loaded at runtime, so the guard's own files carry no tokens.
export const PERMANENT_ALLOWLIST = /** @type {Set<string>} */ (new Set());

// Temporary allowlist — migration backlog. Each entry must be cleared by
// removing the tokens (or moving them to a private overlay) and tracked in
// TASKS.md. Empty on a scrubbed tree.
export const TEMPORARY_ALLOWLIST = /** @type {Set<string>} */ (new Set());

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
 * Scan one tracked file for pattern hits.
 *
 * @param {string} rel
 * @param {RegExp} pattern
 * @returns {{ path: string, line: number, match: string, content: string }[]}
 */
function scanFile(rel, pattern) {
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
    const match = pattern.exec(line);
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
 * Scan the tree and return every line that matches the pattern.
 *
 * @param {RegExp} pattern
 * @returns {{ path: string, line: number, match: string, content: string }[]}
 */
export function findOffenders(pattern) {
  /** @type {{ path: string, line: number, match: string, content: string }[]} */
  const offenders = [];
  for (const rel of listScanFiles()) {
    offenders.push(...scanFile(rel, pattern));
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
      dead.push(`${f} (no private references — remove from allowlist)`);
    }
  }
  return dead;
}

const isCli =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isCli) {
  const pattern = loadInternalPattern();
  if (pattern === null) {
    process.stdout.write(
      "no-corporate-refs: skipped, no OSS_READINESS_INTERNAL_PATTERN configured (local/operator gate).\n",
    );
    process.exit(0);
  }
  const offenders = findOffenders(pattern);
  const allowed = new Set([...PERMANENT_ALLOWLIST, ...TEMPORARY_ALLOWLIST]);
  const unexpected = offenders.filter((o) => !allowed.has(o.path));
  const offendingPaths = new Set(offenders.map((o) => o.path));
  const dead = [
    ...deadAllowlistEntries(PERMANENT_ALLOWLIST, offendingPaths),
    ...deadAllowlistEntries(TEMPORARY_ALLOWLIST, offendingPaths),
  ];

  if (unexpected.length > 0) {
    process.stderr.write(
      `no-corporate-refs: ${unexpected.length} file(s) contain private identifiers but are NOT allowlisted:\n`,
    );
    for (const o of unexpected) {
      process.stderr.write(`  ${o.path}:${o.line}  [${o.match}]\n    ${o.content}\n`);
    }
    process.stderr.write(
      "\nFix: remove the private reference, or (if intentional) add the path to TEMPORARY_ALLOWLIST with a TASKS.md migration task.\n",
    );
    process.exit(1);
  }

  if (dead.length > 0) {
    process.stderr.write("no-corporate-refs: dead allowlist entries (remove them):\n");
    for (const d of dead) process.stderr.write(`  ${d}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `no-corporate-refs ok: scanned ${listScanFiles().length} file(s), 0 private identifiers outside allowlist.\n`,
  );
  process.exit(0);
}
