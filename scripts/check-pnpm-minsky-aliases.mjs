#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved cohort task per cli-consolidation-lint-prevents-regression (sibling of PR #926) -->
//
// check-pnpm-minsky-aliases — every `minsky:*` script in package.json
// must be a thin delegate to `bin/minsky <verb>` (no `setup.sh`, no
// `launchctl`, no inline shell composition). PR #907 + PR #926 closed
// the structural drift; this lint prevents the decay.
//
// Per AGENTS.md §"CLI surface consolidation" (vision rule #16
// corollary): "New CLI capabilities default to flags on existing
// commands or default behavior of existing commands — never new
// subcommands."
//
// Regex shape — accepts:
//   "bin/minsky <verb>"                   — bare delegate
//   "bin/minsky <verb> --once"            — single flag
//   "bin/minsky <verb> --once --host x"   — multiple flags
// Rejects:
//   "./setup.sh --setup"                  — legacy substrate
//   "PORT=8181 bash distribution/run-…"  — env-prefixed inline shell
//   "launchctl … || systemctl …"          — OS-shell composition
//   "bin/minsky a && bin/minsky b"        — multi-command pipelines
//
// Anchors: rule #1 (one canonical implementation per concern);
// rule #10 (deterministic enforcement); operator directive 2026-05-27.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Delegate-only regex. Allows `bin/minsky <verb>` optionally followed
 * by space-separated flag tokens. A flag token is either a short/long
 * flag (`-q`, `--once`), or a value chunk (`--host /tmp/x`, `--host=x`).
 * Excludes shell metacharacters (`|`, `&`, `;`, `$`, `>`, `<`).
 *
 * @type {RegExp}
 */
export const DELEGATE_REGEX = /^bin\/minsky\s+\w+(\s+(--?[\w-]+(=[\w./-]+)?|[\w./-]+))*\s*$/;

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {number} scannedCount
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [packageJsonPath]
 * @property {Record<string, string>} [scripts]
 */

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkPnpmMinskyAliases(opts = {}) {
  const scripts = opts.scripts ?? loadScripts(opts.packageJsonPath);
  /** @type {string[]} */
  const violations = [];
  /** @type {string[]} */
  const minskyAliases = Object.keys(scripts).filter((k) => k.startsWith("minsky:"));

  for (const name of minskyAliases) {
    const value = scripts[name];
    if (value === undefined) continue;
    if (!DELEGATE_REGEX.test(value)) {
      violations.push(
        `${name}: must delegate to \`bin/minsky <verb>\` (no inline shell, no legacy substrate). Got: ${value}\n    Fix: replace with \`bin/minsky ${name.replace("minsky:", "")}\`. If the canonical bin/minsky verb lacks the equivalent surface, expand it FIRST per cli-consolidate-pnpm-minsky-scripts §Pivot.`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    scannedCount: minskyAliases.length,
  };
}

/**
 * @param {string | undefined} packageJsonPath
 * @returns {Record<string, string>}
 */
function loadScripts(packageJsonPath) {
  const path = packageJsonPath ?? `${REPO_ROOT}/package.json`;
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  return pkg.scripts ?? {};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkPnpmMinskyAliases();
  if (result.ok) {
    process.stdout.write(
      `check-pnpm-minsky-aliases: ok (${result.scannedCount} minsky:* alias(es) verified)\n`,
    );
    process.exit(0);
  }
  console.error(`check-pnpm-minsky-aliases: ${result.violations.length} violation(s):`);
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}
