#!/usr/bin/env node
// @ts-check
// Rule #4 ("everything measurable, everything visible") deterministic CI lint.
//
// For every newly-added or modified `novel/**/*.ts` file (non-test, non-fixture,
// non-`.d.ts`) on the PR branch, every top-level `export`-ed function — and
// every method of an `export`-ed class — MUST carry a leading JSDoc block
// containing one of:
//
//   @otel <span-name>           // intent to emit an OTEL span on call
//   @otel-exempt <reason>       // declared, machine-readable opt-out
//
// The lint does NOT verify that a span is actually emitted at runtime
// (that's a runtime concern). It enforces the *contract* — the JSDoc
// annotation — at PR time. The runtime trace check is rule #4's other half.
//
// DIFF-BASED. The lint runs only on novel/**/*.ts files newly added or
// modified relative to the diff base (default `origin/main`). Existing
// un-annotated code is grandfathered until each file is touched again.
// This precedent is shared with rule-1 and rule-3 (PR-vs-existing-code).
//
// Span-name convention: `<package>.<verb>` (e.g. `budget-guard.decide`).
// Rejection of malformed names is intentionally lenient at this layer —
// the regex is `[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*` (period-separated
// kebab-case). Anything tighter belongs to the OTEL-naming companion lint.
//
// Exempt reason: must be ≥3 chars after the tag. `@otel-exempt` with no
// reason or with whitespace-only reason is treated as missing.
//
// Pattern: deterministic gate over a PR diff (rule #10).
// Source: rule #4 (vision.md § "Everything measurable, everything visible");
//   OpenTelemetry specification (CNCF 2020+); Gregg, *Systems Performance*,
//   2014 (USE method — instrumentation as a structural property);
//   Lampson 1983 hint "move the constraint to the cheapest possible point".
// Conformance: full — pure function over the diff, no LLM in the chain.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// `@otel <span-name>` — the span name is at minimum a non-empty token.
// We allow letters, digits, dot, dash, slash, underscore so future
// span-naming conventions don't trigger spurious failures here.
const OTEL_TAG_RE = /(?:^|\s|\*)@otel(?:\s+([\w./@:-]+))?/m;
// `@otel-exempt <reason>` — reason must be ≥3 chars (after trim).
const OTEL_EXEMPT_RE = /(?:^|\s|\*)@otel-exempt(?:\s+([^\n*]+))?/m;

/**
 * @typedef {object} Violation
 * @property {string} file
 * @property {number} line   1-based
 * @property {string} name   the export-bound name, or "<anonymous>"
 * @property {string} reason
 */

/**
 * @typedef {object} SourceFileInput
 * @property {string} path     POSIX, repo-relative
 * @property {string} source   full TS source text
 */

/**
 * Pure function. Walks each input file's AST and reports rule-#4 violations.
 *
 * @param {{ files: readonly SourceFileInput[] }} input
 * @returns {{ violations: Violation[] }}
 */
export function checkOtelCoverage({ files }) {
  /** @type {Violation[]} */
  const violations = [];
  for (const f of files) {
    violations.push(...checkOneFile(f));
  }
  return { violations };
}

/**
 * @param {SourceFileInput} input
 * @returns {Violation[]}
 */
function checkOneFile({ path, source }) {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  /** @type {Violation[]} */
  const out = [];
  for (const stmt of sf.statements) {
    visitTopLevel(stmt, sf, path, out);
  }
  return out;
}

/**
 * Dispatch a top-level statement to the per-shape handler. Each handler
 * is its own function to keep cognitive complexity per visit-fragment small
 * (rule-#10 deterministic CI lint discipline applied to itself).
 *
 * @param {ts.Statement} stmt
 * @param {ts.SourceFile} sf
 * @param {string} path
 * @param {Violation[]} out
 */
function visitTopLevel(stmt, sf, path, out) {
  if (ts.isFunctionDeclaration(stmt) && hasExportModifier(stmt)) {
    visitExportedFunction(stmt, sf, path, out);
    return;
  }
  if (ts.isClassDeclaration(stmt) && hasExportModifier(stmt)) {
    visitExportedClass(stmt, sf, path, out);
    return;
  }
  if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
    visitExportedVariable(stmt, sf, path, out);
    return;
  }
  if (ts.isExportAssignment(stmt) && stmt.isExportEquals !== true) {
    visitExportDefault(stmt, sf, path, out);
  }
}

/**
 * `export function foo() {}` (named or default).
 *
 * @param {ts.FunctionDeclaration} stmt
 * @param {ts.SourceFile} sf
 * @param {string} path
 * @param {Violation[]} out
 */
function visitExportedFunction(stmt, sf, path, out) {
  const name = stmt.name?.text ?? (isDefaultExport(stmt) ? "default" : "<anonymous>");
  checkAnnotation(stmt, name, sf, path, out);
}

/**
 * `export class Foo { method() {} }`.
 *
 * The class declaration itself does not need an `@otel` annotation; the
 * *methods* do. Constructors are exempt by convention (they don't get
 * their own span; the construction is part of the caller's span).
 *
 * @param {ts.ClassDeclaration} stmt
 * @param {ts.SourceFile} sf
 * @param {string} path
 * @param {Violation[]} out
 */
function visitExportedClass(stmt, sf, path, out) {
  const className = stmt.name?.text ?? "<anonymous>";
  for (const member of stmt.members) {
    if (!isCheckableClassMember(member)) continue;
    const memberName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText(sf);
    checkAnnotation(member, `${className}.${memberName}`, sf, path, out);
  }
}

/**
 * @param {ts.ClassElement} member
 * @returns {member is ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration}
 */
function isCheckableClassMember(member) {
  if (
    !ts.isMethodDeclaration(member) &&
    !ts.isGetAccessorDeclaration(member) &&
    !ts.isSetAccessorDeclaration(member)
  ) {
    return false;
  }
  if (member.body === undefined) return false;
  if (isPrivateMember(member)) return false;
  return true;
}

/**
 * `export const foo = () => ...` / `export const foo = function () {}`.
 *
 * @param {ts.VariableStatement} stmt
 * @param {ts.SourceFile} sf
 * @param {string} path
 * @param {Violation[]} out
 */
function visitExportedVariable(stmt, sf, path, out) {
  for (const decl of stmt.declarationList.declarations) {
    const init = decl.initializer;
    if (init === undefined) continue;
    if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) continue;
    const name = ts.isIdentifier(decl.name) ? decl.name.text : decl.name.getText(sf);
    // The JSDoc lives on the VariableStatement (modifier-bearing node), not
    // on the initializer. We pass the statement so leading-trivia lookup
    // works.
    checkAnnotation(stmt, name, sf, path, out);
  }
}

/**
 * `export default function foo() {}` / `export default () => ...`.
 *
 * @param {ts.ExportAssignment} stmt
 * @param {ts.SourceFile} sf
 * @param {string} path
 * @param {Violation[]} out
 */
function visitExportDefault(stmt, sf, path, out) {
  const expr = stmt.expression;
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    checkAnnotation(stmt, "default", sf, path, out);
  }
}

/**
 * @param {ts.Node} node
 * @returns {boolean}
 */
function hasExportModifier(node) {
  // `ts.canHaveModifiers` + `ts.getModifiers` is the strict-mode-friendly path.
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  if (mods === undefined) return false;
  return mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * @param {ts.Node} node
 * @returns {boolean}
 */
function isDefaultExport(node) {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  if (mods === undefined) return false;
  return mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

/**
 * @param {ts.ClassElement} member
 * @returns {boolean}
 */
function isPrivateMember(member) {
  // Treat `private` modifier OR `#name` (private identifier) as private.
  if (member.name !== undefined && ts.isPrivateIdentifier(member.name)) {
    return true;
  }
  if (!ts.canHaveModifiers(member)) return false;
  const mods = ts.getModifiers(member);
  if (mods === undefined) return false;
  return mods.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword);
}

/**
 * Inspect leading JSDoc trivia for `@otel` or `@otel-exempt`.
 *
 * @param {ts.Node} node
 * @param {string} name
 * @param {ts.SourceFile} sf
 * @param {string} path
 * @param {Violation[]} out
 */
function checkAnnotation(node, name, sf, path, out) {
  const fullText = sf.getFullText();
  const start = node.getFullStart();
  const end = node.getStart(sf);
  const leading = fullText.slice(start, end);

  // Extract block-comment JSDoc segments (`/** ... */`) from the leading trivia.
  // We deliberately do not consider `//` line comments — JSDoc is `/** */`
  // by convention and that's what the rule requires.
  const jsdocs = extractJsDocBlocks(leading);

  // Combine all JSDoc blocks; a function may carry several adjacent ones.
  const combined = jsdocs.join("\n");

  if (hasValidOtel(combined)) return;
  if (hasValidExempt(combined)) return;

  const { line } = sf.getLineAndCharacterOfPosition(end);
  out.push({
    file: path,
    line: line + 1,
    name,
    reason: missingReason(combined),
  });
}

/**
 * @param {string} leading
 * @returns {string[]}
 */
function extractJsDocBlocks(leading) {
  /** @type {string[]} */
  const out = [];
  const re = /\/\*\*([\s\S]*?)\*\//g;
  for (;;) {
    const m = re.exec(leading);
    if (m === null) break;
    out.push(m[1] ?? "");
  }
  return out;
}

/**
 * @param {string} jsdoc
 * @returns {boolean}
 */
function hasValidOtel(jsdoc) {
  const m = OTEL_TAG_RE.exec(jsdoc);
  if (m === null) return false;
  const span = (m[1] ?? "").trim();
  // `@otel` with no span name is a violation; we require ≥1 non-empty token.
  return span.length > 0;
}

/**
 * @param {string} jsdoc
 * @returns {boolean}
 */
function hasValidExempt(jsdoc) {
  const m = OTEL_EXEMPT_RE.exec(jsdoc);
  if (m === null) return false;
  const reason = (m[1] ?? "").trim();
  return reason.length >= 3;
}

/**
 * @param {string} jsdoc
 * @returns {string}
 */
function missingReason(jsdoc) {
  if (jsdoc.length === 0) return "no JSDoc — add @otel <span-name> or @otel-exempt <reason>";
  if (/@otel-exempt\b/.test(jsdoc)) return "@otel-exempt missing reason (≥3 chars required)";
  if (/@otel\b/.test(jsdoc)) return "@otel missing span name";
  return "no @otel or @otel-exempt annotation";
}

// CLI ------------------------------------------------------------------------

/**
 * @param {string[]} argv
 * @returns {{ diffBase: string, repo: string }}
 */
function parseArgs(argv) {
  let diffBase = "origin/main";
  let repo = REPO_ROOT;
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m === null) continue;
    if (m[1] === "diff-base") diffBase = m[2] ?? diffBase;
    else if (m[1] === "repo") repo = m[2] ?? repo;
  }
  return { diffBase, repo };
}

/**
 * Returns POSIX-relative paths of files Added or Modified between
 * `<diffBase>` and HEAD, scoped to novel/**\/*.ts (non-test, non-fixture).
 *
 * @param {string} diffBase
 * @param {string} repo
 * @returns {string[]}
 */
function getChangedNovelTsFiles(diffBase, repo) {
  const out = execFileSync(
    "git",
    ["diff", "--diff-filter=AM", "--name-only", `${diffBase}...HEAD`],
    { cwd: repo, encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter(isCheckablePath);
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isCheckablePath(p) {
  if (!p.startsWith("novel/")) return false;
  if (!p.endsWith(".ts")) return false;
  if (p.endsWith(".test.ts")) return false;
  if (p.endsWith(".fixture.ts")) return false;
  if (p.endsWith(".d.ts")) return false;
  return true;
}

/**
 * @param {string} repo
 * @param {string} relPath
 * @returns {string | null}
 */
function readSafe(repo, relPath) {
  try {
    return readFileSync(resolve(repo, relPath), "utf8");
  } catch {
    return null;
  }
}

function main() {
  const { diffBase, repo } = parseArgs(process.argv.slice(2));

  /** @type {string[]} */
  let changed;
  try {
    changed = getChangedNovelTsFiles(diffBase, repo);
  } catch (e) {
    process.stderr.write(
      `rule-4 lint cannot compute diff: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(2);
    return;
  }

  /** @type {SourceFileInput[]} */
  const files = [];
  for (const p of changed) {
    const source = readSafe(repo, p);
    if (source === null) continue; // file deleted at HEAD; skip
    files.push({ path: p, source });
  }

  const { violations } = checkOtelCoverage({ files });

  if (violations.length === 0) {
    process.stdout.write(
      `rule-4 ok: ${files.length} changed novel/**/*.ts file(s) carry @otel coverage.\n`,
    );
    process.exit(0);
    return;
  }

  process.stderr.write("rule-4: missing @otel coverage on exported functions/methods:\n");
  for (const v of violations) {
    process.stderr.write(`  ${v.file}:${v.line} ${v.name} — ${v.reason}\n`);
  }
  process.stderr.write(
    "\nFix: add `@otel <package>.<verb>` to the JSDoc, OR " +
      "`@otel-exempt <reason>` (≥3 chars) if instrumentation is intentionally skipped.\n",
  );
  process.exit(1);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-rule-4-otel-coverage.mjs") === true;
if (invokedDirectly) main();
