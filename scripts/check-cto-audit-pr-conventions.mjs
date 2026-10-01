#!/usr/bin/env node
// Pattern: deterministic gate over a PR-shape convention (rule #10).
// Source: `post-task-cto-audit` task (TASKS.md) — sub-step (e/f) requires
//   audit PRs to land on `audit/<UTC-date>-<task-id>` branches AND carry
//   the `minsky:cto-audit` label. The pre-registered measurement command
//   (`gh pr list --label minsky:cto-audit ...`) keys on the label; the
//   branch name keys the audit to the ship that triggered it. A drift in
//   either silently undercounts the success metric — Munafò et al. 2017's
//   pre-registration discipline only works when the post-hoc query can
//   actually see the artefacts it was committed to count.
// Conformance: full — pure shape check on a PR's headRefName + labels,
//   no LLM in the chain. Paired tests under
//   `scripts/check-cto-audit-pr-conventions.test.mjs`.
//
// Biconditional enforced:
//   1. headRefName starts with `audit/`           → labels include `minsky:cto-audit`
//   2. labels include `minsky:cto-audit`          → headRefName matches `audit/<YYYY-MM-DD>-<task-id>`
//   3. (neither)                                  → ok (this PR is not an audit PR)
//
// task-id grammar mirrors `cto-audit-cli-wiring.ts` `sanitizeTaskId`'s
// inverse (`[a-z][a-z0-9_-]*[a-z0-9]`); date is strict `\d{4}-\d{2}-\d{2}`.
//
// Pivot (rule #9): if this gate produces ≥3 false positives in its first
// month (e.g., audit PRs intentionally rebased onto a non-audit branch
// during a remediation), pivot to a YAML-block convention in the audit
// PR body that the brief builder writes deterministically.

export const CTO_AUDIT_LABEL = "minsky:cto-audit";

const AUDIT_BRANCH_RE = /^audit\/(\d{4}-\d{2}-\d{2})-([a-z][a-z0-9_-]*[a-z0-9])$/;
const AUDIT_BRANCH_PREFIX_RE = /^audit\//;

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * @param {{ headRefName: string, labels: readonly string[] }} pr
 * @returns {CheckResult}
 */
export function checkCtoAuditPrConventions(pr) {
  /** @type {string[]} */
  const errors = [];
  const hasLabel = pr.labels.includes(CTO_AUDIT_LABEL);
  const hasAuditPrefix = AUDIT_BRANCH_PREFIX_RE.test(pr.headRefName);
  const matchesAuditShape = AUDIT_BRANCH_RE.test(pr.headRefName);

  if (hasAuditPrefix && !hasLabel) {
    errors.push(
      `branch \`${pr.headRefName}\` uses the audit prefix but the PR is missing the \`${CTO_AUDIT_LABEL}\` label. Add it: \`gh pr edit <num> --add-label ${CTO_AUDIT_LABEL}\`. Without the label the pre-registered measurement query (gh pr list --label ${CTO_AUDIT_LABEL} ...) silently undercounts.`,
    );
  }

  if (hasLabel && !hasAuditPrefix) {
    errors.push(
      `PR carries the \`${CTO_AUDIT_LABEL}\` label but its branch \`${pr.headRefName}\` does not start with \`audit/\`. Audit PRs must land on \`audit/<UTC-date>-<task-id>\` (per docs/post-task-cto-audit.md). Either rename the branch or remove the label.`,
    );
  } else if (hasLabel && hasAuditPrefix && !matchesAuditShape) {
    errors.push(
      `branch \`${pr.headRefName}\` does not match the required shape \`audit/<YYYY-MM-DD>-<task-id>\` (date strict ISO; task-id \`[a-z][a-z0-9_-]*[a-z0-9]\`). Rename the branch so the audit can be keyed back to the ship that triggered it.`,
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * CLI: reads `{headRefName, labels}` JSON from a file argument or stdin.
 * The CI step writes `gh pr view --json headRefName,labels` output here.
 * Labels arrive as `[{name: "..."}, ...]`; this normaliser accepts either
 * the raw `gh` shape or a flat string array (so tests can drive directly).
 *
 * @param {unknown} parsed
 * @returns {{ headRefName: string, labels: readonly string[] }}
 */
export function normalizeGhPrJson(parsed) {
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("expected a JSON object with `headRefName` and `labels` fields");
  }
  /** @type {Record<string, unknown>} */
  const obj = /** @type {Record<string, unknown>} */ (parsed);
  const headRefName = obj["headRefName"];
  if (typeof headRefName !== "string") {
    throw new Error("expected `headRefName` to be a string");
  }
  const rawLabels = obj["labels"];
  if (!Array.isArray(rawLabels)) {
    throw new Error("expected `labels` to be an array");
  }
  /** @type {string[]} */
  const labels = rawLabels.map((label) => {
    if (typeof label === "string") return label;
    if (
      label !== null &&
      typeof label === "object" &&
      typeof (/** @type {{name?: unknown}} */ (label).name) === "string"
    ) {
      return /** @type {{name: string}} */ (label).name;
    }
    throw new Error("expected each label to be a string or {name: string}");
  });
  return { headRefName, labels };
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const arg = process.argv[2];
  /** @type {string} */
  let raw;
  if (arg !== undefined && arg !== "-") {
    const { readFile } = await import("node:fs/promises");
    raw = await readFile(arg, "utf8");
  } else {
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    raw = Buffer.concat(chunks).toString("utf8");
  }
  const pr = normalizeGhPrJson(JSON.parse(raw));
  const result = checkCtoAuditPrConventions(pr);
  if (result.ok) {
    process.stdout.write("cto-audit-pr-conventions ok.\n");
    return 0;
  }
  process.stderr.write("cto-audit-pr-conventions violation:\n");
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  process.stderr.write(
    [
      "",
      "See docs/post-task-cto-audit.md for the audit PR conventions and",
      "TASKS.md `post-task-cto-audit` for the pre-registered measurement query",
      "this gate protects.",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-cto-audit-pr-conventions.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
