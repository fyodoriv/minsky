#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-cli-integration-test-coverage-bin-minsky-subcommands (PR #911) -->
//
// check-cli-integration-test-coverage — every `bin/minsky` subcommand
// must have a sibling `test/integration/<subcommand>.test.ts` OR be
// explicitly grandfathered. Per AGENTS.md §3b.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Subcommands that pre-date this lint. Add NEW subcommands to this
 * list ONLY with a documented one-line reason. The goal is to drain
 * this list down to empty over time.
 *
 * @type {ReadonlySet<string>}
 */
export const GRANDFATHERED = new Set([
  // Existing subcommands without test/integration/<name>.test.ts as of
  // 2026-05-27. Each entry is a future P2 backfill item.
  "status",
  "stop",
  "logs",
  "reset-host-if-crashed",
  "init",
  "doctor",
  "bash-doctor",
  "iter-once",
  "tail-failures",
  "report",
  "benchmark",
  "competitive",
  "install-daemon",
  "uninstall-daemon",
  "update",
  "watch",
  "audit",
  "metrics",
  "changelog",
  "milestone",
  "run",
  "transform",
  "daemon",
  "show",
  "list",
  "config",
  "agent",
  "solve",
  "m1",
  "reset",
  "setup",
  "ui",
  // Excluded entirely (option flags surfaced as subcommands at parser layer):
  "help",
  "version",
  "--help",
  "--version",
]);

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {string[]} subcommands
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [repoRoot]
 * @property {string} [binPath]
 * @property {(p: string) => boolean} [fileExists]
 * @property {(p: string) => string} [readText]
 */

/**
 * Extract `<subcommand>)` lines from a bash case block. Matches the
 * `bin/minsky` dispatch convention.
 *
 * @param {string} src
 * @returns {string[]}
 */
export function extractSubcommands(src) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const line of src.split("\n")) {
    const m = /^\s{2}([a-z][a-z0-9-]*)\)/.exec(line);
    if (m === null || m[1] === undefined) continue;
    found.add(m[1]);
  }
  return Array.from(found).sort();
}

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkCliIntegrationTestCoverage(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const binPath = opts.binPath ?? `${repoRoot}/bin/minsky`;
  const fileExists = opts.fileExists ?? ((p) => existsSync(p));
  const readText = opts.readText ?? ((p) => readFileSync(p, "utf8"));

  let src;
  try {
    src = readText(binPath);
  } catch {
    return {
      ok: false,
      violations: [`Cannot read ${binPath}`],
      subcommands: [],
    };
  }

  const subcommands = extractSubcommands(src);
  /** @type {string[]} */
  const violations = [];

  for (const subcmd of subcommands) {
    if (GRANDFATHERED.has(subcmd)) continue;
    const testPath = `${repoRoot}/test/integration/${subcmd}.test.ts`;
    if (!fileExists(testPath)) {
      violations.push(
        `bin/minsky subcommand "${subcmd}" is missing test/integration/${subcmd}.test.ts. Add the integration test OR add "${subcmd}" to GRANDFATHERED in scripts/check-cli-integration-test-coverage.mjs (with a one-line reason). Per AGENTS.md §3b.`,
      );
    }
  }

  return { ok: violations.length === 0, violations, subcommands };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkCliIntegrationTestCoverage();
  if (result.ok) {
    process.exit(0);
  }
  console.error("check-cli-integration-test-coverage: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}
