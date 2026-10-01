#!/usr/bin/env node
// @ts-check
// check-pre-push-hook-fast — rule #10 deterministic lint that the lefthook
// `pre-push` step stays fast (≤~10s wall-clock) so developers never dread
// `git push`.
//
// Asserts `lefthook.yml`'s `pre-push.commands.pre-pr-lint.run` contains the
// substring `--stage=fast`. The full `--stage=full` stack runs vitest
// (~35s for the 3,135-test suite) — putting it back on pre-push re-introduces
// the ~40s-per-push tax the operator hit on 2026-05-20 ("why did pre push take
// so long? I expected push to happen in like a second"). Defense-in-depth:
// `scripts/local-gate-merge.mjs` runs `--stage=full` in a scratch clone before
// any PR merges to main, so nothing that fails full ever reaches main — the
// only cost of ALSO running full on pre-push was friction.
//
// Opt-out (per the task Pivot, NOT the default): set `ALLOW_SLOW_PRE_PUSH=1`
// in the environment. The lint passes with a one-line warning so a future
// operator who deliberately wants a slower pre-push (e.g. the gate-merge is
// unavailable on some platform) can do so — but must opt in explicitly and
// justify in the PR body (`<!-- rule-10: pre-push-slow-justified: <reason> -->`).
//
// Pattern: deterministic gate (rule #10) — pure function over the parsed
//   lefthook.yml; the I/O (file read, env read) lives at the CLI boundary and
//   is replaceable via injection for the paired tests. Conformance: full.
// Source: TASKS.md `pre-push-hook-stays-fast`; vision.md rule #10 (every
//   constitutional rule enforced by a deterministic CI check, not "the agent
//   will remember"); Forsgren, Humble, Kim, *Accelerate*, 2018 (tight feedback
//   loops are the practice most correlated with high-performing teams).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** The substring the pre-push run command must contain. */
export const REQUIRED_STAGE_FLAG = "--stage=fast";

/** The env var that opts out of the fast-pre-push requirement (task Pivot). */
export const OPT_OUT_ENV = "ALLOW_SLOW_PRE_PUSH";

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string | null} error        actionable message when `ok` is false
 * @property {string | null} warning      one-line note when the opt-out is active
 */

/**
 * @typedef {object} CheckOpts
 * @property {string} [yamlText]   raw lefthook.yml contents
 * @property {NodeJS.ProcessEnv} [env]
 */

/**
 * Pure check. Parses the lefthook.yml text and asserts the pre-push pre-pr-lint
 * run command requests the fast stage (unless the opt-out env var is set).
 *
 * @param {CheckOpts} [opts]
 * @returns {CheckResult}
 */
export function checkPrePushHookFast(opts = {}) {
  const env = opts.env ?? process.env;
  const yamlText = opts.yamlText ?? readFileSync(resolve(REPO_ROOT, "lefthook.yml"), "utf8");

  if (isOptedOut(env)) {
    return {
      ok: true,
      error: null,
      warning: `${OPT_OUT_ENV}=1 set — pre-push fast-stage requirement bypassed. Justify in the PR body with \`<!-- rule-10: pre-push-slow-justified: <reason> -->\` (see TASKS.md pre-push-hook-stays-fast).`,
    };
  }

  const run = extractPrePushRun(yamlText);
  if (run === null) {
    return {
      ok: false,
      error:
        "pre-push must use --stage=fast (current: <missing pre-push.commands.pre-pr-lint.run>); see TASKS.md pre-push-hook-stays-fast",
      warning: null,
    };
  }

  if (run.includes(REQUIRED_STAGE_FLAG)) {
    return { ok: true, error: null, warning: null };
  }

  return {
    ok: false,
    error: `pre-push must use --stage=fast (current: ${describeStage(run)}); see TASKS.md pre-push-hook-stays-fast`,
    warning: null,
  };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function isOptedOut(env) {
  const v = env[OPT_OUT_ENV];
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

/**
 * Pull `pre-push.commands.pre-pr-lint.run` out of the lefthook.yml text.
 * Returns the run string, or `null` when the block is absent or nested under
 * the wrong key (e.g. a `pre-commit` step rather than `pre-push`).
 *
 * Indentation-aware line scan rather than a full YAML parse: lefthook.yml's
 * shape (top-level hook key → `commands:` → `<name>:` → `run:`) is small,
 * fixed, and owned by this repo, so a 4-level nesting walk over `<indent>key:`
 * lines is sufficient and avoids pulling a YAML-parser dependency into a
 * load-bearing CI gate (rule #10 — fewer moving parts in the gate). The walk
 * tracks the indentation of each ancestor key and only descends into a child
 * whose indent is strictly greater than its parent's, so a `pre-pr-lint:` key
 * sitting under `pre-commit:` (the wrong-hook case) never resolves a
 * `pre-push` run.
 *
 * @param {string} yamlText
 * @returns {string | null}
 */
function extractPrePushRun(yamlText) {
  const chain = ["pre-push", "commands", "pre-pr-lint", "run"];
  /** @type {{ depth: number, parentIndent: number, found: string | null }} */
  const state = { depth: 0, parentIndent: -1, found: null };
  for (const rawLine of yamlText.split("\n")) {
    if (isBlankOrComment(rawLine)) continue;
    const parsed = parseKeyLine(rawLine);
    if (parsed === null) continue;
    advanceChainWalk(state, parsed, chain);
    if (state.found !== null) return state.found;
  }
  return null;
}

/**
 * One step of the nesting walk. Mutates `state` in place: a dedent past the
 * current parent restarts matching at the top of the chain (so a later sibling
 * block can match); a matching key at the final chain position records the
 * run value in `state.found`. Extracted so `extractPrePushRun` stays under the
 * cognitive-complexity ceiling (rule: one decision surface per function).
 *
 * @param {{ depth: number, parentIndent: number, found: string | null }} state
 * @param {{ indent: number, key: string, value: string }} parsed
 * @param {readonly string[]} chain
 * @returns {void}
 */
function advanceChainWalk(state, parsed, chain) {
  if (state.depth > 0 && parsed.indent <= state.parentIndent) {
    state.depth = 0;
    state.parentIndent = -1;
  }
  if (parsed.key !== chain[state.depth]) return;
  if (state.depth === chain.length - 1) {
    state.found = parsed.value;
    return;
  }
  state.depth += 1;
  state.parentIndent = parsed.indent;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isBlankOrComment(line) {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

/**
 * Parse a `<indent><key>:[ <value>]` line. Returns the leading-space count,
 * the key, and the trimmed inline value (empty string when the key opens a
 * nested block). Returns `null` for lines that are not `key:` shaped (list
 * items, continuation lines).
 *
 * @param {string} line
 * @returns {{ indent: number, key: string, value: string } | null}
 */
function parseKeyLine(line) {
  const m = /^( *)([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(line);
  if (m === null || m[1] === undefined || m[2] === undefined) return null;
  return { indent: m[1].length, key: m[2], value: (m[3] ?? "").trim() };
}

/**
 * Describe which stage the run command requests, for the failure message.
 * Names a concrete `--stage=<x>` when present; otherwise reports the flag is
 * missing entirely.
 *
 * @param {string} run
 * @returns {string}
 */
function describeStage(run) {
  const m = /--stage=([\w-]+)/.exec(run);
  return m !== null ? `--stage=${m[1]}` : "no --stage flag";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkPrePushHookFast();
  if (result.warning !== null) {
    console.warn(`check-pre-push-hook-fast: ${result.warning}`);
  }
  if (result.ok) {
    console.info("[ok] pre-push-hook-stays-fast");
    process.exit(0);
  }
  console.error(`check-pre-push-hook-fast: ${result.error}`);
  console.error(
    "Fix: set lefthook.yml `pre-push.commands.pre-pr-lint.run` to `pnpm pre-pr-lint --stage=fast`. The full stage runs in scripts/local-gate-merge.mjs before merge — pre-push must stay ≤~10s. To deliberately allow a slow pre-push, set ALLOW_SLOW_PRE_PUSH=1 and justify in the PR body.",
  );
  process.exit(1);
}
