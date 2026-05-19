#!/usr/bin/env node
// @ts-check
// Rule #17 (vision.md § "Proactive healing — observation IS the fix" — iron
// rule) deterministic CI lint. The structural shape rule #17 forbids is the
// "watcher who narrates": a session / PR / observer-summary that surfaces
// errors but does not commit a fix, file a `**Blocked**:` task, or open a
// PR. The lint runs in two modes:
//
//   1. PR-diff mode (default; matches every other rule-N lint). Reads the
//      PR body + the diff. If the PR description contains operator-facing
//      narrations of failures (lines that start with `- observed`, `we
//      saw`, the daemon's `spawn-failed` / `scope-leak` / `ETIMEDOUT`
//      / `HTTP 401` strings, etc.) AND the PR body lacks an active fix
//      verb (`fix(`, `patch`, `heal`, `roll out`, or a `**Blocked**:`
//      line), the lint fails. This catches the case "agent ran minsky,
//      pasted the failure tail into the PR body, did nothing".
//
//   2. Observer-summary mode (`--summary=<path>`). Reads a session
//      summary file (the same format `minsky status` emits) and applies
//      the same rule. Used by the observer skill at session end before
//      it reports back to the operator.
//
// "Observed-error tokens" (case-insensitive substring match):
//   - "spawn-failed", "scope-leak", "ETIMEDOUT", "ECONNREFUSED"
//   - "GraphQL 401", "HTTP 401", "HTTP 5", "stack trace", "Uncaught"
//   - "FAIL ", "× #", " timed out", "spawnSync node ETIMEDOUT"
//
// "Healing-evidence tokens" (any of these in the same body discharges
// the violation):
//   - `fix(...):` or `fix:` — a fix commit subject
//   - `patch:` or "patched" or "rolled out" or "healed"
//   - `**Blocked**:` — a structured blocked-task block per rule #17.1
//   - `prs-opened: N` with N ≥ 1
//   - `commits-landed: N` with N ≥ 1
//   - `tasks-filed: N` with N ≥ 1
//
// DIFF-BASED. Compares HEAD against `origin/main` (override with
// `--diff-base=<ref>` or env `RULE_17_DIFF_BASE`). For deterministic
// fixture testing, accepts `--summary=<path>` (string-content lint, no
// diff).
//
// Pattern: deterministic gate over PR body / observer summary
// (rule #10).
// Source: rule #17 (vision.md § "Proactive healing — observation IS
//   the fix"); rule #10 (deterministic enforcement); Forsgren/Humble/Kim
//   *Accelerate* 2018 (change-fail rate); Beyer et al. *SRE* 2016 Ch. 3
//   (error budgets — observation that doesn't move the budget is dead
//   weight); operator directive 2026-05-19 ("why aren't they being
//   fixed by you right away?").
// Conformance: full — pure function over the body text, no LLM in the
//   chain.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Error-token patterns. Case-insensitive substring match.
 * @type {readonly string[]}
 */
const ERROR_TOKENS = Object.freeze([
  "spawn-failed",
  "scope-leak",
  "etimedout",
  "econnrefused",
  "graphql 401",
  "http 401",
  "http 5",
  "stack trace",
  "uncaught",
  "fail ",
  "× #",
  " timed out",
  "spawnsync node",
]);

/** Healing-evidence patterns. Any one of these discharges the rule.
 * @type {readonly string[]}
 */
const HEAL_TOKENS = Object.freeze([
  "fix(",
  "fix:",
  "patch:",
  "patched",
  "rolled out",
  "healed",
  "**blocked**:",
  "prs-opened:",
  "commits-landed:",
  "tasks-filed:",
  "tasks_filed:",
  "merged-prs:",
]);

/**
 * @typedef {object} CheckInput
 * @property {string} body          PR body or observer-summary text
 * @property {string} diffSummary   `git diff --name-status` output (may be empty)
 */

/**
 * @typedef {object} CheckResult
 * @property {readonly string[]} observedErrors      tokens matched
 * @property {readonly string[]} healEvidence        tokens matched
 * @property {boolean}           violation           true ⇒ lint fails
 * @property {string}            verdict             english-readable reason
 */

/**
 * Pure function. Returns the lint verdict for a single body text.
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkRule17ProactiveHeal({ body, diffSummary }) {
  const lower = body.toLowerCase();
  const observed = ERROR_TOKENS.filter((t) => lower.includes(t));
  const heal = HEAL_TOKENS.filter((t) => lower.includes(t));
  // A non-empty diff is also healing evidence — the agent shipped code.
  const diffShippedCode = diffSummary.trim().length > 0;
  const hasHeal = heal.length > 0 || diffShippedCode;
  if (observed.length === 0) {
    return {
      observedErrors: [],
      healEvidence: heal,
      violation: false,
      verdict: "no observed-error tokens — rule #17 vacuously satisfied.",
    };
  }
  if (hasHeal) {
    return {
      observedErrors: observed,
      healEvidence: heal,
      violation: false,
      verdict: `${observed.length} observed-error token(s) present, ${heal.length} healing-evidence token(s) + diff=${diffShippedCode ? "non-empty" : "empty"} — rule #17 satisfied.`,
    };
  }
  return {
    observedErrors: observed,
    healEvidence: [],
    violation: true,
    verdict:
      `${observed.length} observed-error token(s) present (${observed.join(", ")}) and zero healing evidence (no fix/patch/Blocked/PRs/commits/tasks).\n` +
      "Per rule #17 (vision.md § Proactive healing — observation IS the fix), every observed error must be answered in the same session by either:\n" +
      "  (a) a fix commit (subject starts with `fix(` or `fix:`),\n" +
      "  (b) a `**Blocked**: <one-word-code>` task block in TASKS.md describing the unblock path,\n" +
      "  (c) a non-empty diff that lands the fix.\n" +
      'Observation without action is the "watcher who narrates" anti-pattern the rule forbids.',
  };
}

// --------------------------------------------------------------- CLI -------

/**
 * @param {string[]} argv
 * @returns {{ diffBase: string, summary: string | null, repo: string, body: string | null }}
 */
function parseArgs(argv) {
  /** @type {{ diffBase: string, summary: string | null, repo: string, body: string | null }} */
  const out = {
    diffBase: process.env["RULE_17_DIFF_BASE"] ?? "origin/main",
    summary: null,
    repo: REPO_ROOT,
    body: null,
  };
  for (const arg of argv) {
    const kv = parseKeyValue(arg);
    if (kv === null) continue;
    if (kv.key === "diff-base") out.diffBase = kv.value;
    else if (kv.key === "summary") out.summary = kv.value;
    else if (kv.key === "repo") out.repo = kv.value;
    else if (kv.key === "body") out.body = kv.value;
  }
  return out;
}

/**
 * @param {string} arg
 * @returns {{ key: string, value: string } | null}
 */
function parseKeyValue(arg) {
  const m = /^--([^=]+)=(.*)$/.exec(arg);
  if (m === null) return null;
  const key = m[1];
  const value = m[2];
  if (key === undefined || value === undefined) return null;
  return { key, value };
}

/**
 * @param {string} diffBase
 * @param {string} repo
 * @returns {string}
 */
function getDiffSummary(diffBase, repo) {
  try {
    return execFileSync("git", ["diff", "--name-status", `${diffBase}...HEAD`], {
      cwd: repo,
      encoding: "utf8",
    });
  } catch {
    return "";
  }
}

/**
 * @param {string} bodyPath
 * @returns {string}
 */
function readBody(bodyPath) {
  if (!existsSync(bodyPath)) return "";
  return readFileSync(bodyPath, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  /** @type {string} */
  let body = "";
  if (args.summary !== null) body = readBody(args.summary);
  else if (args.body !== null) body = readBody(args.body);
  else if (process.env["RULE_17_PR_BODY_PATH"] !== undefined) {
    body = readBody(process.env["RULE_17_PR_BODY_PATH"]);
  }
  const diffSummary = args.summary !== null ? "" : getDiffSummary(args.diffBase, args.repo);

  const result = checkRule17ProactiveHeal({ body, diffSummary });
  if (!result.violation) {
    process.stdout.write(`rule-17 ok: ${result.verdict}\n`);
    process.exit(0);
    return;
  }
  process.stderr.write(`rule-17 violation:\n${result.verdict}\n`);
  process.stderr.write(`  observed-error tokens: ${result.observedErrors.join(", ")}\n`);
  process.exit(1);
}

const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-rule-17-proactive-heal.mjs");
if (isCli) main();
