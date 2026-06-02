#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-no-no-verify-bypass-pre-commit-hooks (PR #911) -->
//
// check-no-no-verify-bypass — static scan for `--no-verify` / `-n` in any
// `git commit` / `git push` invocation in tracked source files
// (`bin/**`, `novel/**`, `scripts/**`, `distribution/**`).
//
// Complements the Tier 1 hook `.claude/hooks/block-dangerous-bash.sh`
// which blocks the pattern at agent-tool-call time. This lint is the
// belt-and-suspenders second layer per vision rule #10: even if the
// Tier 1 hook is removed or bypassed, a `--no-verify` in committed
// source code fails the CI gate.
//
// Anchors: AGENTS.md §"Git Safety (Multi-Agent)"; vision rule #10;
// claude-code GHE #40117 (the canonical "Claude bypassed deny rules via
// --no-verify across six consecutive commits" incident).

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Forbidden patterns. Each catches a known bypass shape from
 * AGENTS.md §"Git Safety" + claude-code #40117.
 *
 * @type {readonly { re: RegExp, desc: string }[]}
 */
export const NO_VERIFY_PATTERNS = Object.freeze([
  {
    re: /\bgit\s+(?:commit|push)\b[^\n]*\s--no-verify\b/,
    desc: "`git commit/push --no-verify` (pre-commit / pre-push hook bypass)",
  },
  {
    re: /\bgit\s+(?:commit|push)\b[^\n]*\s-n\b/,
    desc: "`git commit/push -n` (short form of --no-verify)",
  },
  {
    re: /\bgit\s+-c\s+core\.hooksPath=/,
    desc: "`git -c core.hooksPath=...` (subtle hook bypass)",
  },
  {
    re: /\bgit\s+commit\b[^\n]*\s--no-verify=true\b/,
    desc: "`git commit --no-verify=true`",
  },
]);

/**
 * Allowlist regex for files that legitimately MENTION the patterns
 * (documentation, the Tier 1 hook itself, the @block-no-verify lint
 * upstream package's docs).
 *
 * @type {readonly RegExp[]}
 */
export const ALLOWLIST = Object.freeze([
  /^\.claude\/hooks\/block-dangerous-bash\.sh$/, // the hook itself catches the pattern
  /^scripts\/check-no-no-verify-bypass\.mjs$/, // this lint
  /^scripts\/check-no-no-verify-bypass\.test\.mjs$/, // its tests
  // The bot-commit-hook-bypass lint + test necessarily MENTION the banned
  // patterns (core.hooksPath, --no-verify) to document why they're rejected
  // as workflow bypasses and to assert --no-verify is NOT accepted. Same
  // self-reference carve-out as this lint's own files above.
  /^scripts\/check-bot-commit-hook-bypass\.mjs$/,
  /^scripts\/check-bot-commit-hook-bypass\.test\.mjs$/,
  /^scripts\/check-toolchain\.mjs$/, // documents the rule in its error-message text
  /^AGENTS\.md$/, // documentation
  /^TASKS\.md$/, // task descriptions discuss the rule
  /^vision\.md$/, // constitution
  /^CHANGELOG\.md$/, // PR write-ups
  /^docs\/.*\.md$/, // any doc file may discuss the pattern
  /^research\.md$/,
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
export function checkNoNoVerifyBypass(opts = {}) {
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
    const line = lines[i] ?? "";
    if (lineIsCommentOrAllowlistedInline(line)) continue;
    for (const { re, desc } of NO_VERIFY_PATTERNS) {
      if (re.test(line)) {
        violations.push(
          `${relPath}:${i + 1}: ${desc} — bypasses lefthook pre-commit/pre-push. See AGENTS.md §"Git Safety".`,
        );
      }
    }
  }
}

/**
 * Skip lines that are pure comments or carry an inline allow marker.
 *
 * @param {string} line
 * @returns {boolean}
 */
function lineIsCommentOrAllowlistedInline(line) {
  if (/^\s*(?:#|\/\/)/.test(line)) return true;
  return /\b(no-verify-ok|hook-bypass-ok):/.test(line);
}

/**
 * @param {string} repoRoot
 * @returns {string[]}
 */
function defaultFileList(repoRoot) {
  try {
    const out = execSync(
      '/usr/bin/find bin novel scripts distribution .claude/hooks -type f \\( -path "*/dist/*" -o -path "*/node_modules/*" -o -path "*/.minsky/*" \\) -prune -o \\( -name "*.ts" -o -name "*.mjs" -o -name "*.sh" -o -name "*.js" \\) -print 2>/dev/null',
      { cwd: repoRoot, encoding: "utf8" },
    );
    return out.split("\n").filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkNoNoVerifyBypass();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-no-no-verify-bypass: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  console.error("");
  console.error(
    "Fix: remove the --no-verify / -n flag. Run lefthook normally; if a hook is broken, fix the hook (rule #17 proactive healing) — never bypass.",
  );
  process.exit(1);
}
