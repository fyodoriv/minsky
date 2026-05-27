#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-launchd-safe-paths-lint-no-bare-node-python-gh (PR #911) -->
//
// check-launchd-safe-paths — distribution scripts (launchd plists +
// systemd units + the run-*.sh dispatchers they invoke) MUST use absolute
// paths or PATH-prefixed invocations for `node`, `python3`, `gh`,
// `opencode`. launchd strips the user's shell rc, so `node` may resolve
// to a Homebrew installation that differs from the development one — or
// not at all.
//
// Anchors: .claude/skills/launchd-safe-paths/SKILL.md (the skill we're
// ratcheting into a deterministic lint per vision rule #10); AGENTS.md
// §"Pipeline-managed repos" (launchd context).

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Bare-command patterns that fail in launchd's stripped env. Each is
 * matched at word boundaries; the script demands an absolute path or a
 * `PATH=...` prefix on the same line.
 *
 * @type {readonly { re: RegExp, desc: string }[]}
 */
export const BARE_COMMAND_PATTERNS = Object.freeze([
  {
    re: /^[^#]*\b(?<!\/)node\s+(?:[a-zA-Z._-]+|\$)/,
    desc: "bare `node <script>` invocation",
  },
  {
    re: /^[^#]*\b(?<!\/)python3?\s+(?:[a-zA-Z._-]+|\$)/,
    desc: "bare `python` / `python3` invocation",
  },
  {
    re: /^[^#]*\b(?<!\/)gh\s+/,
    desc: "bare `gh` invocation",
  },
  {
    re: /^[^#]*\b(?<!\/)opencode\s+/,
    desc: "bare `opencode` invocation",
  },
  {
    re: /^[^#]*\b(?<!\/)claude\s+(?:--print|--prompt|--mode|--model)/,
    desc: "bare `claude` invocation",
  },
]);

/**
 * Lines that are EXEMPT from the bare-command rule because they DEFINE
 * PATH or invoke a setup helper. The check looks for these markers.
 *
 * @type {readonly RegExp[]}
 */
export const EXEMPT_LINE_MARKERS = Object.freeze([
  /^\s*PATH=/, // export PATH=...
  /^\s*export\s+PATH=/,
  /^\s*source\s+.*\/lib-launchd-path\.sh\b/,
  /^\s*\.\s+.*\/lib-launchd-path\.sh\b/,
  /^\s*#/,
  /\blaunchd-safe-ok:\s*\S.{2,}/, // inline allow
]);

/**
 * Allowlist regex for files exempt from the lint. Each entry must
 * document WHY (docs/DEPRECATED.md reference, etc.).
 *
 * @type {readonly RegExp[]}
 */
export const ALLOWLIST = Object.freeze([
  // run-dashboard-web.sh launches the deprecated novel/dashboard-web
  // feature (docs/DEPRECATED.md §4 — replacement is `minsky watch`).
  // The deprecation policy is "keep for now, do NOT add features".
  // Fixing the launchd-safe-path drift would be a feature-add against
  // deprecated code; better to leave it.
  /^distribution\/run-dashboard-web\.sh$/,
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
export function checkLaunchdSafePaths(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const readText = opts.readText ?? ((p) => readFileSync(p, "utf8"));
  const files = opts.files ?? defaultFileList(repoRoot);
  /** @type {string[]} */
  const violations = [];

  for (const relPath of files) {
    if (ALLOWLIST.some((re) => re.test(relPath))) continue;
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
 * @param {string} src
 * @param {string[]} violations
 */
function scanFile(relPath, src, violations) {
  // If the file sources lib-launchd-path.sh OR sets PATH globally, every
  // subsequent bare command is safe. The skill's canonical pattern is
  // sourcing the helper near the top; once present, the rest of the file
  // is exempt.
  if (fileSourcesPathHelper(src)) return;
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isExempt(line)) continue;
    for (const { re, desc } of BARE_COMMAND_PATTERNS) {
      if (re.test(line)) {
        violations.push(
          `${relPath}:${i + 1}: ${desc} — launchd's stripped env can't resolve this. Use an absolute path (e.g. /usr/local/bin/node) or source distribution/systemd/lib-launchd-path.sh.`,
        );
      }
    }
  }
}

/**
 * Whole-file scan: does the script source lib-launchd-path.sh OR set
 * a global PATH that includes node/gh dirs?
 *
 * @param {string} src
 * @returns {boolean}
 */
function fileSourcesPathHelper(src) {
  return (
    /(?:^|\s)(?:source\s+|\.\s+)[^\n]*lib-launchd-path\.sh/m.test(src) ||
    /^\s*export\s+PATH=.*\b(?:node|fnm|nvm|gh)\b/m.test(src)
  );
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isExempt(line) {
  return EXEMPT_LINE_MARKERS.some((re) => re.test(line));
}

/**
 * @param {string} repoRoot
 * @returns {string[]}
 */
function defaultFileList(repoRoot) {
  try {
    // Scope: shell wrapper scripts under distribution/. The .plist /
    // .service / .timer files are systemd / launchd unit declarations
    // (XML / INI), not bash; their first-string exec resolution is a
    // different shape — those are tracked in a sibling lint
    // (det-* `det-distribution-units-absolute-paths`, future PR). This
    // lint enforces the SKILL.md rule for the bash wrappers themselves.
    const out = execSync('/usr/bin/find distribution -type f -name "*.sh" 2>/dev/null', {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return out.split("\n").filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkLaunchdSafePaths();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-launchd-safe-paths: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  console.error("");
  console.error(
    "Fix: see .claude/skills/launchd-safe-paths/SKILL.md. Either use an absolute path or source `distribution/systemd/lib-launchd-path.sh` before the call.",
  );
  process.exit(1);
}
