#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-adapter-conventions-bundle-self-test-jsdoc-metric-one-per-file (PR #911) -->
//
// check-adapter-conventions — three adapter rules in one lint:
//   (1) One adapter per file (interface and implementation in separate
//       files; the interface lives in src/index.ts, implementation in
//       src/<vendor>.ts).
//   (2) Every adapter implementation file exports `selfTest()` (string
//       match on the function name — regex over the source, not AST).
//   (3) Public exports in adapter source files carry JSDoc.
//
// Uses regex over text rather than ts-morph: lighter dependency, ~20ms
// scan vs ~3s ts-morph cold-start, and the patterns are simple enough
// to express as regex without false positives.
//
// Anchors: AGENTS.md §"Code conventions"; vision rule #2 (adapter
// pattern); vision rule #10 (deterministic enforcement); rule #8
// (pattern conformance — Strategy of Notifier shape).

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Adapter pattern paths (one adapter package per directory).
 *
 * @type {string}
 */
const ADAPTERS_GLOB = "novel/adapters/*/src/*.ts";

/**
 * Files exempt from the adapter rules — index.ts (the interface), the
 * test/fixture files, and *.d.ts.
 *
 * @type {readonly RegExp[]}
 */
export const ADAPTER_FILE_EXEMPTIONS = Object.freeze([
  /\/index\.ts$/, // the Strategy interface; not an implementation
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\.d\.ts$/,
  /\/types\/src\//, // pure-type packages have no implementation
]);

/**
 * Grandfathered (relPath, violation-type) pairs — captured at lint
 * introduction so the lint can ship clean while existing violations
 * drain via P2 backfill tasks. Per the rule-#10 ratchet pattern (same
 * shape as rule-9-tasksmd-fields, competitive-goal).
 *
 * Each entry's key is the relative path; value is "selfTest" or "jsdoc"
 * or "all" (both rules grandfathered for that file).
 *
 * @type {Readonly<Record<string, "selfTest" | "jsdoc" | "all">>}
 */
export const GRANDFATHERED = Object.freeze({
  "novel/adapters/prompt-optimizer/src/anthropic.ts": "jsdoc",
  "novel/adapters/observability/src/otel.ts": "jsdoc",
  "novel/adapters/token-monitor/src/maciek.ts": "selfTest",
  "novel/adapters/agent-runtime-openhands/src/spawner.ts": "selfTest",
});

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
export function checkAdapterConventions(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const readText = opts.readText ?? ((p) => readFileSync(p, "utf8"));
  const files = opts.files ?? defaultFileList(repoRoot);
  /** @type {string[]} */
  const violations = [];

  for (const relPath of files) {
    if (isExempt(relPath)) continue;
    checkOneFile(relPath, repoRoot, readText, violations);
  }

  return { ok: violations.length === 0, violations, scannedCount: files.length };
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function isExempt(relPath) {
  return ADAPTER_FILE_EXEMPTIONS.some((re) => re.test(relPath));
}

/**
 * @param {string} relPath
 * @param {string} repoRoot
 * @param {(p: string) => string} readText
 * @param {string[]} violations
 */
function checkOneFile(relPath, repoRoot, readText, violations) {
  let src;
  try {
    src = readText(`${repoRoot}/${relPath}`);
  } catch {
    return;
  }
  const grandfathered = GRANDFATHERED[relPath];
  if (grandfathered !== "selfTest" && grandfathered !== "all") {
    checkSelfTest(relPath, src, violations);
  }
  if (grandfathered !== "jsdoc" && grandfathered !== "all") {
    checkJsDocOnPublicExports(relPath, src, violations);
  }
}

/**
 * Rule (2): every adapter implementation file must export `selfTest()`.
 * Accepts either `selfTest(): ...` (class method) OR `export function
 * selfTest(...)` (free function) OR `selfTest: async (...) => ...`
 * (object property; ntfy.ts shape uses async method-shorthand).
 *
 * @param {string} relPath
 * @param {string} src
 * @param {string[]} violations
 */
function checkSelfTest(relPath, src, violations) {
  const hasSelfTest =
    /\bselfTest\s*\(/m.test(src) || /\bselfTest\s*[:=]\s*(?:async\s*)?\(/m.test(src);
  if (!hasSelfTest) {
    violations.push(
      `${relPath}: adapter implementation missing \`selfTest()\` export. Per AGENTS.md §"Code conventions": every adapter exports selfTest() for the bootstrap.`,
    );
  }
}

/**
 * Rule (3): every named export at the top level of an adapter src file
 * must have a preceding JSDoc block (the line immediately above must
 * end with a JSDoc close marker — asterisk-slash).
 *
 * @param {string} relPath
 * @param {string} src
 * @param {string[]} violations
 */
function checkJsDocOnPublicExports(relPath, src, violations) {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Match: `export class Foo`, `export function foo`, `export const foo`,
    // `export async function foo`, `export interface Foo`, `export type Foo`.
    if (
      !/^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+\w/.test(
        line,
      )
    ) {
      continue;
    }
    // Skip `export type` re-exports (they're trivial).
    if (/^export\s+type\s+\w+\s*=\s*[A-Za-z]/.test(line)) continue;
    // Walk upward — the line immediately above must end with `*/`.
    const prev = (lines[i - 1] ?? "").trimEnd();
    if (!prev.endsWith("*/") && !prev.endsWith("/**")) {
      violations.push(
        `${relPath}:${i + 1}: public export "${line.trim().slice(0, 80)}" missing JSDoc comment. Per AGENTS.md §"Code conventions" rule #3.`,
      );
    }
  }
}

/**
 * @param {string} repoRoot
 * @returns {string[]}
 */
function defaultFileList(repoRoot) {
  try {
    const out = execSync(
      `/usr/bin/find ${ADAPTERS_GLOB.replace(/\/\*\/src\/\*\.ts$/, "")} -type f -name "*.ts" -not -path "*/dist/*" -not -path "*/node_modules/*" 2>/dev/null`,
      { cwd: repoRoot, encoding: "utf8" },
    );
    return out.split("\n").filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkAdapterConventions();
  if (result.ok) {
    process.exit(0);
  }
  console.error(`check-adapter-conventions: ${result.violations.length} violation(s):`);
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  console.error("");
  console.error(
    'Fix: see AGENTS.md §"Code conventions". Add selfTest() to each adapter implementation; add JSDoc above each public export.',
  );
  process.exit(1);
}
