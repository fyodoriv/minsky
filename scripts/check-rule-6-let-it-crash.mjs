#!/usr/bin/env node
// Pattern: deterministic gate over a PR diff (rule #10) — TS-AST visitor.
// Source: rule #6 (let-it-crash discipline); Armstrong, *Programming Erlang*,
//   2007 ("let it crash"); Lampson 1983 hint "use exceptions only for
//   exceptional conditions"; Hunt & Thomas 1999 Tip 32 "crash early".
// Conformance: full — pure function over a diff slice, no LLM in the chain.
//
// Why this gate exists: rule #6 says long try/catch chains are a smell and
// every catch should either re-throw or hand the failure to a supervisor.
// Prose alone can't gate merges; this script converts the discipline into a
// CI failure on two narrow shapes:
//   1. `try` blocks nested inside another `try` (depth > 1) — `nested-try`.
//   2. `catch` clauses whose body has neither a `throw` nor a call to the
//      registered supervisor helper `supervise(...)` — `swallowing-catch`.
//
// Per-catch opt-out: a single-line comment immediately above the `catch`
// keyword of the form
//
//     // rule-6: handled-locally — <reason ≥ 3 chars>
//
// silences the swallowing-catch check for that catch only. The reason is
// required (rule #9: pre-registered justification), and the em-dash form
// is mandatory — a hyphen is not accepted.
//
// Diff-based: the CLI only reads files newly added or modified vs.
// `origin/main` under `novel/**/*.ts` (excluding `*.test.ts` /
// `*.fixture.ts`). Existing try/catch chains are grandfathered until the
// file is modified again — same precedent as rule-1 and rule-3.
//
// Pivot (rule #9): if this lint flags ≥3 false positives per month from
// genuine system-boundary catches (e.g., process-edge stdin parsing),
// broaden the opt-out to whole-file via `// rule-6-file: boundary-handler`
// AND add an explicit "boundary catalogue" in research.md.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

/**
 * @typedef {object} SourceFileInput
 * @property {string} path — repo-relative POSIX path
 * @property {string} source — full file contents at HEAD
 */

/**
 * @typedef {object} Violation
 * @property {string} file
 * @property {number} line — 1-indexed
 * @property {"nested-try" | "swallowing-catch"} kind
 * @property {string} message
 */

/**
 * @typedef {object} CheckInput
 * @property {readonly SourceFileInput[]} files
 */

/**
 * @typedef {object} CheckResult
 * @property {readonly Violation[]} violations
 */

const OPT_OUT_RE = /^\s*\/\/\s*rule-6:\s*handled-locally\s*—\s*(\S.{2,})$/;
const SUPERVISOR_NAME = "supervise";

/**
 * Pure function. Walks every file's TS AST and emits violations.
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkLetItCrash({ files }) {
  /** @type {Violation[]} */
  const violations = [];
  for (const f of files) {
    const sf = ts.createSourceFile(
      f.path,
      f.source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(f.path),
    );
    visit(sf, f, sf, 0, violations);
  }
  return { violations };
}

/**
 * @param {string} p
 * @returns {ts.ScriptKind}
 */
function scriptKindFor(p) {
  if (p.endsWith(".tsx")) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

/**
 * @param {ts.Node} node
 * @param {SourceFileInput} file
 * @param {ts.SourceFile} sf
 * @param {number} tryDepth
 * @param {Violation[]} out
 */
function visit(node, file, sf, tryDepth, out) {
  let nextDepth = tryDepth;
  if (ts.isTryStatement(node)) {
    nextDepth = tryDepth + 1;
    if (nextDepth > 1) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      out.push({
        file: file.path,
        line,
        kind: "nested-try",
        message: `try/catch nested deeper than 1 level (depth=${nextDepth}); flatten the inner try or extract it into a function.`,
      });
    }
    if (node.catchClause !== undefined) {
      checkCatchClause(node.catchClause, file, sf, out);
    }
  }
  ts.forEachChild(node, (child) => visit(child, file, sf, nextDepth, out));
}

/**
 * @param {ts.CatchClause} cc
 * @param {SourceFileInput} file
 * @param {ts.SourceFile} sf
 * @param {Violation[]} out
 */
function checkCatchClause(cc, file, sf, out) {
  if (catchHasOptOut(cc, sf, file.source)) return;
  if (catchReThrowsOrSupervises(cc.block)) return;

  const line = sf.getLineAndCharacterOfPosition(cc.getStart(sf)).line + 1;
  out.push({
    file: file.path,
    line,
    kind: "swallowing-catch",
    message:
      "catch block neither re-throws nor calls supervise(...); add `throw`, call supervise(err), or annotate with `// rule-6: handled-locally — <reason>` directly above the catch.",
  });
}

/**
 * Look at the line immediately preceding the `catch` keyword; if it is a
 * line-comment of the opt-out shape with a non-empty reason, return true.
 *
 * @param {ts.CatchClause} cc
 * @param {ts.SourceFile} sf
 * @param {string} source
 * @returns {boolean}
 */
function catchHasOptOut(cc, sf, source) {
  // Find the `catch` keyword position — `cc.getStart(sf)` returns the start
  // of the clause, which (per the TS AST) is the `catch` keyword itself.
  const catchPos = cc.getStart(sf);
  const { line: catchLine } = sf.getLineAndCharacterOfPosition(catchPos);
  if (catchLine === 0) return false;
  const prevLineStart = sf.getPositionOfLineAndCharacter(catchLine - 1, 0);
  const prevLineEnd = sf.getPositionOfLineAndCharacter(catchLine, 0);
  const prevLine = source.slice(prevLineStart, prevLineEnd).replace(/\r?\n$/, "");
  return OPT_OUT_RE.test(prevLine);
}

/**
 * Walk the catch body; return true iff some statement is a `throw` OR
 * contains a call expression whose callee is the bare identifier
 * `supervise`.
 *
 * Returns `return`-statements as also acceptable? — NO. A catch that
 * `return`s instead of `throw`-ing is exactly the swallowing shape we want
 * to flag (case (i) in the test plan).
 *
 * @param {ts.Block} block
 * @returns {boolean}
 */
function catchReThrowsOrSupervises(block) {
  let found = false;
  /** @param {ts.Node} n */
  function walk(n) {
    if (found) return;
    if (ts.isThrowStatement(n)) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === SUPERVISOR_NAME
    ) {
      found = true;
      return;
    }
    // Don't descend into nested function bodies — a `throw` inside a
    // closure declared in the catch is not a re-throw of the caught
    // error. The inner closure may never execute on the catch path.
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n)
    ) {
      return;
    }
    ts.forEachChild(n, walk);
  }
  walk(block);
  return found;
}

// CLI ------------------------------------------------------------------------

/**
 * @param {string} p
 * @returns {boolean}
 */
function isLintableNovelTs(p) {
  if (!p.startsWith("novel/")) return false;
  if (!p.endsWith(".ts") && !p.endsWith(".tsx")) return false;
  if (p.endsWith(".test.ts") || p.endsWith(".test.tsx")) return false;
  if (p.endsWith(".fixture.ts") || p.endsWith(".fixture.tsx")) return false;
  if (p.endsWith(".d.ts")) return false;
  return true;
}

/**
 * @param {string} base
 * @param {string} repo
 * @returns {string[]}
 */
function getDiffPaths(base, repo) {
  // `--diff-filter=AM`: added or modified. Renames count as M for our
  // purposes — we still need to inspect the new content.
  const out = execFileSync("git", ["diff", "--diff-filter=AMR", "--name-only", `${base}...HEAD`], {
    cwd: repo,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * @param {string} repo
 * @param {string} relPath
 * @returns {string | null}
 */
function readSafe(repo, relPath) {
  try {
    return readFileSync(path.join(repo, relPath), "utf8");
  } catch {
    return null;
  }
}

/**
 * @param {readonly string[]} argv
 * @returns {{ diffBase: string, repo: string }}
 */
function parseArgs(argv) {
  const out = { diffBase: process.env["RULE_6_DIFF_BASE"] ?? "origin/main", repo: process.cwd() };
  for (const arg of argv) {
    const parsed = parseOneArg(arg);
    if (parsed === null) continue;
    if (parsed.key === "diff-base") out.diffBase = parsed.value;
    else if (parsed.key === "repo") out.repo = parsed.value;
  }
  return out;
}

/**
 * @param {string} arg
 * @returns {{ key: string, value: string } | null}
 */
function parseOneArg(arg) {
  const m = /^--([^=]+)=(.*)$/.exec(arg);
  if (m === null) return null;
  const key = m[1];
  const value = m[2];
  if (key === undefined || value === undefined) return null;
  return { key, value };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  /** @type {string[]} */
  let diffPaths;
  try {
    diffPaths = getDiffPaths(args.diffBase, args.repo);
  } catch (e) {
    process.stderr.write(
      `rule-6 lint cannot compute diff vs. ${args.diffBase}: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(2);
    return;
  }
  const candidates = diffPaths.filter(isLintableNovelTs);
  /** @type {SourceFileInput[]} */
  const files = [];
  for (const p of candidates) {
    const src = readSafe(args.repo, p);
    if (src === null) continue; // file deleted at HEAD; skip
    files.push({ path: p, source: src });
  }

  const { violations } = checkLetItCrash({ files });
  if (violations.length === 0) {
    process.stdout.write(
      `rule-6 ok: ${files.length} novel/**/*.ts file(s) inspected; no let-it-crash violations.\n`,
    );
    return;
  }
  for (const v of violations) {
    process.stderr.write(`${v.file}:${v.line}: ${v.kind} — ${v.message}\n`);
  }
  process.stderr.write(
    [
      "",
      "Fix options:",
      "  - flatten nested try/catch into a single level (extract a helper);",
      "  - re-throw the caught error: `catch (e) { throw e; }`;",
      "  - hand the error to the supervisor: `catch (e) { supervise(e); }`;",
      "  - opt out for one catch with `// rule-6: handled-locally — <reason ≥3 chars>`",
      "    on the line immediately above the `catch` keyword.",
      "",
      'Anchor: rule #6 + rule #10 in vision.md; AGENTS.md § "Orchestrator discipline".',
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-rule-6-let-it-crash.mjs");
if (invokedDirectly) main();
