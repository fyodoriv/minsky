#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-29 operator directive "It must only run when I explicitly tell it so. Fix immediately" → rule #19 enforcement -->
//
// check-supervisor-explicit-start — deterministic CI gate for
// vision.md rule #19 (operator-explicit-start). Scans the whole
// repo for `launchctl bootstrap` and `systemctl --user enable --now`
// invocations and fails if any land outside the allowlisted paths.
//
// Why this gate (rule #10 — deterministic enforcement, not LLM):
// a rule that says "never auto-launch heavy work" needs a mechanical
// check, not a Skill primer. The 2026-05-29 incident — machine reload
// silently brought 7 com.minsky.* plists back online and held ~42 GB
// of wired RAM hostage — happened because the source rule was implicit
// in setup.sh's behavior, not enforced in CI. A future PR could
// silently re-introduce unconditional bootstrap in a new script
// without this lint catching it. This file is the iron gate.
//
// What it catches (rule #19 anti-pattern #3):
//   - `launchctl bootstrap gui/$(id -u) <plist>` outside the allowlist
//   - `systemctl --user enable --now <unit>` outside the allowlist
//   - `RunAtLoad: true` in a NEW plist template under
//     distribution/launchd/ without a paired test-allowlist entry
//
// What it does NOT catch (out of scope; orthogonal lints handle):
//   - Comments / docstrings mentioning the commands (we scan source
//     code lines, not comment-only lines)
//   - Test fixtures that need to LIE about the command shape
//     (test files are allowlisted on purpose)
//   - `launchctl bootout` (eviction is always OK)
//   - `launchctl print` (read-only is always OK)
//
// Allowlist rationale (every path documented):
//   - `setup.sh` — supervisor install path; gated behind WITH_SUPERVISOR
//     per rule #19 anti-pattern #1 (pinned by setup-supervisor-opt-in.test.ts)
//   - `bin/minsky` — `install-daemon` subcommand; operator-explicit by
//     name (the operator must invoke `minsky install-daemon` themselves)
//   - `distribution/test-supervisor.sh` — test script that tests
//     supervisor lifecycle; lifts the call into a test context (operator
//     never invokes this script in normal usage)
//   - `test/integration/setup-supervisor-opt-in.test.ts` — assertion
//     regexes; not actual command invocations
//
// Adding a new legitimate caller? Edit ALLOWED_PATHS below and
// document the operator-explicit path that gates the new call.
// A new caller with no gate is by design what this lint catches —
// don't bypass without amending vision.md § rule #19.
//
// Anchors: vision.md § rule #19 (operator-explicit-start); vision.md
// § rule #10 (deterministic enforcement); AGENTS.md § "Iron rules
// have deterministic gates".

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Paths that are EXEMPT from the lint. Each row carries a comment
 * explaining the operator-explicit gate that protects the call site.
 *
 * @type {readonly { pattern: RegExp; rationale: string }[]}
 */
export const ALLOWED_PATHS = Object.freeze([
  {
    pattern: /^setup\.sh$/,
    rationale:
      "Supervisor install path. Gated behind WITH_SUPERVISOR (--with-supervisor flag) per rule #19 anti-pattern #1. Pinned by test/integration/setup-supervisor-opt-in.test.ts.",
  },
  {
    pattern: /^bin\/minsky$/,
    rationale:
      "`install-daemon` subcommand. Operator-explicit by name — the operator must invoke `minsky install-daemon` themselves.",
  },
  {
    pattern: /^distribution\/test-supervisor\.sh$/,
    rationale:
      "Supervisor-lifecycle test script. Test-only context; operators never invoke this in normal usage.",
  },
  {
    pattern: /^test\/integration\/setup-supervisor-opt-in\.test\.ts$/,
    rationale: "Assertion regexes for the WITH_SUPERVISOR gate, not actual command invocations.",
  },
  {
    pattern: /^scripts\/check-supervisor-explicit-start\.mjs$/,
    rationale: "This lint itself. Self-referential — names the commands to ban.",
  },
  {
    pattern: /^scripts\/check-supervisor-explicit-start\.test\.mjs$/,
    rationale: "This lint's tests. Self-referential — fixtures contain the banned strings.",
  },
  {
    pattern: /^vision\.md$/,
    rationale: "Rule #19 itself names the banned commands in its anti-pattern list.",
  },
  {
    pattern: /^docs\//,
    rationale: "Documentation may discuss the commands (history, deprecation notes, runbooks).",
  },
  {
    pattern: /^CHANGELOG\.md$/,
    rationale: "Release notes may mention supervisor bootstrap.",
  },
  {
    pattern: /^TASKS\.md$/,
    rationale: "Task descriptions may discuss supervisor work.",
  },
  {
    pattern: /^AGENTS\.md$/,
    rationale: "Agent runbook may name the commands when documenting the explicit-start contract.",
  },
  {
    pattern: /^README\.md$/,
    rationale: "Onboarding doc may name the supervisor commands.",
  },
  {
    pattern: /^user-stories\//,
    rationale: "User stories may describe the supervisor lifecycle.",
  },
  {
    pattern: /^experiments\//,
    rationale: "Experiment YAMLs may name supervisor commands in hypothesis/measurement.",
  },
]);

/**
 * Match the banned-command shapes. We only fire on the actual command
 * invocation form, not on string-literal or comment-only mentions.
 *
 * `launchctl bootstrap` — only the bootstrap subcommand. Bootout
 * (eviction), print (read), and other launchctl verbs are fine.
 *
 * `systemctl --user enable --now` — only the combined enable+start
 * form. `systemctl --user enable <unit>` alone (without --now) doesn't
 * start the unit until next login, so it's slightly less severe; but
 * we ban both for clarity — operators must use the --with-supervisor
 * gate path either way.
 *
 * @type {readonly RegExp[]}
 */
export const BANNED_PATTERNS = Object.freeze([
  /\blaunchctl\s+bootstrap\b/,
  /\bsystemctl\s+--user\s+enable\s+--now\b/,
]);

/**
 * Files we scan. Restricted to source/script extensions; comments
 * in any of these are still scanned but the lint only fires when
 * the line is NOT a pure comment.
 *
 * @type {readonly RegExp[]}
 */
export const SCAN_EXTENSIONS = Object.freeze([
  /\.sh$/,
  /\.mjs$/,
  /\.js$/,
  /\.ts$/,
  /\.tsx$/,
  /\.py$/,
]);

/**
 * Directories we never descend into. Build outputs, dep trees, etc.
 *
 * @type {readonly RegExp[]}
 */
export const SKIP_DIRS = Object.freeze([
  /^node_modules$/,
  /^dist$/,
  /^coverage$/,
  /^\.git$/,
  /^\.minsky$/,
  /^\.claude$/,
  /^\.worktrees$/,
  /^tmp$/,
  /^\.cache$/,
]);

/**
 * @typedef {object} Violation
 * @property {string} path Relative path from REPO_ROOT.
 * @property {number} line 1-indexed line number.
 * @property {string} match The matched banned pattern.
 * @property {string} content The line's content (trimmed).
 */

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {Violation[]} violations
 * @property {number} filesScanned
 */

/**
 * Recursively walk a directory and return all source files matching
 * SCAN_EXTENSIONS. Pure-ish: takes the seed dir, returns file paths
 * relative to REPO_ROOT.
 *
 * @param {string} rootDir
 * @returns {string[]}
 */
export function walkRepo(rootDir) {
  /** @type {string[]} */
  const out = [];
  visitDir(rootDir, rootDir, out);
  return out.sort();
}

/**
 * Recurse into one directory, appending matching source files (relative
 * to `rootDir`) to `out`. Extracted from {@link walkRepo} to keep each
 * function's cognitive complexity ≤10 (biome cap).
 *
 * @param {string} dir
 * @param {string} rootDir
 * @param {string[]} out
 */
function visitDir(dir, rootDir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statOrUndefined(full);
    if (st === undefined) continue;
    if (st.isDirectory() && !matchesAny(SKIP_DIRS, name)) {
      visitDir(full, rootDir, out);
    } else if (st.isFile() && matchesAny(SCAN_EXTENSIONS, name)) {
      out.push(relative(rootDir, full));
    }
  }
}

/**
 * True when any regex in `patterns` matches `value`. Extracted so the
 * `.some()` callback doesn't inflate the caller's cognitive complexity.
 *
 * @param {readonly RegExp[]} patterns
 * @param {string} value
 * @returns {boolean}
 */
function matchesAny(patterns, value) {
  for (const re of patterns) {
    if (re.test(value)) return true;
  }
  return false;
}

/**
 * `statSync` that returns `undefined` instead of throwing on a broken
 * symlink / race-removed entry. Isolates the try/catch so the caller's
 * complexity stays low.
 *
 * @param {string} p
 * @returns {import("node:fs").Stats | undefined}
 */
function statOrUndefined(p) {
  try {
    return statSync(p);
  } catch {
    return undefined;
  }
}

/**
 * Decide whether a single line is a pure comment in its host language.
 * Bash/python comments start with `#`. JS/TS comments start with `//`
 * or are inside `/* ... *\/` (we don't track multi-line; the few lines
 * that span a multi-line comment will be flagged as code, which is
 * fine — the operator can always inline-document a real command).
 *
 * @param {string} line
 * @param {string} path
 * @returns {boolean}
 */
function isPureComment(line, path) {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  if (path.endsWith(".sh") || path.endsWith(".py")) {
    return trimmed.startsWith("#");
  }
  // .ts, .mjs, .js, .tsx
  if (trimmed.startsWith("//") || trimmed.startsWith("*")) return true;
  return false;
}

/**
 * @param {{ repoRoot?: string; readFile?: (p: string) => string; files?: readonly string[] }} [opts]
 * @returns {CheckResult}
 */
export function checkSupervisorExplicitStart(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const readFile = opts.readFile ?? ((p) => readFileSync(p, "utf8"));
  const files = opts.files ?? walkRepo(repoRoot);

  /** @type {Violation[]} */
  const violations = [];
  for (const relPath of files) {
    if (ALLOWED_PATHS.some(({ pattern }) => pattern.test(relPath))) continue;
    const content = readOrUndefined(readFile, join(repoRoot, relPath));
    if (content === undefined) continue;
    scanLines(relPath, content, violations);
  }

  return {
    ok: violations.length === 0,
    violations,
    filesScanned: files.length,
  };
}

/**
 * Read a file, returning `undefined` on any I/O error (e.g. a file in
 * the listing that vanished mid-scan). Isolates the try/catch.
 *
 * @param {(p: string) => string} readFile
 * @param {string} absPath
 * @returns {string | undefined}
 */
function readOrUndefined(readFile, absPath) {
  try {
    return readFile(absPath);
  } catch {
    return undefined;
  }
}

/**
 * Scan one file's content for banned patterns, pushing any hits into
 * `violations`. Extracted from {@link checkSupervisorExplicitStart} to
 * keep both functions' cognitive complexity ≤10 (biome cap).
 *
 * @param {string} relPath
 * @param {string} content
 * @param {Violation[]} violations
 */
function scanLines(relPath, content, violations) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || isPureComment(line, relPath)) continue;
    for (const pattern of BANNED_PATTERNS) {
      const m = line.match(pattern);
      if (m !== null) {
        violations.push({ path: relPath, line: i + 1, match: m[0], content: line.trim() });
      }
    }
  }
}

// CLI entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkSupervisorExplicitStart();
  if (result.ok) {
    process.stdout.write(
      `check-supervisor-explicit-start: clean (${result.filesScanned} file(s) scanned; no unprovenanced launchctl bootstrap / systemctl --user enable --now calls outside the allowlist).\n`,
    );
    process.exit(0);
  }
  process.stderr.write("check-supervisor-explicit-start: violations found:\n");
  for (const v of result.violations) {
    process.stderr.write(`  ${v.path}:${v.line}: "${v.match}" — line: \`${v.content}\`\n`);
  }
  process.stderr.write(
    "\nPer vision.md § rule #19 (operator-explicit-start), every\n" +
      "`launchctl bootstrap` and `systemctl --user enable --now` call\n" +
      "MUST live in an allowlisted path that gates the call behind an\n" +
      "explicit operator action. Add the new caller's path to ALLOWED_PATHS\n" +
      "in scripts/check-supervisor-explicit-start.mjs (with a rationale\n" +
      "documenting the operator-explicit gate), or remove the call.\n",
  );
  process.exit(1);
}
