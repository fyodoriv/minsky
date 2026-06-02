#!/usr/bin/env node
// @ts-check
// Hardcoded user-path lint. A `MINSKY_HOME ?? "/Users/cbrwizard/…"`
// fallback breaks the script for every operator who isn't `cbrwizard`
// (rule #17 violation we already healed twice in this session — PR #651
// fixed `scripts/local-gate-merge.mjs`, the follow-up fixed
// `scripts/orchestrate.mjs`). Without a deterministic gate, the same
// class of bug returns: a dev hardcodes their own `$HOME` while writing
// a script and ships it.
//
// The rule:
//   Executable lines under `novel/**`, `scripts/**`, `bin/**`, and
//   `distribution/**` MUST NOT match `/Users/<not-the-current-user>` or
//   `/home/<literal>`. Comments are exempt (the historical reference is
//   the rationale for the fix and aids audit). The current-user
//   exemption is intentional: an operator running this lint locally
//   gets no false-positives for their own absolute imports of, e.g.,
//   AGENTS.md examples that happen to mention their own path. CI runs
//   as `runner` (or similar non-`cbrwizard` user), so the lint catches
//   anything that accidentally hardcodes `/Users/somebody-else/…`.
//
// Pattern: deterministic gate (rule #10).
// Source: rule #1 (don't hand-maintain what should be derived from the
//   script's own location); rule #17 (proactive healing — same class of
//   bug must not recur); operator directive 2026-05-19.
// Conformance: full — pure function over file contents, no LLM in the
//   chain.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Roots scanned for the lint. */
const SCAN_ROOTS = ["novel", "scripts", "bin", "distribution"];

/** Extensions whose lines we treat as executable code. */
const EXECUTABLE_EXTS = new Set([".ts", ".mjs", ".cjs", ".js", ".sh", ".bash"]);

/** Path skip-list (vendored / generated). */
const SKIP_FRAGMENTS = ["/dist/", "/node_modules/", "/.minsky/", "/.worktrees/"];

/** Allow tests to keep their own fixture paths.
 *  @param {string} p
 *  @returns {boolean}
 */
function isTestPath(p) {
  return /\.(test|spec|fixture)\.(ts|mjs|cjs|js)$/.test(p);
}

/**
 * @typedef {object} Violation
 * @property {string} path
 * @property {number} line       1-based
 * @property {string} match      the offending substring
 * @property {string} content    the full line
 */

/**
 * Pure function. See module header for semantics.
 *
 * @param {{
 *   files: ReadonlyMap<string, string>,
 *   currentUser: string,
 * }} input
 * @returns {{ violations: readonly Violation[] }}
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: lint scanner with multiple nested filters — refactor tracked in TASKS.md `scripts-complexity-refactor`
export function checkNoHardcodedUserPaths({ files, currentUser }) {
  /** @type {Violation[]} */
  const violations = [];
  // The user-name in the violation regex must be a literal name, not
  // the current-user. We keep the regex broad and let the second-pass
  // filter strip the current-user case.
  const macUserRe = /\/Users\/([a-zA-Z][a-zA-Z0-9._-]+)/g;
  const linuxUserRe = /\/home\/([a-zA-Z][a-zA-Z0-9._-]+)/g;
  for (const [path, content] of files) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      // Strip leading whitespace; if first non-ws char is `#` or `//`, it's a comment.
      const trimmed = line.trimStart();
      if (trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      for (const re of [macUserRe, linuxUserRe]) {
        re.lastIndex = 0;
        let match;
        // biome-ignore lint/suspicious/noAssignInExpressions: standard JS regex iteration idiom
        while ((match = re.exec(line)) !== null) {
          const user = match[1];
          if (user === undefined) continue;
          if (user === currentUser) continue;
          // Common false-positives we exempt:
          if (user === "ubuntu" || user === "runner") continue;
          if (line.includes("/Users/.../")) continue; // glob-shaped doc example
          violations.push({
            path,
            line: i + 1,
            match: match[0],
            content: line.length > 200 ? `${line.slice(0, 200)}…` : line,
          });
        }
      }
    }
  }
  return { violations };
}

// --------------------------------------------------------------- CLI -------

/**
 * @param {string} dir
 * @returns {string[]}
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: directory walker with skip-list filters — refactor tracked in TASKS.md `scripts-complexity-refactor`
function walkFiles(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIP_FRAGMENTS.some((s) => full.includes(s))) continue;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...walkFiles(full));
      continue;
    }
    if (!stat.isFile()) continue;
    if (isTestPath(full)) continue;
    if (!EXECUTABLE_EXTS.has(extname(full))) continue;
    out.push(full);
  }
  return out;
}

/**
 * @param {string} repo
 * @returns {Map<string, string>}
 */
function loadFiles(repo) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const root of SCAN_ROOTS) {
    for (const path of walkFiles(resolve(repo, root))) {
      try {
        map.set(path.slice(repo.length + 1), readFileSync(path, "utf8"));
      } catch {
        // Best-effort — unreadable files are simply skipped.
      }
    }
  }
  return map;
}

function currentUser() {
  return process.env["USER"] ?? process.env["LOGNAME"] ?? process.env["USERNAME"] ?? "";
}

function main() {
  const files = loadFiles(REPO_ROOT);
  const { violations } = checkNoHardcodedUserPaths({
    files,
    currentUser: currentUser(),
  });
  if (violations.length === 0) {
    process.stdout.write(
      `no-hardcoded-user-paths ok: ${files.size} executable file(s) scanned, no /Users/<other-user>/* or /home/<other-user>/* in non-comment lines.\n`,
    );
    process.exit(0);
    return;
  }
  process.stderr.write(
    `no-hardcoded-user-paths violation: ${violations.length} hardcoded user-path(s) in executable code:\n`,
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.path}:${v.line}  ${v.match}\n`);
    process.stderr.write(`    ${v.content.trim()}\n`);
  }
  process.stderr.write(
    "\nFix: replace with a path derived from the script's own location, e.g.\n" +
      '  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");\n' +
      "or read from an env var (e.g. `process.env.MINSKY_HOME`) with no hardcoded fallback.\n" +
      "Comments referencing a historical user path are allowed (audit trail).\n",
  );
  process.exit(1);
}

const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-no-hardcoded-user-paths.mjs");
if (isCli) main();
