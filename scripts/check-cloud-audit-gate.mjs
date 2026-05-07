#!/usr/bin/env node
// @ts-check
// Pattern: deterministic gate (rule #10) over a PR diff — blocks any PR
// touching cloud-tier package paths until the
// `cloud-tier-external-security-audit-gate` task block's `**Blocked**:`
// line is removed in TASKS.md (Layer 1 in `docs/security/audit-gate.md`).
// Source: vision.md rule #13 minimum-bar item 6 ("External security audit
//   gate before cloud tier"); TASKS.md `cloud-tier-external-security-audit-gate`
//   P0 (Files: this script); `docs/security/audit-gate.md` § Layer 1.
//   Conformance: full — pure function over (changedFiles, tasksMd); CLI is
//   the I/O boundary.
//
// Why this gate exists: the cloud tier's blast radius is *every* customer's
// repo, API tokens, and OTEL data — a categorical step up from the
// single-operator local CLI. Per Saltzer & Schroeder (1975) "fail-safe
// defaults" and CNCF Security TAG (2022) "multi-tenant infra ships with
// third-party audit", cloud-tier code must not accrue in `main` ahead of
// the audit. This lint enforces that mechanically: while the task block's
// `**Blocked**:` line still names `needs-user-approval`, any diff touching
// `novel/cloud-supervisor/`, `novel/cross-repo-benchmark/`, or
// `novel/shared-invariant-catalog/` exits 1. Removing the `**Blocked**:`
// line is operator action (vendor selection / contract / payment — out of
// scope for autonomous loops per `feedback_modify_only_minsky_repo.md`);
// once removed, the lint exits 0 and cloud-tier code may land.
//
// Pivot (rule #9): if a fourth cloud-tier package surfaces (e.g.,
// `novel/multi-tenant-billing/`), add it to `CLOUD_TIER_PATH_PREFIXES`
// rather than retire — the gate's authority is the union of cloud-tier
// surfaces, not any one package.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Cloud-tier package path prefixes. Pinned here (not glob-discovered) so a
 * new cloud-tier package added without an audit-gate review surfaces as a
 * separate, visible PR ratchet (add the package + add it here), not slip in
 * silently — same shape as `THREAT_MODEL_README_PATHS`.
 */
export const CLOUD_TIER_PATH_PREFIXES = Object.freeze([
  "novel/cloud-supervisor/",
  "novel/cross-repo-benchmark/",
  "novel/shared-invariant-catalog/",
]);

export const TASK_ID = "cloud-tier-external-security-audit-gate";

/**
 * Token in the `**Blocked**:` line that keeps the gate active. Locked here
 * so a future renaming of the operator-action handle (e.g., to
 * `awaiting-vendor-contract`) is a deliberate edit in this lint, not silent
 * drift in TASKS.md.
 */
export const BLOCKED_TOKEN = "needs-user-approval";

const TASK_HEADER_RE = /^- \[[ x]\] /;
const ID_LINE_RE = /^\s+- \*\*ID\*\*:\s*(\S+)/;
const BLOCKED_LINE_RE = /^\s+- \*\*Blocked\*\*:\s*(.+)$/;

/**
 * @typedef {{ status: string, path: string }} ChangedFile
 */

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * @param {string} path
 * @returns {boolean}
 */
function isCloudTierPath(path) {
  return CLOUD_TIER_PATH_PREFIXES.some((pre) => path.startsWith(pre));
}

/**
 * Step the parser one line forward. Returns either a non-null `blocked`
 * value (the cloud-tier block's `**Blocked**:` value — terminal), or the
 * next `currentId` to thread into the next call. Splitting the loop body
 * out keeps `extractBlockedLine` under the cognitive-complexity cap.
 *
 * @param {string} line
 * @param {string | null} currentId
 * @returns {{ blocked: string } | { currentId: string | null }}
 */
function stepBlockedParser(line, currentId) {
  if (TASK_HEADER_RE.test(line)) return { currentId: null };
  const idMatch = line.match(ID_LINE_RE);
  if (idMatch !== null) return { currentId: idMatch[1] ?? null };
  if (currentId !== TASK_ID) return { currentId };
  const blockedMatch = line.match(BLOCKED_LINE_RE);
  if (blockedMatch !== null) return { blocked: blockedMatch[1] ?? "" };
  return { currentId };
}

/**
 * Read the `**Blocked**:` line value of the cloud-tier task block, if any.
 * Returns `null` when the task block is absent (treated as "not blocked" —
 * fail-open is wrong here, but absence is operator-side bookkeeping the
 * substrate-cohesion gate already enforces).
 *
 * Pure — no I/O.
 *
 * @param {string} tasksMdText
 * @returns {string | null}
 */
export function extractBlockedLine(tasksMdText) {
  /** @type {string | null} */
  let currentId = null;
  for (const line of tasksMdText.split("\n")) {
    const r = stepBlockedParser(line, currentId);
    if ("blocked" in r) return r.blocked;
    currentId = r.currentId;
  }
  return null;
}

/**
 * Pure entry point. The gate fires when both:
 *   1. at least one changed file's path is under a cloud-tier prefix, AND
 *   2. the `cloud-tier-external-security-audit-gate` task block still has a
 *      `**Blocked**:` line whose value contains `BLOCKED_TOKEN`.
 *
 * @param {{ changedFiles: readonly ChangedFile[], tasksMd: string }} input
 * @returns {CheckResult}
 */
export function checkCloudAuditGate({ changedFiles, tasksMd }) {
  const cloudTierTouched = changedFiles
    .filter((f) => f.status !== "D")
    .filter((f) => isCloudTierPath(f.path))
    .map((f) => f.path);
  if (cloudTierTouched.length === 0) return { ok: true };

  const blocked = extractBlockedLine(tasksMd);
  if (blocked === null || !blocked.includes(BLOCKED_TOKEN)) return { ok: true };

  /** @type {string[]} */
  const errors = cloudTierTouched.map(
    (p) =>
      `cloud-tier-blocked-on-audit: \`${p}\` is in a cloud-tier package; the \`${TASK_ID}\` task block still has \`**Blocked**:\` containing \`${BLOCKED_TOKEN}\` — see docs/security/audit-gate.md § Unblock criteria.`,
  );
  return { ok: false, errors };
}

/**
 * @param {string} base
 * @param {string} head
 * @returns {ChangedFile[]}
 */
function getChangedFiles(base, head) {
  const out = execSync(`git diff --name-status ${base}...${head}`, { encoding: "utf8" });
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const tabIdx = line.indexOf("\t");
      if (tabIdx === -1) return { status: line, path: "" };
      return { status: line.slice(0, tabIdx), path: line.slice(tabIdx + 1) };
    });
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const base = process.env["CLOUD_AUDIT_GATE_DIFF_BASE"] ?? "origin/main";
  const head = "HEAD";
  const tasksMd = readFileSync(resolve(REPO_ROOT, "TASKS.md"), "utf8");

  /** @type {ChangedFile[]} */
  let changedFiles;
  try {
    changedFiles = getChangedFiles(base, head);
  } catch (e) {
    process.stderr.write(
      `cloud-audit-gate cannot compute diff: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }

  const result = checkCloudAuditGate({ changedFiles, tasksMd });
  if (result.ok) {
    process.stdout.write("cloud-audit-gate ok: no cloud-tier paths touched, or audit unblocked.\n");
    return 0;
  }
  process.stderr.write("cloud-audit-gate violation:\n");
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-cloud-audit-gate.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}
