#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved security-privacy-priority-substrate -->
//
// Rule #13 item 2 enforcement: OTEL span attribute keys must not carry
// PII-shaped names. Scans `novel/**/*.ts` (excluding test files and dist/)
// for two patterns:
//
//   1. `attributes: { ... }` object literals — checks all literal keys.
//   2. `record({ ... })` call sites — catches the fixture / direct-call shape.
//
// Key classification is name-based (static analysis). Value-based PII
// detection (runtime) is out of scope for this lint.
//
// Opt-out: place `// @otel-pii-allowed: <reason>` on the flagged line or
// the immediately preceding line. The reason must be non-empty. Each
// allow-list usage should carry a TASKS-id justifying it (rule #9 —
// pre-registered deviation).
//
// Pivot (rule #9): if false-positive rate on legitimate attribute keys ≥
// 3 per month, extend the PII_WORDS list to require word-boundary matching
// rather than substring, or add per-word granularity.
//
// Source: rule #13 (vision.md § 13 — security & privacy — item 2, OTEL
//   data minimisation); GDPR Article 5(1)(c) (data minimisation); OWASP
//   ASVS 7.1.2 (logging must not include sensitive data); Cavoukian 2011
//   "Privacy by Design" (embed privacy at the architecture level, not as
//   a bolt-on); rule #10 (deterministic enforcement — CI gate, not hope).

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * PII attribute key deny-list. Keys are matched after normalization:
 *   camelCase → snake_case, lowercase, dots/dashes → underscores.
 *
 * Substring match — "user_email" and "email_address" both hit "email".
 * Add `@otel-pii-allowed` annotation when a key legitimately contains
 * a deny-list word but carries only non-PII data (e.g., an opaque hash
 * whose attribute name happens to end in "_token").
 */
export const PII_WORDS = Object.freeze([
  "email",
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "access_key",
  "private_key",
  "credential",
  "ssn",
  "phone",
  "credit_card",
  "authorization",
]);

/**
 * Normalize an attribute key for PII matching.
 *   camelCase → snake_case, lowercase, dots/dashes → underscores.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeKey(name) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[.\-]/g, "_");
}

/**
 * @typedef {object} ClassifyResult
 * @property {boolean} ok
 * @property {string} [reason]
 */

/**
 * Pure function. Classifies a span attribute key name as PII-suspect or safe.
 *
 * Only the `name` is used for static analysis. The `value` parameter is
 * reserved for future runtime checks (pass `undefined` from linters).
 *
 * @param {string} name     attribute key (e.g. "user.email", "apiKey")
 * @param {unknown} [_value]  unused; reserved for runtime checks
 * @returns {ClassifyResult}
 */
export function classifySpanAttribute(name, _value) {
  const normalized = normalizeKey(name);
  for (const word of PII_WORDS) {
    if (normalized.includes(word)) {
      return { ok: false, reason: `key '${name}' contains PII pattern '${word}'` };
    }
  }
  return { ok: true };
}

const TS_KEYWORDS = new Set([
  "return",
  "const",
  "let",
  "var",
  "if",
  "else",
  "for",
  "while",
  "do",
  "function",
  "class",
  "import",
  "export",
  "default",
  "new",
  "delete",
  "typeof",
  "instanceof",
  "this",
  "super",
  "null",
  "undefined",
  "true",
  "false",
  "void",
  "async",
  "await",
  "from",
  "of",
  "in",
  "throw",
  "try",
  "catch",
  "finally",
  "switch",
  "case",
  "break",
  "continue",
]);

/**
 * Extract literal string and identifier keys from an object literal body
 * (the text between `{` and `}`). Finds:
 *   - Quoted string keys:   "key":  or  'key':
 *   - Unquoted identifier keys:  key:  (camelCase, snake_case, etc.)
 *
 * TypeScript keywords are excluded from unquoted key extraction.
 *
 * @param {string} text  object body (without the surrounding braces)
 * @returns {string[]}
 */
export function extractLiteralKeys(text) {
  const keys = /** @type {string[]} */ ([]);

  for (const m of text.matchAll(/["']([^"'\n]+)["']\s*:/g)) {
    if (m[1] !== undefined) keys.push(m[1]);
  }

  for (const m of text.matchAll(/(?:^|[{,])\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/gm)) {
    const key = m[1];
    if (key !== undefined && !TS_KEYWORDS.has(key)) {
      keys.push(key);
    }
  }

  return keys;
}

/**
 * @typedef {object} Violation
 * @property {string} file   repo-relative path
 * @property {number} line   1-indexed line number
 * @property {string} key    flagged attribute key
 * @property {string} reason why the key was flagged
 */

/**
 * @typedef {object} SourceFile
 * @property {string} path   repo-relative path
 * @property {string} source full file text
 */

/**
 * @param {string} line
 * @param {string} prevLine
 * @returns {boolean}
 */
function isLineAllowed(line, prevLine) {
  const re = /\/\/\s*@otel-pii-allowed:/i;
  return re.test(line) || re.test(prevLine);
}

/**
 * @param {string} body    object literal text (inside the braces)
 * @param {string} filePath
 * @param {number} lineIdx  0-indexed
 * @returns {Violation[]}
 */
function keysToViolations(body, filePath, lineIdx) {
  const vs = /** @type {Violation[]} */ ([]);
  for (const key of extractLiteralKeys(body)) {
    const r = classifySpanAttribute(key);
    if (!r.ok) {
      vs.push({
        file: filePath,
        line: lineIdx + 1,
        key,
        reason: r.reason ?? "PII-shaped attribute key",
      });
    }
  }
  return vs;
}

/**
 * Check a single line for `record({...})` pattern violations.
 *
 * @param {string} line
 * @param {string} filePath
 * @param {number} lineIdx
 * @returns {Violation[]}
 */
function checkRecordCall(line, filePath, lineIdx) {
  const m = /\brecord\s*\(\s*\{([^}]*)\}/.exec(line);
  if (m === null || m[1] === undefined) return [];
  return keysToViolations(m[1], filePath, lineIdx);
}

/**
 * @typedef {object} AttrBlockState
 * @property {boolean} inAttrBlock
 * @property {number}  braceDepth
 */

/**
 * Update brace-depth state in-place as we traverse `line`.
 * Clears `inAttrBlock` when depth reaches 0.
 *
 * @param {AttrBlockState} state  mutated in place
 * @param {string} line
 */
function updateBraceState(state, line) {
  for (const ch of line) {
    if (ch === "{") {
      state.braceDepth++;
    } else if (ch === "}") {
      state.braceDepth--;
      if (state.braceDepth === 0) {
        state.inAttrBlock = false;
        return;
      }
    }
  }
}

/**
 * Process one source line against the attribute-block state machine.
 * Returns violations found on this line; mutates `state`.
 *
 * @param {AttrBlockState} state  mutated
 * @param {string} line
 * @param {string} filePath
 * @param {number} lineIdx
 * @returns {Violation[]}
 */
function processAttrLine(state, line, filePath, lineIdx) {
  if (!state.inAttrBlock && /\battributes\s*:\s*\{/.test(line)) {
    state.inAttrBlock = true;
    state.braceDepth = 0;
  }
  if (!state.inAttrBlock) return [];
  updateBraceState(state, line);
  return keysToViolations(line, filePath, lineIdx);
}

/**
 * Pure function. Check one source file for PII-shaped span attribute keys.
 *
 * Scans for:
 *   1. `attributes: { ... }` blocks (multi-line aware via brace counting).
 *   2. `record({ ... })` call sites (single-line pattern for direct calls).
 *
 * @param {SourceFile} file
 * @returns {readonly Violation[]}
 */
export function checkFile({ path: filePath, source }) {
  const lines = source.split("\n");
  const violations = /** @type {Violation[]} */ ([]);
  const state = { inAttrBlock: false, braceDepth: 0 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const prevLine = i > 0 ? (lines[i - 1] ?? "") : "";
    const allowed = isLineAllowed(line, prevLine);

    if (!allowed) {
      violations.push(...checkRecordCall(line, filePath, i));
      violations.push(...processAttrLine(state, line, filePath, i));
    } else {
      processAttrLine(state, line, filePath, i); // still update state, discard violations
    }
  }

  return violations;
}

// ---- File collection -------------------------------------------------------

/**
 * @param {string} p  repo-relative path
 * @returns {boolean}
 */
function isLintableNovelTs(p) {
  if (!p.startsWith("novel/")) return false;
  if (!p.endsWith(".ts")) return false;
  if (p.endsWith(".test.ts") || p.endsWith(".fixture.ts") || p.endsWith(".d.ts")) return false;
  if (p.includes("/dist/") || p.includes("/node_modules/")) return false;
  return true;
}

/**
 * Walk `novel/` recursively and return all lintable `.ts` files.
 *
 * @param {string} repoRoot
 * @returns {string[]}  repo-relative paths
 */
function collectAllNovelTs(repoRoot) {
  const result = /** @type {string[]} */ ([]);
  const novelDir = join(repoRoot, "novel");

  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = full.slice(repoRoot.length + 1).replace(/\\/g, "/");
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        walk(full);
      } else if (isLintableNovelTs(rel)) {
        result.push(rel);
      }
    }
  }

  walk(novelDir);
  return result;
}

/**
 * Get changed files (added or modified) vs. `base` using `git diff`.
 *
 * @param {string} base   e.g. "origin/main"
 * @param {string} repoRoot
 * @returns {string[]}  repo-relative paths
 */
function getChangedNovelTs(base, repoRoot) {
  const out = execFileSync("git", ["diff", "--diff-filter=AMR", "--name-only", `${base}...HEAD`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && isLintableNovelTs(s));
}

// ---- CLI -------------------------------------------------------------------

/**
 * @param {readonly string[]} argv
 * @returns {{ diffBase: string | null; repo: string }}
 */
function parseArgs(argv) {
  let diffBase = process.env["OTEL_PII_DIFF_BASE"] ?? null;
  let repo = REPO_ROOT;
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m === null) continue;
    if (m[1] === "diff-base") diffBase = m[2] ?? null;
    else if (m[1] === "repo") repo = m[2] ?? repo;
  }
  return { diffBase, repo };
}

/**
 * Resolve the list of files to lint. Returns null only when an error was
 * already printed and `process.exit` was called.
 *
 * @param {string | null} diffBase
 * @param {string} repo
 * @returns {string[] | null}
 */
function resolveInputPaths(diffBase, repo) {
  if (diffBase === null) return collectAllNovelTs(repo);
  try {
    return getChangedNovelTs(diffBase, repo);
  } catch (e) {
    process.stderr.write(
      `check-rule-otel-no-pii: cannot diff vs ${diffBase}: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(2);
    return null;
  }
}

/**
 * @param {readonly string[]} relPaths
 * @param {string} repo
 * @returns {Violation[]}
 */
function gatherViolations(relPaths, repo) {
  const all = /** @type {Violation[]} */ ([]);
  for (const rel of relPaths) {
    let source;
    try {
      source = readFileSync(join(repo, rel), "utf8");
    } catch {
      continue;
    }
    for (const v of checkFile({ path: rel, source })) {
      all.push(v);
    }
  }
  return all;
}

/**
 * @param {Violation[]} violations
 * @param {readonly string[]} relPaths
 * @param {string | null} diffBase
 */
function reportResults(violations, relPaths, diffBase) {
  if (violations.length === 0) {
    const scope = diffBase !== null ? `diff vs ${diffBase}` : "all novel/**/*.ts";
    process.stdout.write(
      `check-rule-otel-no-pii: 0 PII-shaped span attributes in ${scope} (${relPaths.length} files)\n`,
    );
    process.exit(0);
    return;
  }
  for (const v of violations) {
    process.stderr.write(`FAIL ${v.file}:${v.line}: ${v.reason}\n`);
    process.stderr.write(
      `  → add \`// @otel-pii-allowed: <reason>\` on or before line ${v.line} to suppress\n`,
    );
  }
  process.stderr.write(
    `\ncheck-rule-otel-no-pii: ${violations.length} PII-shaped span attribute(s) found. See docs/security/otel-no-pii.md for guidance.\n`,
  );
  process.exit(1);
}

function main() {
  const { diffBase, repo } = parseArgs(process.argv.slice(2));
  const relPaths = resolveInputPaths(diffBase, repo);
  if (relPaths === null) return;
  const violations = gatherViolations(relPaths, repo);
  reportResults(violations, relPaths, diffBase);
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main();
}
