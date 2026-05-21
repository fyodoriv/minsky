#!/usr/bin/env node
// @ts-check
// Hardcoded personal-path lint for DOCUMENTATION.
//
// The sibling `check-no-hardcoded-user-paths.mjs` catches /Users/<other-user>/
// in executable code (novel/, scripts/, bin/, distribution/) but exempts the
// current user — so a developer's local error message containing their own
// path doesn't trip the lint when they run it on their own machine.
//
// For DOCUMENTATION that ships to other users, EVERY user-specific path is a
// leak. This linter is stricter: it bans, in tracked .md files and bin/minsky
// COMMENTS (the only doc-shaped lines in the shell shim):
//
//   1. `~/apps/tooling/` — the original leaker's personal layout
//   2. The literal username `fivanishche` (original leak), bare-word match
//   3. `/Users/<any-user>/` — any absolute mac user path
//   4. `/home/<literal>/` — any absolute linux user path (common runtime
//      users `ubuntu` / `runner` exempt because those are documented runtime
//      identities in CI examples)
//
// Opt-out for legitimate occurrences (e.g., the bin/minsky FALLBACKS list,
// the linter's own test fixtures, the README-mentioned generic placeholders):
// append a same-line comment matching `/(?:<!-- |# |\/\/ )not-personal: .+/`.
//
// The reason text is grepable for audit:
//   grep -rE "not-personal:" --include='*.md' --include='*.mjs' --include='bin/*'
//
// Rule reference: rule #17 (proactive healing — leaks observed in this
// session; this linter is the heal). Composed with rule #10 (deterministic
// enforcement — every rule is a CI lint, not a hope). Operator directive
// 2026-05-20 ("ensure no documentation of minsky shows any of my apps
// structure or user").

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Roots to scan for markdown docs. */
const SCAN_ROOTS_MD = [".", "docs", "user-stories"];

/** Single-file targets that aren't in a scanned root (bin/minsky is shell, not .md). */
const SCAN_FILES_EXTRA = ["bin/minsky"];

/** Skip these directory fragments (vendored / generated). */
const SKIP_FRAGMENTS = [
  "/dist/",
  "/node_modules/",
  "/.minsky/",
  "/.worktrees/",
  "/.git/",
  "/competitors/",
  "/.devin/",
  "/.claude/",
];

/** Skip these path basenames (linter itself + its test + the existing sibling linter's regex). */
const SKIP_BASENAMES = new Set([
  "check-no-personal-paths-in-docs.mjs",
  "check-no-personal-paths-in-docs.test.mjs",
  "check-no-hardcoded-user-paths.mjs",
  "check-no-hardcoded-user-paths.test.mjs",
]);

/** Common runtime users in CI examples that aren't leaks. */
const LINUX_USER_ALLOWLIST = new Set(["ubuntu", "runner", "root"]);

/**
 * @typedef {object} Violation
 * @property {string} path        relative to repo root
 * @property {number} line        1-based
 * @property {string} match       the offending substring
 * @property {string} reason      which of the 4 rules tripped
 * @property {string} content     the full line (truncated to 200 chars)
 */

const OPT_OUT_RE = /(?:<!-- |# |\/\/ )not-personal: .+/;

/**
 * Pure function. See module header for semantics.
 *
 * @param {{ files: ReadonlyMap<string, string> }} input
 * @returns {{ violations: readonly Violation[] }}
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: doc-scope lint scanner with four pattern-checks per line — same shape as the sibling check-no-hardcoded-user-paths.mjs which carries the same biome-ignore. Refactor tracked in TASKS.md `scripts-complexity-refactor` alongside the existing scanner.
export function checkNoPersonalPathsInDocs({ files }) {
  /** @type {Violation[]} */
  const violations = [];
  const appsToolingRe = /~\/apps\/tooling\//g;
  const usernameRe = /\bfivanishche\b/g;
  const macUserRe = /\/Users\/([a-zA-Z][a-zA-Z0-9._-]+)/g;
  const linuxUserRe = /\/home\/([a-zA-Z][a-zA-Z0-9._-]+)/g;
  for (const [path, content] of files) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (OPT_OUT_RE.test(line)) continue;
      // For bin/minsky (shell): only check comment lines. The FALLBACKS list
      // is intentional back-compat in executable code; the linter only
      // patrols prose-shaped content (markdown + shell comments + docstring
      // blocks).
      if (path === "bin/minsky") {
        const trimmed = line.trimStart();
        if (!trimmed.startsWith("#")) continue;
      }
      // Rule 1: ~/apps/tooling/
      appsToolingRe.lastIndex = 0;
      const apps = appsToolingRe.exec(line);
      if (apps !== null) {
        violations.push({
          path,
          line: i + 1,
          match: apps[0],
          reason:
            "personal-layout: ~/apps/tooling/ is the original leaker's layout, not a generic recommendation",
          content: line.length > 200 ? `${line.slice(0, 200)}…` : line,
        });
      }
      // Rule 2: literal fivanishche
      usernameRe.lastIndex = 0;
      const user = usernameRe.exec(line);
      if (user !== null) {
        violations.push({
          path,
          line: i + 1,
          match: user[0],
          reason: "literal-username: `fivanishche` is the original leaker's username",
          content: line.length > 200 ? `${line.slice(0, 200)}…` : line,
        });
      }
      // Rule 3: /Users/<any-user>/
      macUserRe.lastIndex = 0;
      let macMatch;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard JS regex iteration idiom
      while ((macMatch = macUserRe.exec(line)) !== null) {
        violations.push({
          path,
          line: i + 1,
          match: macMatch[0],
          reason:
            "user-absolute-path: /Users/<user>/ is an absolute path that leaks the writer's machine",
          content: line.length > 200 ? `${line.slice(0, 200)}…` : line,
        });
      }
      // Rule 4: /home/<literal>/ (allowlisting common runtime users)
      linuxUserRe.lastIndex = 0;
      let linMatch;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard JS regex iteration idiom
      while ((linMatch = linuxUserRe.exec(line)) !== null) {
        const u = linMatch[1];
        if (u !== undefined && LINUX_USER_ALLOWLIST.has(u)) continue;
        violations.push({
          path,
          line: i + 1,
          match: linMatch[0],
          reason:
            "user-absolute-path: /home/<user>/ is an absolute path that leaks the writer's machine",
          content: line.length > 200 ? `${line.slice(0, 200)}…` : line,
        });
      }
    }
  }
  return { violations };
}

// --------------------------------------------------------------- CLI -------

/**
 * Walk a directory and collect .md files (recursive).
 * @param {string} dir
 * @returns {string[]}
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: directory walker with skip-list filters — same shape as the sibling check-no-hardcoded-user-paths.mjs walker which carries the same biome-ignore. Refactor tracked in TASKS.md `scripts-complexity-refactor`.
function walkMarkdown(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIP_FRAGMENTS.some((s) => `${full}/`.includes(s))) continue;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...walkMarkdown(full));
      continue;
    }
    if (!stat.isFile()) continue;
    if (SKIP_BASENAMES.has(basename(full))) continue;
    if (extname(full) !== ".md") continue;
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
  // Markdown roots
  for (const root of SCAN_ROOTS_MD) {
    const abs = resolve(repo, root);
    for (const f of walkMarkdown(abs)) {
      const rel = f.startsWith(`${repo}/`) ? f.slice(repo.length + 1) : f;
      map.set(rel, readFileSync(f, "utf8"));
    }
  }
  // Extra single-file targets (e.g., bin/minsky shell comments)
  for (const rel of SCAN_FILES_EXTRA) {
    const abs = resolve(repo, rel);
    if (!existsSync(abs)) continue;
    map.set(rel, readFileSync(abs, "utf8"));
  }
  return map;
}

const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-no-personal-paths-in-docs.mjs");

if (isCli) {
  const files = loadFiles(REPO_ROOT);
  const { violations } = checkNoPersonalPathsInDocs({ files });
  if (violations.length === 0) {
    process.stdout.write(
      `no-personal-paths-in-docs ok: ${files.size} doc file(s) scanned, no personal layout / username / user-absolute-path leaks.\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `no-personal-paths-in-docs violation: ${violations.length} leak(s) in docs:\n`,
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.path}:${v.line}\n`);
    process.stderr.write(`    match: ${v.match}\n`);
    process.stderr.write(`    reason: ${v.reason}\n`);
    process.stderr.write(`    line: ${v.content}\n`);
  }
  process.stderr.write(
    "\nFix: replace with a generic placeholder (`<minsky-repo>`, `$MINSKY_REPO`, `<user-home>`, `<repos-parent>`) OR add a same-line opt-out comment matching `<!-- not-personal: <reason> --> | # not-personal: <reason> | // not-personal: <reason>` if the occurrence is intentional (e.g., back-compat fallback).\n",
  );
  process.exit(1);
}
