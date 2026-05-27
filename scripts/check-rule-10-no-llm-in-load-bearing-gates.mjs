#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved det-* cohort task per det-no-llm-sdk-in-ci-gate-scripts-meta-lint (PR #911) -->
//
// check-rule-10-no-llm-in-load-bearing-gates — self-referential meta-lint.
//
// Per `det-no-llm-sdk-in-ci-gate-scripts-meta-lint`: vision rule #10 says
// "LLM-driven checks are advisory only, never load-bearing". But the rule
// is self-referential — no script currently asserts that the 55+
// `scripts/check-*.mjs` files don't themselves import LLM SDKs and become
// accidentally load-bearing LLM gates.
//
// This script:
//   1. Reads `STACK_MANIFEST` from `scripts/run-pre-pr-lint-stack.mjs` to
//      identify which check scripts are LOAD-BEARING (wired into the
//      pre-pr-lint stack — fire on every PR + push).
//   2. For each load-bearing check, scans the source for forbidden
//      imports / fetches / spawns of LLM SDKs.
//   3. Fails with file:line on any match.
//
// Pattern: pure manifest + I/O seam (rule #2). The forbidden-pattern list
// is a const; the FS reader is injected via opts. Conformance: full.
//
// Sources:
//   - vision.md rule #10 (deterministic enforcement, no LLM in chain)
//   - vision.md rule #1 (don't reinvent — adopted llm-audit's Semgrep
//     pattern of import + fetch detection)
//   - Javierlozo/llm-audit (TypeScript Semgrep scanner; we hand-rolled
//     the equivalent for our small set of files because llm-audit's
//     dependency surface is heavier than we need)
//   - subagent 4189731d 2026-05-27 research

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { STACK_MANIFEST } from "./run-pre-pr-lint-stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Forbidden import patterns. Each is a substring of the `from "..."`
 * specifier or the full module name in `require("...")`.
 *
 * @type {readonly string[]}
 */
export const FORBIDDEN_IMPORTS = Object.freeze([
  "@anthropic-ai/sdk",
  "@anthropic-ai/bedrock-sdk",
  "@anthropic-ai/vertex-sdk",
  "openai",
  "@openai/api",
  "@google/generative-ai",
  "@google-cloud/aiplatform",
  "cohere-ai",
  "@cohere/cohere",
  "@mistralai/mistralai",
  "@ai-sdk/anthropic",
  "@ai-sdk/openai",
  "@ai-sdk/google",
  "ollama",
  "@ollama/ollama",
  "langchain",
  "@langchain/core",
  "llamaindex",
]);

/**
 * Forbidden fetch URL patterns. Each is a regex matched against the
 * source. If any matches, the check exits with a violation.
 *
 * @type {readonly RegExp[]}
 */
export const FORBIDDEN_FETCH_URLS = Object.freeze([
  /\bapi\.anthropic\.com\b/,
  /\bapi\.openai\.com\b/,
  /\bgenerativelanguage\.googleapis\.com\b/,
  /\bapi\.cohere\.(?:com|ai)\b/,
  /\bapi\.mistral\.ai\b/,
  /\blocalhost:11434\b/, // ollama default port — load-bearing gates shouldn't talk to it
  /\b127\.0\.0\.1:11434\b/,
]);

/**
 * Forbidden bash exec patterns — spawning a process that itself calls an
 * LLM. Detected ONLY when the LLM CLI appears INSIDE a shell-invocation
 * context (spawn / execSync / exec / template literal preceded by a shell
 * verb). Plain mentions in comments or string-literal lists (e.g. the
 * cloud-agent matrix lint listing "openhands" as a row label) are NOT
 * violations — those are deliberate references to the tool's identity,
 * not invocations.
 *
 * Pattern: anchor on shell-invocation syntax (`spawn("`, `execSync("`,
 * `exec("`, `` ` `` immediately followed by the CLI name). Avoid the
 * false-positive class the initial design hit (substring match against
 * "openhands" in any comment).
 *
 * @type {readonly RegExp[]}
 */
export const FORBIDDEN_BASH_EXECS = Object.freeze([
  // `spawn("claude --print` / `execSync("claude --print` etc.
  /\b(?:spawn|exec|execSync|execFile|execFileSync|spawnSync)\s*\(\s*["'`]\s*claude\s+(?:--print|-p)\b/,
  /\b(?:spawn|exec|execSync|execFile|execFileSync|spawnSync)\s*\(\s*["'`]\s*aider\s+/,
  /\b(?:spawn|exec|execSync|execFile|execFileSync|spawnSync)\s*\(\s*["'`]\s*gemini\s+--prompt\b/,
]);

/**
 * Allowlist of files that legitimately import an LLM SDK but are NOT
 * load-bearing gates (e.g. benchmark scripts, one-off audit tools).
 *
 * @type {readonly string[]}
 */
export const ALLOWLIST = Object.freeze([
  // Benchmarks + audit scripts that legitimately call LLMs but are NOT
  // in STACK_MANIFEST. These run on demand, not as gates.
  "scripts/benchmark-run.mjs",
  "scripts/baseline_metrics.py",
  "scripts/llm-provider-throughput.mjs",
  // The meta-lint itself contains the forbidden-pattern regex SOURCES as
  // string literals — they trigger the lint's own scanner. Self-reference
  // is OK because this file BY DEFINITION cannot turn rule #10 into an
  // LLM gate (it never imports or fetches anything).
  "scripts/check-rule-10-no-llm-in-load-bearing-gates.mjs",
]);

/**
 * @typedef {object} CheckOpts
 * @property {string} [repoRoot]
 * @property {readonly { name: string, args: readonly string[] }[]} [manifest]
 * @property {(p: string) => boolean} [fileExists]
 * @property {(p: string) => string} [readText]
 */

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {number} loadBearingCount
 */

/**
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkRule10NoLlmInLoadBearingGates(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const manifest = opts.manifest ?? STACK_MANIFEST;
  const fileExists = opts.fileExists ?? defaultFileExists;
  const readText = opts.readText ?? defaultReadText;

  const loadBearingScripts = extractCheckScriptPaths(manifest);
  /** @type {string[]} */
  const violations = [];

  for (const relPath of loadBearingScripts) {
    if (ALLOWLIST.includes(relPath)) continue;
    const full = `${repoRoot}/${relPath}`;
    if (!fileExists(full)) {
      // The script doesn't exist yet — preparation PR shape. Skip;
      // when the script lands, the gate fires.
      continue;
    }
    const src = readText(full);
    const found = scanForViolations(relPath, src);
    violations.push(...found);
  }

  return {
    ok: violations.length === 0,
    violations,
    loadBearingCount: loadBearingScripts.length,
  };
}

/**
 * Walk a manifest entry's args looking for `scripts/check-*.mjs` paths.
 * Heuristic but tight: only entries whose `cmd` is `node` AND whose args
 * include a `scripts/check-*.mjs` qualify as load-bearing checks.
 *
 * @param {readonly { name: string, args: readonly string[], cmd?: string }[]} manifest
 * @returns {string[]}
 */
function extractCheckScriptPaths(manifest) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const entry of manifest) {
    if (entry.cmd !== "node") continue;
    for (const a of entry.args) {
      if (typeof a === "string" && a.startsWith("scripts/") && a.endsWith(".mjs")) {
        out.add(a);
      }
    }
  }
  return Array.from(out);
}

/**
 * Scan a script's source for any forbidden import, fetch URL, or bash
 * exec. Returns a list of file:line violations.
 *
 * @param {string} relPath
 * @param {string} src
 * @returns {string[]}
 */
function scanForViolations(relPath, src) {
  /** @type {string[]} */
  const out = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i] ?? "";
    out.push(...scanLineForViolations(relPath, lineNum, line));
  }
  return out;
}

/**
 * Three-class scanner over a single line.
 *
 * @param {string} relPath
 * @param {number} lineNum
 * @param {string} line
 * @returns {string[]}
 */
function scanLineForViolations(relPath, lineNum, line) {
  /** @type {string[]} */
  const out = [];
  for (const forbidden of FORBIDDEN_IMPORTS) {
    if (lineImportsForbiddenModule(line, forbidden)) {
      out.push(
        `${relPath}:${lineNum}: forbidden import of LLM SDK "${forbidden}" in load-bearing gate (vision rule #10)`,
      );
    }
  }
  for (const re of FORBIDDEN_FETCH_URLS) {
    const m = re.exec(line);
    if (m !== null) {
      out.push(
        `${relPath}:${lineNum}: forbidden LLM-API URL "${m[0]}" in load-bearing gate (vision rule #10)`,
      );
    }
  }
  for (const re of FORBIDDEN_BASH_EXECS) {
    const m = re.exec(line);
    if (m !== null) {
      out.push(
        `${relPath}:${lineNum}: forbidden LLM-CLI exec "${m[0]}" in load-bearing gate (vision rule #10)`,
      );
    }
  }
  return out;
}

/**
 * Match exact module OR `<forbidden>/<subpath>` via from/require/import().
 *
 * @param {string} line
 * @param {string} forbidden
 * @returns {boolean}
 */
function lineImportsForbiddenModule(line, forbidden) {
  const trailing = `["']|\\/`;
  const esc = escapeRegex(forbidden);
  const patterns = [
    new RegExp(`from\\s+["']${esc}(?:${trailing})`),
    new RegExp(`require\\s*\\(\\s*["']${esc}(?:${trailing})`),
    new RegExp(`import\\s*\\(\\s*["']${esc}(?:${trailing})`),
  ];
  return patterns.some((re) => re.test(line));
}

/**
 * Escape a string so it can be embedded in a regex literal.
 *
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function defaultFileExists(path) {
  return existsSync(path);
}

/**
 * @param {string} path
 * @returns {string}
 */
function defaultReadText(path) {
  return readFileSync(path, "utf8");
}

// ----------------------------------------------------------------- CLI -----

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkRule10NoLlmInLoadBearingGates();
  if (result.ok) {
    console.log(
      `check-rule-10-no-llm-in-load-bearing-gates: ok (scanned ${result.loadBearingCount} load-bearing script(s))`,
    );
    process.exit(0);
  }
  console.error("check-rule-10-no-llm-in-load-bearing-gates: violations found:");
  for (const v of result.violations) {
    console.error(`  ${v}`);
  }
  console.error("");
  console.error("Vision rule #10: LLM-driven checks are advisory only, never load-bearing.");
  console.error("Fix options:");
  console.error("  (a) move the LLM-using logic to an advisory script OUTSIDE STACK_MANIFEST;");
  console.error(
    "  (b) replace the LLM call with a deterministic regex / AST walker (the canonical pattern);",
  );
  console.error(
    "  (c) if the script is legitimately a benchmark, not a gate, add it to ALLOWLIST in this file with a comment explaining why.",
  );
  process.exit(1);
}
