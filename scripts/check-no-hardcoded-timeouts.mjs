#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-no-hardcoded-timeouts-novel-and-bin (PR #911) -->
//
// check-no-hardcoded-timeouts — bans hardcoded numeric timeouts in novel/
// and bin/. Per AGENTS.md §14b: timeouts must come from a TimeoutPolicy
// constant or env var with a documented default, not magic numbers.
//
// Heuristic: scan for `setTimeout(...,  <number>)` / `setInterval(...,
// <number>)` / `await sleep(<number>)` / `wait <number>` / `timeout=<n>`
// where the number is an integer literal ≥1000 (1s+).
//
// Anchors: AGENTS.md §14b; vision rule #10.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Scan globs — directories to walk for hardcoded timeouts.
 *
 * @type {readonly string[]}
 */
export const SCAN_GLOBS = Object.freeze(["novel/**/*.ts", "bin/**/*.sh"]);

/**
 * Allowlist: files that legitimately contain hardcoded timeouts (test
 * fixtures, the TimeoutPolicy module itself, etc.).
 *
 * @type {readonly RegExp[]}
 */
export const ALLOWLIST = Object.freeze([
  // Test files can contain timeouts (they're test setup, not production).
  /\.test\.ts$/,
  /\.spec\.ts$/,
  // Bench scripts can have legitimate sleep loops.
  /\/bench\/.*\.ts$/,
]);

/**
 * Patterns. Each is `(pattern, message-template)`.
 *
 * @type {readonly { re: RegExp, desc: string }[]}
 */
export const TIMEOUT_PATTERNS = Object.freeze([
  {
    re: /\bsetTimeout\s*\([\s\S]*?,\s*(\d{4,})\s*\)/,
    desc: "setTimeout with hardcoded ms (>=1000)",
  },
  {
    re: /\bsetInterval\s*\([\s\S]*?,\s*(\d{4,})\s*\)/,
    desc: "setInterval with hardcoded ms (>=1000)",
  },
  {
    re: /\bawait\s+(?:sleep|delay|wait)\s*\(\s*(\d{4,})\s*\)/,
    desc: "await sleep/delay/wait with hardcoded ms (>=1000)",
  },
  {
    re: /\b(?:sleep|sleepMs|delayMs|waitMs)\s*[:=]\s*(\d{4,})\b/,
    desc: "sleep/delay/wait identifier assigned hardcoded ms (>=1000)",
  },
  // Bash patterns
  {
    re: /\bsleep\s+(\d{2,})\b/,
    desc: "bash `sleep N` with hardcoded seconds (>=10)",
  },
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
 * @property {(p: string) => string} [readText]
 */

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkNoHardcodedTimeouts(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const readText = opts.readText ?? ((p) => readFileSync(p, "utf8"));
  const files = opts.files ?? defaultFileList(repoRoot);
  /** @type {string[]} */
  const violations = [];

  for (const relPath of files) {
    if (isAllowlisted(relPath)) continue;
    const full = `${repoRoot}/${relPath}`;
    let src;
    try {
      src = readText(full);
    } catch {
      continue;
    }
    scanFile(relPath, src, violations);
  }

  return { ok: violations.length === 0, violations, scannedCount: files.length };
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function isAllowlisted(relPath) {
  return ALLOWLIST.some((re) => re.test(relPath));
}

/**
 * @param {string} relPath
 * @param {string} src
 * @param {string[]} violations
 */
function scanFile(relPath, src, violations) {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i] ?? "";
    if (lineHasAllowlistComment(line)) continue;
    for (const { re, desc } of TIMEOUT_PATTERNS) {
      const m = re.exec(line);
      if (m !== null) {
        violations.push(
          `${relPath}:${lineNum}: ${desc} — value "${m[1]}". Use a TimeoutPolicy constant or env var (AGENTS.md §14b).`,
        );
      }
    }
  }
}

/**
 * Allowlist a single line via inline comment: `// timeout-ok: <reason ≥3 chars>`
 *
 * @param {string} line
 * @returns {boolean}
 */
function lineHasAllowlistComment(line) {
  return /\/\/\s*timeout-ok:\s*\S.{2,}|#\s*timeout-ok:\s*\S.{2,}/.test(line);
}

/**
 * Default file list — uses node's glob via execSync.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
function defaultFileList(repoRoot) {
  try {
    // Use absolute `/usr/bin/find` to avoid shell-alias collisions (some
    // dev environments alias `find` -> `fd`). GNU find on Linux + BSD find
    // on macOS both support `-name` / `-prune` identically.
    const out = execSync(
      '/usr/bin/find novel bin -type f \\( -path "*/dist/*" -o -path "*/node_modules/*" -o -path "*/.minsky/*" \\) -prune -o \\( -name "*.ts" -o -name "*.sh" \\) -print 2>/dev/null',
      { cwd: repoRoot, encoding: "utf8" },
    );
    return out.split("\n").filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkNoHardcodedTimeouts();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-no-hardcoded-timeouts: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  console.error("");
  console.error(
    "Fix: replace the hardcoded value with a TimeoutPolicy constant from novel/timeout-policy/, OR an env var with a documented default. To allow a single-line exception, add `// timeout-ok: <reason ≥3 chars>` to the line (AGENTS.md §14b).",
  );
  process.exit(1);
}
