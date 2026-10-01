#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved 2026-05-26 operator "In minsky I don't want to run anything, it should resolve things automatically as rational" -->
//
// Auto-close daemon-authored PRs whose task IDs no longer have a
// `**ID**: <id>` block in TASKS.md (the operator removed/renamed the
// task, leaving the PR orphaned). Converts the
// `daemon-task-id-staleness` self-diagnose finding from
// `[👤 needs-operator]` → `[🤖 minsky-will-fix]`.
//
// Pattern (matching `daemon-auto-rebase-dirty-prs.mjs`):
// pure decision function (`decideOrphanClose`) over an `OpenPrSnapshot[]`
// + `tasksMdContent: string` + thin I/O seams for execution.
//
// Source (rule #9 — pre-registered):
//   - Task: `daemon-auto-close-orphan-prs` in TASKS.md (P0, 2026-05-26).
//   - Hypothesis: when an operator removes a task block from TASKS.md
//     mid-iteration, the daemon's open PR for that task is now
//     orphaned — no longer wanted but burning attention every cycle.
//     Closing it with a paper-trail comment is the right autonomic
//     action.
//   - Success: any open daemon-authored PR whose task ID does not
//     appear in TASKS.md is closed within 1 supervisor cycle, with
//     a `gh pr close` comment referencing this script.
//   - Pivot: if false-positive rate >1/week (operator complains "you
//     closed my real PR"), revert to `actor: "operator"` and ship
//     just the diagnostic surface (which we already have).
//   - Measurement: `node scripts/auto-close-orphan-prs.mjs
//     --dry-run --json` returns `{closed, skipped}` counts.
//   - Anchor: Kephart & Chess 2003 *The Vision of Autonomic Computing*
//     (MAPE-K Execute step); rule #6 (stay loud — closed PRs leave a
//     paper trail; silently abandoned PRs do not).
//
// Usage:
//   node scripts/auto-close-orphan-prs.mjs [--dry-run] [--limit=N] [--json]
//   --dry-run : list the actions but don't call `gh pr close`
//   --limit=N : cap per-cycle work (default 5)
//   --json    : emit the result as JSON (for the supervisor's ledger)
//
// Disable globally via `MINSKY_AUTO_CLOSE_ORPHAN_PRS=off`. Default: ON.

import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = process.env["MINSKY_HOME"] ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LIMIT = 5;
const DAEMON_BRANCH_PREFIXES = ["feat/", "fix/", "chore/", "docs/", "refactor/", "test/"];

/**
 * @typedef {object} OpenPrSnapshot
 * @property {number} number
 * @property {string} headRefName
 * @property {string} title
 * @property {string} author
 *
 * @typedef {object} OrphanCloseDecision
 * @property {number} pr
 * @property {string} taskId
 * @property {"close" | "skip"} action
 * @property {string} reason
 */

/**
 * Extract a task ID from a daemon-shaped branch name. Returns null if
 * the branch isn't shaped like `<prefix>/<task-id>`.
 *
 * Examples:
 *   `feat/daemon-auto-close-orphan-prs` → `daemon-auto-close-orphan-prs`
 *   `chore/pr-description-cold-reader-order` → `pr-description-cold-reader-order`
 *   `operator-branch` → null
 *
 * @param {string} branchName
 * @returns {string | null}
 */
export function extractTaskIdFromBranch(branchName) {
  for (const prefix of DAEMON_BRANCH_PREFIXES) {
    if (branchName.startsWith(prefix)) {
      const id = branchName.slice(prefix.length);
      // Strip trailing slash-separated components (e.g. `feat/foo/bar`
      // → `foo`). Task IDs are flat kebab-case.
      return id.includes("/") ? id.slice(0, id.indexOf("/")) : id;
    }
  }
  return null;
}

/**
 * Pure decision function — for each open PR, determine if its task ID
 * is missing from TASKS.md (orphan).
 *
 * Distinguishes daemon-opened PRs from operator-authored ones via the
 * positive signal `daemonOpenedTaskIds` — the set of task IDs that
 * have at least one row in `.minsky/experiment-store/cross-repo/*.jsonl`.
 * Only the daemon writes those files; operator-authored PRs whose
 * branches happen to match the daemon prefix shape (e.g.
 * `feat/<arbitrary-slug>`) will have NO experiment-store rows and
 * will be skipped as "not opened by daemon".
 *
 * Pre-2026-05-27 the heuristic treated ANY `feat/<slug>` branch as a
 * daemon PR. PR #902 (operator-authored, branch `feat/metric-list-
 * single-source`) was falsely closed because the slug wasn't in
 * TASKS.md — but the daemon never opened the PR. The
 * `daemonOpenedTaskIds` check below is the fix.
 *
 * @param {readonly OpenPrSnapshot[]} prs
 * @param {{ tasksMdContent: string, daemonOpenedTaskIds?: ReadonlySet<string>, limit?: number }} opts
 * @returns {readonly OrphanCloseDecision[]}
 */
export function decideOrphanClose(
  prs,
  { tasksMdContent, daemonOpenedTaskIds, limit = DEFAULT_LIMIT },
) {
  /** @type {OrphanCloseDecision[]} */
  const decisions = [];
  let acted = 0;
  for (const pr of prs) {
    if (acted >= limit) break;
    const taskId = extractTaskIdFromBranch(pr.headRefName);
    if (!taskId) {
      decisions.push({
        pr: pr.number,
        taskId: "",
        action: "skip",
        reason: `branch ${pr.headRefName} is not daemon-shaped (no recognised prefix)`,
      });
      continue;
    }
    // Positive-signal check: was this task ever iterated by the daemon?
    // The daemon's only side effect is writing to .minsky/experiment-
    // store/cross-repo/<task-id>.jsonl. If `daemonOpenedTaskIds` was
    // provided AND the task ID isn't in it, this PR was opened by the
    // operator (or another agent) and the orphan heuristic shouldn't
    // touch it. Backward-compat: if no set is provided, fall through
    // to the legacy TASKS.md check (preserves pre-2026-05-27 behavior
    // for tests + scripts that haven't been updated yet).
    if (daemonOpenedTaskIds !== undefined && !daemonOpenedTaskIds.has(taskId)) {
      decisions.push({
        pr: pr.number,
        taskId,
        action: "skip",
        reason: `task ${taskId} has no experiment-store row — PR was not opened by daemon (operator-authored)`,
      });
      continue;
    }
    // Match exactly the `**ID**: <id>` line shape that the picker uses.
    // A substring match against the task ID alone would false-positive
    // on prose mentions.
    const idLine = `**ID**: ${taskId}`;
    if (tasksMdContent.includes(idLine)) {
      decisions.push({
        pr: pr.number,
        taskId,
        action: "skip",
        reason: `task block ${taskId} still in TASKS.md`,
      });
      continue;
    }
    decisions.push({
      pr: pr.number,
      taskId,
      action: "close",
      reason: `task ${taskId} absent from TASKS.md (orphan PR)`,
    });
    acted += 1;
  }
  return decisions;
}

/**
 * Load the set of task IDs that have at least one row in
 * `.minsky/experiment-store/cross-repo/*.jsonl`. The daemon's only
 * side effect is writing to those files — so a task in this set was
 * iterated by the daemon. A task NOT in this set has only ever been
 * touched by operator-authored work (or never touched at all).
 *
 * Returns an empty set if the store directory doesn't exist (fresh
 * checkout, daemon never ran).
 *
 * @param {string} repoRoot
 * @returns {Promise<Set<string>>}
 */
export async function loadDaemonOpenedTaskIds(repoRoot) {
  const storeDir = resolve(repoRoot, ".minsky", "experiment-store", "cross-repo");
  /** @type {string[]} */
  let entries;
  try {
    entries = await readdir(storeDir);
  } catch {
    return new Set();
  }
  const ids = new Set();
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const id = basename(entry, ".jsonl");
    // Skip the synthetic `_no-task.jsonl` ledger — it's the daemon's
    // bookkeeping for "no eligible task" iterations, not a real task.
    if (id === "_no-task") continue;
    ids.add(id);
  }
  return ids;
}

/**
 * I/O seam: list open PRs via `gh pr list`.
 *
 * @returns {readonly OpenPrSnapshot[]}
 */
function listOpenPrsViaGh() {
  const stdout = execFileSync(
    "gh",
    ["pr", "list", "--state", "open", "--limit", "50", "--json", "number,headRefName,title,author"],
    { encoding: "utf8" },
  );
  /** @type {readonly { number:number, headRefName:string, title:string, author:{login:string} }[]} */
  const raw = JSON.parse(stdout);
  return raw.map((p) => ({
    number: p.number,
    headRefName: p.headRefName,
    title: p.title,
    author: p.author?.login ?? "",
  }));
}

/**
 * I/O seam: close PR via `gh pr close` with the canonical comment.
 *
 * @param {number} prNumber
 * @param {string} taskId
 * @returns {void}
 */
function closeOrphanPrViaGh(prNumber, taskId) {
  execFileSync(
    "gh",
    [
      "pr",
      "close",
      String(prNumber),
      "--comment",
      `Auto-closed by \`daemon-auto-close-orphan-prs\` — the task block \`${taskId}\` is no longer in TASKS.md (operator removed or renamed). Closing leaves a paper trail; the daemon's next iteration will pick a different task. If the work is still wanted, re-file the task block with the same ID and the daemon will re-open the PR. See \`scripts/auto-close-orphan-prs.mjs\` for the autonomic-loop rationale.`,
    ],
    { encoding: "utf8" },
  );
}

/**
 * Execute the decisions via the injected I/O seams.
 *
 * @param {readonly OrphanCloseDecision[]} decisions
 * @param {{
 *   closeFn: (pr: number, taskId: string) => void,
 *   dryRun: boolean,
 * }} io
 * @returns {readonly { pr: number, taskId: string, outcome: "closed" | "skipped" | "dry-run", reason: string }[]}
 */
export function executeOrphanCloses(decisions, { closeFn, dryRun }) {
  /** @type {{ pr: number, taskId: string, outcome: "closed" | "skipped" | "dry-run", reason: string }[]} */
  const outcomes = [];
  for (const d of decisions) {
    if (d.action === "skip") {
      outcomes.push({ pr: d.pr, taskId: d.taskId, outcome: "skipped", reason: d.reason });
      continue;
    }
    if (dryRun) {
      outcomes.push({
        pr: d.pr,
        taskId: d.taskId,
        outcome: "dry-run",
        reason: `would close: ${d.reason}`,
      });
      continue;
    }
    closeFn(d.pr, d.taskId);
    outcomes.push({ pr: d.pr, taskId: d.taskId, outcome: "closed", reason: d.reason });
  }
  return outcomes;
}

/* v8 ignore start */
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const disable = (process.env["MINSKY_AUTO_CLOSE_ORPHAN_PRS"] ?? "on").toLowerCase();
  if (["off", "false", "0", "no"].includes(disable)) {
    process.stdout.write(
      "daemon-auto-close-orphan-prs: disabled via MINSKY_AUTO_CLOSE_ORPHAN_PRS\n",
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
  const tasksMdContent = await readFile(resolve(REPO, "TASKS.md"), "utf8").catch(() => "");
  const daemonOpenedTaskIds = await loadDaemonOpenedTaskIds(REPO);
  const decisions = decideOrphanClose(prs, { tasksMdContent, daemonOpenedTaskIds, limit });
  const outcomes = executeOrphanCloses(decisions, {
    closeFn: closeOrphanPrViaGh,
    dryRun,
  });
  const rollup = {
    closed: outcomes.filter((o) => o.outcome === "closed").length,
    skipped: outcomes.filter((o) => o.outcome === "skipped").length,
    dryRun: outcomes.filter((o) => o.outcome === "dry-run").length,
  };
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ outcomes, rollup }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `daemon-auto-close-orphan-prs: ${rollup.closed} closed · ${rollup.skipped} skipped${dryRun ? ` · ${rollup.dryRun} dry-run` : ""}\n`,
    );
    for (const o of outcomes) {
      process.stdout.write(
        `  #${o.pr} (${o.taskId || "no-task-id"}): ${o.outcome} — ${o.reason}\n`,
      );
    }
  }
  process.exit(0);
}
/* v8 ignore stop */
