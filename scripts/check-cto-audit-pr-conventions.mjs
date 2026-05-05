#!/usr/bin/env node
// Pattern: deterministic gate over a PR head-branch / label biconditional.
// Source: rule #9 (pre-registered HDD — Munafò et al. 2017). The
// `post-task-cto-audit` task's pre-registered measurement is
//   gh pr list --label minsky:cto-audit ...
// — a query that silently returns 0 if the label is missing. The label
// was previously prompt-instructed (the spawned `claude --print`
// reads `CTO_PROMPT_HEADER` and is asked to apply the label at PR-create
// time). Prompt-instructed conventions drift; deterministic gates don't.
// Same shape + reasoning as `check-pr-self-grade.mjs`.
//
// Conformance: full — pure shape check on the PR's head-branch name +
// label list, no LLM in the chain.
//
// The biconditional this lint enforces (defending the metric in both
// directions):
//
//   1. Branch matches `audit/<UTC-date>-<task-id>` →
//      `minsky:cto-audit` label MUST be present
//      (without the label, the metric undercounts: a real audit fired
//      but is invisible to `gh pr list --label minsky:cto-audit ...`).
//
//   2. `minsky:cto-audit` label is present →
//      Branch MUST match `audit/<UTC-date>-<task-id>`
//      (without the branch convention, the metric overcounts: an
//      operator-authored PR mistakenly tagged with the audit label is
//      counted as an audit-filed task).
//
// Pivot (rule #9): if this gate produces ≥3 false positives in its first
// month of audit-PR traffic (after PR #205 merges + audits start firing),
// loosen the branch grammar; if it produces 0 hits (audits never fire),
// the upstream blocker is supervisor enablement, not this lint — defer
// further work on the audit family until the metric is non-zero.

/** Canonical label string. Must match `CTO_AUDIT_PR_LABEL` in
 *  `novel/tick-loop/src/post-task-cto-audit.ts:51`. Drift on either side
 *  silently zeroes the metric — both sides have a paired test pinning
 *  the literal. */
export const CTO_AUDIT_PR_LABEL = "minsky:cto-audit";

/** Branch name grammar:
 *    audit/<UTC-date>-<task-id>
 *  where `<UTC-date>` is `YYYY-MM-DD` and `<task-id>` matches the
 *  TASKS.md task-id grammar (`[a-z][a-z0-9-]*[a-z0-9]`).
 *
 *  Examples:
 *    audit/2026-05-05-canonical-metric-list-per-repo  (valid)
 *    audit/2026-05-05-x                                (valid; minimal task-id)
 *    audit/20260505-foo                                (invalid; no dashes in date)
 *    audit/2026-05-05--foo                             (invalid; double dash)
 *    audit/2026-05-05-Foo                              (invalid; uppercase)
 *
 *  Note: the regex enforces a SINGLE `-` between date and task-id and
 *  bans trailing `-` (TASKS.md grammar requires terminal `[a-z0-9]`).
 *  A 1-char task-id is permitted because the grammar `[a-z][a-z0-9-]*[a-z0-9]`
 *  is satisfied by the single-char form `[a-z]` collapsing the start +
 *  end requirements onto the same character (the spec is ambiguous here;
 *  we follow `parseFixtureTaskIds` permissive behaviour).
 */
const AUDIT_BRANCH_RE = /^audit\/\d{4}-\d{2}-\d{2}-[a-z]([a-z0-9-]*[a-z0-9])?$/;

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure function: given a PR's head-branch name and label list, return
 * either { ok: true } or { ok: false, errors: string[] }.
 *
 * @param {{ headRefName: string, labels: readonly string[] }} args
 * @returns {CheckResult}
 */
export function checkCtoAuditPrConventions(args) {
  const { headRefName, labels } = args;
  const branchMatches = AUDIT_BRANCH_RE.test(headRefName);
  const hasLabel = labels.includes(CTO_AUDIT_PR_LABEL);

  /** @type {string[]} */
  const errors = [];

  if (branchMatches && !hasLabel) {
    errors.push(
      [
        `branch \`${headRefName}\` matches the CTO-audit naming convention`,
        `(\`audit/<UTC-date>-<task-id>\`) but the \`${CTO_AUDIT_PR_LABEL}\` label is missing.`,
        `The pre-registered measurement (\`gh pr list --label ${CTO_AUDIT_PR_LABEL} ...\`)`,
        "keys on this exact label, so an unlabeled audit PR is invisible to the metric.",
        `Add the label: \`gh pr edit <pr> --add-label ${CTO_AUDIT_PR_LABEL}\`.`,
      ].join(" "),
    );
  }

  if (hasLabel && !branchMatches) {
    errors.push(
      [
        `PR is labeled \`${CTO_AUDIT_PR_LABEL}\` but branch \`${headRefName}\` does not match`,
        "the `audit/<UTC-date>-<task-id>` convention (e.g.",
        "`audit/2026-05-05-canonical-metric-list-per-repo`).",
        "Either rename the branch to follow the convention or remove the label if this PR",
        "is not a post-task CTO audit.",
      ].join(" "),
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Read raw input from the path-arg or stdin.
 *
 * @param {string | undefined} arg
 * @returns {Promise<string>}
 */
async function readInput(arg) {
  if (arg !== undefined && arg !== "-") {
    const { readFile } = await import("node:fs/promises");
    return readFile(arg, "utf8");
  }
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Coerce one element of `gh`'s `labels` array to its string name.
 * `gh` returns `[{name, color, ...}]`; the script also accepts a plain
 * string array so callers can hand it pre-flattened input.
 *
 * @param {unknown} l
 * @returns {string}
 */
function coerceLabel(l) {
  if (typeof l === "string") return l;
  if (typeof l === "object" && l !== null) {
    const name = /** @type {{name?: unknown}} */ (l).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/**
 * Parse the JSON input into the args shape the pure checker expects.
 * Throws on invalid JSON shape; caller catches + writes to stderr.
 *
 * @param {string} raw
 * @returns {{ headRefName: string, labels: string[] }}
 */
function parseInput(raw) {
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("input must be a JSON object");
  }
  const obj = /** @type {Record<string, unknown>} */ (parsed);
  const rawHead = obj["headRefName"];
  const headRefName = typeof rawHead === "string" ? rawHead : "";
  const rawLabelsField = obj["labels"];
  const rawLabels = Array.isArray(rawLabelsField) ? rawLabelsField : [];
  return { headRefName, labels: rawLabels.map(coerceLabel) };
}

/**
 * CLI: reads `{ headRefName, labels }` JSON from a file path passed as
 * the first argument, OR from stdin if no argument is given. The CI
 * workflow runs `gh pr view <n> --json headRefName,labels` and pipes
 * the JSON into this script.
 *
 * @returns {Promise<number>}
 */
async function main() {
  const raw = await readInput(process.argv[2]);
  /** @type {{ headRefName: string, labels: string[] }} */
  let args;
  try {
    args = parseInput(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`cto-audit-pr-conventions: ${msg}\n`);
    return 1;
  }

  const result = checkCtoAuditPrConventions(args);
  if (result.ok) {
    process.stdout.write(
      `cto-audit-pr-conventions ok: branch \`${args.headRefName}\` and labels are consistent.\n`,
    );
    return 0;
  }
  process.stderr.write("cto-audit-pr-conventions violation:\n");
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-cto-audit-pr-conventions.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
