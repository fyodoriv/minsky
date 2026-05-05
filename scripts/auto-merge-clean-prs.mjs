#!/usr/bin/env node
// <!-- scope: human-approved 2026-05-04 user request "settings eg mode. Implement it" -->
// Auto-merge sweep — lists open PRs with mergeStateStatus=CLEAN and
// squash-merges each, deleting the branch.
//
// Pattern: pure decision function (`pickMergeable`) over a `gh pr list`
// snapshot + thin CLI that calls `gh pr merge`. The decision function
// is the seam — tests inject a synthetic snapshot; production calls
// `gh` via execFileSync. Mirrors the rule-lint shape (rule #2 +
// rule #10).
//
// Source: 2026-05-04 dogfood debug — operator observed a backlog of
// CLEAN PRs that nothing was merging. The supervisor produces PRs
// (post-#160) but doesn't drain them; operator action was the only
// merge path. This script is the drain. Wired into the supervisor
// behind `MINSKY_AUTO_MERGE=1` (rule #2 escape hatch — off by default
// so the operator can opt in).
//
// Pivot (rule #9): if auto-merge surfaces ≥1 regression per week
// during the first month of operation (a PR merges that should have
// been caught by CI but the gate was misconfigured), pivot to a
// label-gated form: only merge PRs labeled `minsky-auto-merge`. The
// label becomes the explicit consent signal.
//
// Skip semantics:
//   - PRs labeled `minsky-no-merge` are skipped (operator escape hatch).
//   - PRs whose mergeStateStatus is anything other than `CLEAN` are
//     skipped (BEHIND, BLOCKED, DIRTY, UNSTABLE, UNKNOWN).
//   - Draft PRs are skipped.
//   - When `--dry-run` is passed, the script prints what it would
//     merge but does not call `gh pr merge`.

import { execFileSync } from "node:child_process";

/**
 * @typedef {object} PrSummary
 * @property {number} number
 * @property {string} title
 * @property {string} mergeStateStatus
 * @property {boolean} isDraft
 * @property {readonly { name: string }[]} labels
 */

/**
 * Pure: given a snapshot of open PRs, return the ones safe to auto-merge.
 *
 * @param {readonly PrSummary[]} prs
 * @returns {PrSummary[]}
 */
export function pickMergeable(prs) {
  return prs.filter((pr) => {
    if (pr.isDraft) return false;
    if (pr.mergeStateStatus !== "CLEAN") return false;
    if (pr.labels.some((l) => l.name === "minsky-no-merge")) return false;
    return true;
  });
}

/**
 * Default snapshot source — calls `gh pr list` and parses the JSON.
 *
 * @returns {readonly PrSummary[]}
 */
function fetchOpenPrsViaGh() {
  const out = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--json",
      "number,title,mergeStateStatus,isDraft,labels",
      "--limit",
      "50",
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(out);
}

/**
 * Default merge action — calls `gh pr merge --squash --delete-branch`.
 *
 * @param {number} prNumber
 * @returns {void}
 */
function mergeViaGh(prNumber) {
  execFileSync("gh", ["pr", "merge", String(prNumber), "--squash", "--delete-branch"], {
    stdio: "inherit",
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const dryRun = process.argv.includes("--dry-run");
  const prs = fetchOpenPrsViaGh();
  const mergeable = pickMergeable(prs);
  if (mergeable.length === 0) {
    process.stdout.write("auto-merge: 0 mergeable PRs\n");
    process.exit(0);
  }
  process.stdout.write(
    `auto-merge: ${mergeable.length} mergeable PR(s)${dryRun ? " (dry-run)" : ""}\n`,
  );
  for (const pr of mergeable) {
    process.stdout.write(`  #${pr.number}: ${pr.title}\n`);
    if (!dryRun) {
      try {
        mergeViaGh(pr.number);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`  failed to merge #${pr.number}: ${message}\n`);
      }
    }
  }
}
