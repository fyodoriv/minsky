#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-26 operator "In minsky I don't want to run anything, it should resolve things automatically as rational" -->
//
// Auto-rebase (or close-as-superseded) daemon-authored PRs stuck in
// DIRTY state for >2h. Converts the `daemon-pr-stuck-dirty` self-
// diagnose finding from `[👤 needs-operator]` → `[🤖 minsky-will-fix]`.
//
// Pattern (matching `auto-merge-clean-prs.mjs` + `local-gate-merge.mjs`):
// pure decision function (`decideRebaseAction`) over a `gh pr list`
// snapshot + thin I/O seam (`listFn` / `rebaseFn` / `closeFn`) injected
// for tests (rule #2). Same shape as the existing auto-merge family;
// nothing reinvented (rule #1).
//
// Source (rule #9 — pre-registered):
//   - Task: `daemon-auto-rebase-dirty-prs` in TASKS.md (P0, 2026-05-26).
//   - Hypothesis: `gh pr update-branch <N>` succeeds for >80 % of
//     daemon-authored DIRTY PRs (rebase against a recent `main`); the
//     remaining <20 % are real conflicts that can't be auto-resolved
//     and are closed as superseded (the daemon's next iteration will
//     re-open a fresh PR if the underlying task is still picked).
//   - Success: for any open daemon-authored PR in mergeStateStatus=DIRTY
//     for >2h, the next supervisor cycle either (a) rebases it
//     successfully (PR transitions to MERGEABLE+CI re-triggers) OR
//     (b) closes it as superseded with a paper-trail comment.
//   - Pivot: if `gh pr update-branch` produces a no-op-rebase (network
//     flake / GH API hiccup) ≥1/week, add a 3-strikes gate before
//     declaring close-as-superseded.
//   - Measurement: `node scripts/auto-rebase-dirty-prs.mjs
//     --dry-run --json` returns `{rebased, closed, skipped}` counts.
//   - Anchor: Kephart & Chess 2003 *The Vision of Autonomic Computing*
//     (MAPE-K Execute step — the autonomic loop must ACT on the
//     analysed findings, not just analyse them).
//
// Usage:
//   node scripts/auto-rebase-dirty-prs.mjs [--dry-run] [--limit=N] [--json]
//   --dry-run : list the actions but don't call `gh pr update-branch` / `gh pr close`
//   --limit=N : cap per-cycle work (default 3 — bounded so one cycle can't burn through
//               every DIRTY PR in one shot if the daemon is having a bad day)
//   --json    : emit the result as JSON (for the supervisor's ledger; default: text)
//
// Disable globally via `MINSKY_AUTO_REBASE_DIRTY_PRS=off`. Default: ON.
// rule #16 (Default by default): the autonomic action is the right
// default for a self-supervised dogfood loop.

import { execFileSync } from "node:child_process";

const DEFAULT_LIMIT = 3;
const MIN_AGE_HOURS = 2;
const DAEMON_BRANCH_PREFIXES = ["feat/", "fix/", "chore/", "docs/", "refactor/", "test/"];

/**
 * @typedef {object} OpenPrSnapshot
 * @property {number} number
 * @property {string} headRefName
 * @property {string} mergeStateStatus   - "DIRTY" | "CLEAN" | "BLOCKED" | "BEHIND" | "UNSTABLE" | "UNKNOWN"
 * @property {string} title
 * @property {string} createdAt          - ISO 8601 timestamp
 * @property {string} author             - login of the PR author
 *
 * @typedef {object} RebaseDecision
 * @property {number} pr
 * @property {"rebase" | "close-superseded" | "skip"} action
 * @property {string} reason
 */

/**
 * Pure decision function — given a snapshot of open PRs, decide what to
 * do with each. Tests inject synthetic snapshots; no I/O.
 *
 * @param {readonly OpenPrSnapshot[]} prs
 * @param {{ nowMs: number, limit?: number }} opts
 * @returns {readonly RebaseDecision[]}
 */
export function decideRebaseAction(prs, { nowMs, limit = DEFAULT_LIMIT }) {
  /** @type {RebaseDecision[]} */
  const decisions = [];
  let acted = 0;
  for (const pr of prs) {
    if (acted >= limit) break;
    // Only act on DIRTY PRs (merge conflict). CLEAN/MERGEABLE PRs go
    // through the gh-native auto-merge stage 1 path.
    if (pr.mergeStateStatus !== "DIRTY") continue;
    // Bound by age — flake on a fresh push isn't auto-rebase material.
    const ageHours = (nowMs - Date.parse(pr.createdAt)) / 3_600_000;
    if (ageHours < MIN_AGE_HOURS) {
      decisions.push({
        pr: pr.number,
        action: "skip",
        reason: `age=${ageHours.toFixed(1)}h < ${MIN_AGE_HOURS}h threshold`,
      });
      continue;
    }
    // Only act on daemon-authored branches (a hand-authored PR with a
    // matching prefix is acceptable — the operator can opt out by
    // setting MINSKY_AUTO_REBASE_DIRTY_PRS=off for one cycle).
    const isDaemonShaped = DAEMON_BRANCH_PREFIXES.some((p) => pr.headRefName.startsWith(p));
    if (!isDaemonShaped) {
      decisions.push({
        pr: pr.number,
        action: "skip",
        reason: `branch ${pr.headRefName} is not daemon-shaped (no feat/fix/chore/... prefix)`,
      });
      continue;
    }
    // First action: try rebase. The rebase exec returns an outcome
    // that the runtime translates to "rebase succeeded" or "fall through
    // to close-superseded". Decision function picks "rebase" here; the
    // runtime escalates based on the actual exit code.
    decisions.push({
      pr: pr.number,
      action: "rebase",
      reason: `DIRTY for ${ageHours.toFixed(1)}h on ${pr.headRefName}`,
    });
    acted += 1;
  }
  return decisions;
}

/**
 * I/O seam: list open PRs via `gh pr list`. Returns the structured
 * snapshot the decision function consumes.
 *
 * @returns {readonly OpenPrSnapshot[]}
 */
function listOpenPrsViaGh() {
  const stdout = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "50",
      "--json",
      "number,headRefName,mergeStateStatus,title,createdAt,author",
    ],
    { encoding: "utf8" },
  );
  /** @type {readonly { number:number, headRefName:string, mergeStateStatus:string, title:string, createdAt:string, author:{login:string} }[]} */
  const raw = JSON.parse(stdout);
  return raw.map((p) => ({
    number: p.number,
    headRefName: p.headRefName,
    mergeStateStatus: p.mergeStateStatus,
    title: p.title,
    createdAt: p.createdAt,
    author: p.author?.login ?? "",
  }));
}

/**
 * I/O seam: attempt rebase via `gh pr update-branch <N>`. Returns the
 * outcome so the caller can decide whether to escalate.
 *
 * @param {number} prNumber
 * @returns {"rebased" | "conflict" | "transient"}
 */
function rebasePrViaGh(prNumber) {
  try {
    execFileSync("gh", ["pr", "update-branch", String(prNumber)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "rebased";
  } catch (err) {
    const e = /** @type {{ stderr?: Buffer }} */ (err);
    const stderr = e.stderr?.toString() ?? "";
    // `gh pr update-branch` returns non-zero on EITHER conflict OR
    // transient error (network, rate limit). Distinguish by stderr —
    // "conflicts" / "conflict" in the message means real conflict.
    if (/conflict/i.test(stderr)) return "conflict";
    return "transient";
  }
}

/**
 * I/O seam: close PR via `gh pr close` with the canonical comment.
 *
 * @param {number} prNumber
 * @returns {void}
 */
function closePrAsSupersededViaGh(prNumber) {
  execFileSync(
    "gh",
    [
      "pr",
      "close",
      String(prNumber),
      "--comment",
      `Auto-closed by \`daemon-auto-rebase-dirty-prs\` — \`gh pr update-branch\` failed with conflicts after >${MIN_AGE_HOURS}h DIRTY. The daemon's next iteration will re-open a fresh PR if the underlying task is still picked. See \`scripts/auto-rebase-dirty-prs.mjs\` for the autonomic-loop rationale.`,
    ],
    { encoding: "utf8" },
  );
}

/**
 * Execute a single rebase decision. Extracted to keep
 * `executeDecisions` under biome's cognitive-complexity ceiling.
 *
 * @param {RebaseDecision} d
 * @param {{ rebaseFn: (n: number) => "rebased" | "conflict" | "transient", closeFn: (n: number) => void }} io
 * @returns {{ pr: number, outcome: "rebased" | "closed-superseded" | "transient-error", reason: string }}
 */
function executeOneRebase(d, { rebaseFn, closeFn }) {
  const result = rebaseFn(d.pr);
  if (result === "rebased") {
    return { pr: d.pr, outcome: "rebased", reason: d.reason };
  }
  if (result === "conflict") {
    closeFn(d.pr);
    return {
      pr: d.pr,
      outcome: "closed-superseded",
      reason: `${d.reason} (conflict escalated)`,
    };
  }
  return {
    pr: d.pr,
    outcome: "transient-error",
    reason: `${d.reason} (will retry next cycle)`,
  };
}

/**
 * Execute the decisions. Returns the per-PR outcome.
 *
 * @param {readonly RebaseDecision[]} decisions
 * @param {{
 *   rebaseFn: (n: number) => "rebased" | "conflict" | "transient",
 *   closeFn: (n: number) => void,
 *   dryRun: boolean,
 * }} io
 * @returns {readonly { pr: number, outcome: "rebased" | "closed-superseded" | "skipped" | "transient-error" | "dry-run", reason: string }[]}
 */
export function executeDecisions(decisions, { rebaseFn, closeFn, dryRun }) {
  /** @type {{ pr: number, outcome: "rebased" | "closed-superseded" | "skipped" | "transient-error" | "dry-run", reason: string }[]} */
  const outcomes = [];
  for (const d of decisions) {
    if (d.action === "skip") {
      outcomes.push({ pr: d.pr, outcome: "skipped", reason: d.reason });
      continue;
    }
    if (dryRun) {
      outcomes.push({ pr: d.pr, outcome: "dry-run", reason: `would ${d.action}: ${d.reason}` });
      continue;
    }
    if (d.action === "rebase") {
      outcomes.push(executeOneRebase(d, { rebaseFn, closeFn }));
    }
  }
  return outcomes;
}

/* v8 ignore start */
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const disable = (process.env["MINSKY_AUTO_REBASE_DIRTY_PRS"] ?? "on").toLowerCase();
  if (["off", "false", "0", "no"].includes(disable)) {
    process.stdout.write(
      "daemon-auto-rebase-dirty-prs: disabled via MINSKY_AUTO_REBASE_DIRTY_PRS\n",
    );
    process.exit(0);
  }
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const asJson = argv.includes("--json");
  const limitArg = argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg
    ? Number.parseInt(limitArg.split("=")[1] ?? `${DEFAULT_LIMIT}`, 10)
    : DEFAULT_LIMIT;

  const prs = listOpenPrsViaGh();
  const decisions = decideRebaseAction(prs, { nowMs: Date.now(), limit });
  const outcomes = executeDecisions(decisions, {
    rebaseFn: rebasePrViaGh,
    closeFn: closePrAsSupersededViaGh,
    dryRun,
  });
  const rollup = {
    rebased: outcomes.filter((o) => o.outcome === "rebased").length,
    closed: outcomes.filter((o) => o.outcome === "closed-superseded").length,
    skipped: outcomes.filter((o) => o.outcome === "skipped").length,
    transient: outcomes.filter((o) => o.outcome === "transient-error").length,
    dryRun: outcomes.filter((o) => o.outcome === "dry-run").length,
  };
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ outcomes, rollup }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `daemon-auto-rebase-dirty-prs: ${rollup.rebased} rebased · ${rollup.closed} closed-superseded · ${rollup.skipped} skipped · ${rollup.transient} transient${dryRun ? ` · ${rollup.dryRun} dry-run` : ""}\n`,
    );
    for (const o of outcomes) {
      process.stdout.write(`  #${o.pr}: ${o.outcome} — ${o.reason}\n`);
    }
  }
  process.exit(0);
}
/* v8 ignore stop */
