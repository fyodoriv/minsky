#!/usr/bin/env node
// Pattern: invariant-runner (Liskov 1987 — invariants as the substrate of
// correctness; Brilliant et al. 1990 — N-version programming, where one
// version probes the other for disagreement). Self-diagnose probes the
// running Minsky for invariant violations a normal supervisor wouldn't
// surface; findings escalate via TASKS.md so the parent (`/next-task`)
// picks them up automatically.
//
// Source: 2026-05-04 dogfood debug — TokenMonitor was summing
// cache_read_input_tokens at full rate, pegging every plan to 100%, and
// every iteration logged `budget-paused`. The bug was visible in
// supervisor logs but no automation noticed; the operator did. The
// self-diagnose pattern asks: what invariant would have caught that?
// → "if all 4 plans read 100% used, the sum is wrong". Encoded below.
//
// Conformance: full — pure runner + injectable invariants (rule #2
// Strategy seam); deterministic given the same probe outputs (rule
// #10); each invariant carries its own anchor + suggested task title +
// suggested fix (rule #9 — pre-registered hypothesis at the moment of
// detection, not after).
//
// Pivot (rule #9): if the invariants produce ≥1 false-positive task per
// week (e.g., a transient probe failure during start-up that resolves
// on retry), add a `consecutiveFailures: 2` retry gate before
// surfacing — the false-positive rate, not the architecture, is what
// would change.

import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { MaciekTokenMonitor, PLAN_CAPS } from "@minsky/token-monitor";
import {
  buildRecentPrListGhArgs,
  CANONICAL_REPO,
  parsePrListEntries,
  ROLLING_30D_MIN_N,
  ROLLING_30D_MIN_PASS_RATE,
  ROLLING_WINDOW_DAYS,
} from "./daemon-pr-lint-metrics.mjs";
import { MODEL_CATALOG, validateModelCatalog } from "./lib/model-catalog.mjs";

const execFileAsync = promisify(execFile);

/**
 * @typedef {object} InvariantOk
 * @property {string} id
 * @property {true} ok
 *
 * @typedef {"minsky" | "operator" | "minsky-then-operator"} Actor
 *  — "minsky"               = the daemon auto-handles on next iteration; no operator action
 *  — "operator"             = the operator must act; the daemon will keep flagging this
 *  — "minsky-then-operator" = the daemon attempts an auto-resolution first; if it fails the operator must intervene
 *
 * @typedef {object} InvariantViolation
 * @property {string} id
 * @property {false} ok
 * @property {string} evidence — human-readable proof of the violation
 * @property {string} suggestedTaskTitle — one-line title for TASKS.md
 * @property {string} suggestedFix — one-paragraph hypothesis for the fix
 * @property {Actor} [actor] - who acts on this finding (defaults to "operator" if absent; operator directive 2026-05-26: make it clear whether we need an intervention or do we expect minsky to fix the problem in logs)
 *
 * @typedef {InvariantOk | InvariantViolation} InvariantResult
 *
 * @typedef {() => Promise<InvariantResult>} Invariant
 */

/**
 * Render the actor label as a one-line `[<emoji> <verb>]` prefix for log lines.
 * Stable text — log scrapers grep on the bracketed text, not the emoji.
 *
 * @param {Actor | undefined} actor
 * @returns {string}
 */
export function actorLabel(actor) {
  switch (actor ?? "operator") {
    case "minsky":
      return "[🤖 minsky-will-fix]";
    case "minsky-then-operator":
      return "[🤖→👤 minsky-tries-then-operator]";
    case "operator":
      return "[👤 needs-operator]";
  }
}

/**
 * Pure runner — runs every invariant; returns the violations list.
 * Exceptions inside an invariant become violations with `evidence` =
 * the error message (rule #7 — graceful-degrade, explicit not silent).
 *
 * Tests inject a synthetic `invariants` array; production calls
 * {@link defaultInvariants}.
 *
 * @param {readonly Invariant[]} invariants
 * @returns {Promise<InvariantViolation[]>}
 */
export async function runInvariants(invariants) {
  /** @type {InvariantViolation[]} */
  const findings = [];
  for (const invariant of invariants) {
    /** @type {InvariantResult} */
    let result;
    try {
      result = await invariant();
    } catch (err) {
      const id =
        /** @type {{ invariantId?: string, name?: string }} */ (invariant).invariantId ??
        invariant.name ??
        "<anonymous>";
      const message = err instanceof Error ? err.message : String(err);
      findings.push({
        id,
        ok: false,
        // Probe-itself-broken always requires operator action — minsky
        // can't fix its own diagnostic instrument.
        actor: "operator",
        evidence: `invariant threw: ${message}`,
        suggestedTaskTitle: `self-diagnose: ${id} probe is itself broken`,
        suggestedFix: `The probe for invariant ${id} threw before it could decide. Either the probe is wrong or its inputs (env, file paths, network) drifted. Read the probe at scripts/self-diagnose.mjs and the throwing site in the tracelog above.`,
      });
      continue;
    }
    if (!result.ok) findings.push(result);
  }
  return findings;
}

/**
 * @typedef {import("../novel/adapters/token-monitor/dist/index.d.ts").TokenSnapshot} TokenSnapshot
 *
 * @typedef {object} TokenMonitorInvariantOpts
 * @property {(plan: "pro"|"max5"|"max20"|"custom") => Promise<TokenSnapshot>} snapshotPerPlan
 */

/**
 * Seed invariant: when MaciekTokenMonitor reports every plan at 100 %
 * used, the sum is almost certainly wrong (the user can't simultaneously
 * have over-spent pro+max5+max20+custom — those plans have ~12× spread).
 *
 * Concretely: we read the live snapshot for each plan and check whether
 * any plan has remaining > 0. If all four are pegged to 0, the
 * active-block sum is overshooting in a unit-mismatched way.
 *
 * Strategy seam: `snapshotPerPlan` is injected so tests can drive the
 * decision function with synthetic snapshots without touching disk.
 *
 * @param {TokenMonitorInvariantOpts} opts
 * @returns {Invariant}
 */
export function tokenMonitorNotAllPeggedInvariant(opts) {
  const { snapshotPerPlan } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    /** @type {readonly ("pro"|"max5"|"max20"|"custom")[]} */
    const planNames = ["pro", "max5", "max20", "custom"];
    /** @type {{ plan: "pro"|"max5"|"max20"|"custom", remaining: number }[]} */
    const snapshots = [];
    for (const plan of planNames) {
      const s = await snapshotPerPlan(plan);
      snapshots.push({ plan, remaining: s.tokensRemainingInWindow });
    }
    const allPegged = snapshots.every((s) => s.remaining === 0);
    if (!allPegged) return { id: "token-monitor-not-all-pegged", ok: true };
    const evidence = snapshots
      .map((s) => `${s.plan}: cap=${PLAN_CAPS[s.plan]}, remaining=${s.remaining}`)
      .join("; ");
    return {
      id: "token-monitor-not-all-pegged",
      ok: false,
      evidence,
      suggestedTaskTitle:
        "token-monitor reports every plan at 100% used — sum or cap is unit-mismatched",
      suggestedFix:
        "MaciekTokenMonitor is summing more tokens than the 5h cap allows on every plan simultaneously. Two known causes: (1) cache_read_input_tokens being summed at full rate (fixed in PR #155 — verify the build includes it), or (2) PLAN_CAPS still calibrated to Maciek upstream's outdated estimates (max20=220k vs Anthropic's actual ~50M+/5h). Inspect the active-block raw token breakdown via `node scripts/inspect-active-block.mjs` (or the inline probe in PR #155's commit body) and either patch the sum or recalibrate PLAN_CAPS.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "token-monitor-not-all-pegged";
  return fn;
}

/**
 * @typedef {object} ClaudeBinaryInvariantOpts
 * @property {(name: string) => Promise<{ ok: boolean }>} probe — returns
 *   `{ ok: true }` when the binary is reachable from the current PATH;
 *   `{ ok: false }` otherwise. Tests inject a fake; production calls
 *   `claude --version`.
 */

/**
 * Invariant: the `claude` CLI must be reachable from the supervisor's
 * PATH. The tick-loop spawns `claude --print` per iteration; a missing
 * binary triggers `ENOENT`, which the daemon surfaces as an unhandled
 * exception → process exit → launchd respawn loop at `ThrottleInterval`
 * cadence. This invariant catches the failure at boot, so the operator
 * sees a one-line task instead of a 12-times-per-minute respawn loop.
 *
 * Live observed 2026-05-04 during the post-#158 dogfood restart: the
 * launchd minimal PATH didn't include `~/.local/bin`, so the CLI wasn't
 * found and tick-loop crashed on its first spawn.
 *
 * Strategy seam: `probe` is injected so tests can simulate
 * available/unavailable without touching the real CLI.
 *
 * @param {ClaudeBinaryInvariantOpts} opts
 * @returns {Invariant}
 */
export function claudeBinaryReachableInvariant(opts) {
  const { probe } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const result = await probe("claude");
    if (result.ok) return { id: "claude-binary-reachable", ok: true };
    return {
      id: "claude-binary-reachable",
      ok: false,
      evidence:
        "the `claude` CLI is not reachable from the supervisor's PATH; spawning it raises ENOENT.",
      suggestedTaskTitle:
        "supervisor cannot find the `claude` CLI on its PATH — every iteration crashes",
      suggestedFix:
        "Locate the `claude` binary (`which claude` from your shell) and ensure its directory is on the launchd / systemd-user PATH. The supervisor bootstrap (`distribution/systemd/run-tick-loop.sh`) extends PATH with common installer locations (~/.local/bin, ~/.npm-global/bin, /opt/homebrew/bin, /usr/local/bin) — if your install lives elsewhere, add it to that loop. Without this fix the daemon ENOENT-crashes on first iteration and launchd respawns it at ThrottleInterval (5s) indefinitely.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId = "claude-binary-reachable";
  return fn;
}

/**
 * @typedef {object} DaemonIteration
 * @property {string} taskId
 * @property {boolean} committed — true if the iteration produced a git commit
 * @property {string} timestamp — ISO8601
 *
 * @typedef {object} NoopIterationInvariantOpts
 * @property {() => Promise<readonly DaemonIteration[]>} recentIterations - newest-last
 * @property {number} [threshold] - fire when consecutive non-committed iterations on the same taskId reach this count (default 4; observed: the 88-iteration brief-refresh churn before #174)
 */

/**
 * @param {readonly DaemonIteration[]} iters
 * @returns {{ worstRun: number, worstTaskId: string }}
 */
function computeWorstNoopRun(iters) {
  let currentTaskId = "";
  let run = 0;
  let worstRun = 0;
  let worstTaskId = "";
  for (const iter of iters) {
    if (iter.taskId !== currentTaskId) {
      currentTaskId = iter.taskId;
      run = 0;
    }
    if (iter.committed) {
      run = 0;
      continue;
    }
    run++;
    if (run > worstRun) {
      worstRun = run;
      worstTaskId = iter.taskId;
    }
  }
  return { worstRun, worstTaskId };
}

/**
 * Throughput invariant: the daemon spent ≥`threshold` consecutive
 * iterations on the same task without producing a commit. Surfaces the
 * 2026-05-04 noop pattern that operator-authored #170/#174 caught after
 * 88 iterations of brief-refresh churn — Minsky should have noticed
 * first.
 *
 * @param {NoopIterationInvariantOpts} opts
 * @returns {Invariant}
 */
export function daemonNoopIterationRateInvariant(opts) {
  const { recentIterations, threshold = 4 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const iters = await recentIterations();
    const { worstRun, worstTaskId } = computeWorstNoopRun(iters);
    if (worstRun < threshold) return { id: "daemon-noop-iteration-rate-too-high", ok: true };
    return {
      id: "daemon-noop-iteration-rate-too-high",
      ok: false,
      evidence: `${worstRun} consecutive non-committed iterations on task \`${worstTaskId}\` (threshold ${threshold}).`,
      suggestedTaskTitle: `daemon stuck in noop loop on \`${worstTaskId}\` (${worstRun} iterations, no commits)`,
      suggestedFix:
        "The daemon is iterating without making forward progress on the current task. Two known root causes: (1) the daemon brief is a placeholder string (fixed for tick-loop in PR #174 with `buildDaemonBrief` + FORBIDDEN-noop directive — verify the supervisor's launched binary includes it), or (2) the task is genuinely blocked but missing a `**Blocked**:` marker. Inspect the latest iteration's stdout in `.minsky/tick-loop.out.log`; if no commit hash is present, either tighten the brief or mark the task blocked.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "daemon-noop-iteration-rate-too-high";
  return fn;
}

/**
 * @typedef {object} DaemonPrCiSnapshot
 * @property {number} number
 * @property {string} headRefName
 * @property {number} ciFailureCount — consecutive failed CI runs on HEAD
 * @property {boolean} hasDaemonFixCommitSinceLastFailure — true if a daemon-authored commit landed after the most recent CI failure
 *
 * @typedef {object} StuckOnCiInvariantOpts
 * @property {() => Promise<readonly DaemonPrCiSnapshot[]>} daemonPrs
 * @property {number} [failureThreshold] - fire when `ciFailureCount` reaches this and no fix was committed (default 2)
 */

/**
 * Throughput invariant: a daemon PR has accumulated ≥`failureThreshold`
 * CI failures without the daemon authoring a fix commit. The pattern
 * the operator caught manually on PRs that sat for hours after
 * pre-commit + biome rejected them.
 *
 * @param {StuckOnCiInvariantOpts} opts
 * @returns {Invariant}
 */
export function daemonPrStuckOnCiInvariant(opts) {
  const { daemonPrs, failureThreshold = 2 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const prs = await daemonPrs();
    const stuck = prs.filter(
      (p) => p.ciFailureCount >= failureThreshold && !p.hasDaemonFixCommitSinceLastFailure,
    );
    if (stuck.length === 0) return { id: "daemon-pr-stuck-on-ci-failure", ok: true };
    const evidence = stuck
      .map((p) => `#${p.number} (${p.headRefName}): ${p.ciFailureCount} failures, no fix commit`)
      .join("; ");
    return {
      id: "daemon-pr-stuck-on-ci-failure",
      ok: false,
      evidence,
      suggestedTaskTitle: `daemon PR(s) stuck on CI failure with no fix commit: ${stuck.map((p) => `#${p.number}`).join(", ")}`,
      suggestedFix:
        "One or more daemon-authored PRs have failed CI ≥2 times consecutively and the daemon has not landed a fix commit. The next iteration's brief should resume the failing PR's branch (not start fresh) and address the CI output. Verify `daemon-fix-own-pr-on-ci-failure` (P0) is wired into runIteration's pre-spawn step. Until that ships, the operator should either (a) merge the green portion manually, (b) push a fix commit, or (c) close the PR.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "daemon-pr-stuck-on-ci-failure";
  return fn;
}

/**
 * @typedef {object} ShippedRatioInvariantOpts
 * @property {() => Promise<{ iterationCount: number, shippedPrCount: number }>} rollingStats
 * @property {number} [windowMinIterations] - only evaluate once `iterationCount` reaches this (default 20)
 * @property {number} [minRatio] - fire below this ratio (default 0.05; at least 1 PR per 20 iterations)
 */

/**
 * Throughput invariant: rolling-window shipped-PR / iteration ratio is
 * below `minRatio`. The macro signal of "Minsky is doing work but not
 * shipping". Pre-#174 the session ratio was 0/87.
 *
 * @param {ShippedRatioInvariantOpts} opts
 * @returns {Invariant}
 */
export function daemonShippedRatioInvariant(opts) {
  const { rollingStats, windowMinIterations = 20, minRatio = 0.05 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const { iterationCount, shippedPrCount } = await rollingStats();
    if (iterationCount < windowMinIterations) {
      return { id: "daemon-iteration-vs-shipped-ratio", ok: true };
    }
    const ratio = shippedPrCount / iterationCount;
    if (ratio >= minRatio) return { id: "daemon-iteration-vs-shipped-ratio", ok: true };
    return {
      id: "daemon-iteration-vs-shipped-ratio",
      ok: false,
      evidence: `rolling window: ${shippedPrCount} shipped PRs / ${iterationCount} iterations = ${ratio.toFixed(3)} (threshold ${minRatio}).`,
      suggestedTaskTitle: `daemon shipping ratio ${ratio.toFixed(3)} below ${minRatio} (${shippedPrCount}/${iterationCount})`,
      suggestedFix:
        "The daemon is iterating without shipping at a healthy rate. Likely combinations: (1) noop-iteration loop on the current task — see `daemon-noop-iteration-rate-too-high`, (2) PRs piling up stuck on CI — see `daemon-pr-stuck-on-ci-failure`, (3) tasks too large to ship in one iteration — decompose the picked task into sub-tasks per the next-task skill's decomposition rule. Inspect `gh pr list --author '@me' --state merged --limit 10` for the last shipped PR; if older than the rolling window, the loop is stalling rather than just slow.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "daemon-iteration-vs-shipped-ratio";
  return fn;
}

/**
 * @typedef {object} OpenPrSnapshot
 * @property {number} number
 * @property {string | null} taskId — extracted from PR title or commit messages
 * @property {readonly string[]} files
 *
 * @typedef {object} InFlightCollisionInvariantOpts
 * @property {() => Promise<readonly OpenPrSnapshot[]>} openDaemonPrs
 * @property {number} [overlapThreshold] - fire when file-set overlap exceeds this fraction (default 0.5)
 */

/**
 * @param {readonly OpenPrSnapshot[]} prs
 * @returns {Map<string, OpenPrSnapshot[]>}
 */
function groupPrsByTaskId(prs) {
  /** @type {Map<string, OpenPrSnapshot[]>} */
  const byTask = new Map();
  for (const pr of prs) {
    if (!pr.taskId) continue;
    const list = byTask.get(pr.taskId) ?? [];
    list.push(pr);
    byTask.set(pr.taskId, list);
  }
  return byTask;
}

/**
 * @param {OpenPrSnapshot} a
 * @param {OpenPrSnapshot} b
 * @returns {{ overlap: number, overlapCount: number, denom: number }}
 */
function pairwiseOverlap(a, b) {
  const setA = new Set(a.files);
  const overlapCount = b.files.filter((f) => setA.has(f)).length;
  const denom = Math.min(a.files.length, b.files.length) || 1;
  return { overlap: overlapCount / denom, overlapCount, denom };
}

/**
 * @param {string} taskId
 * @param {readonly OpenPrSnapshot[]} group
 * @param {number} overlapThreshold
 * @returns {string[]}
 */
function findCollisionsInGroup(taskId, group, overlapThreshold) {
  /** @type {string[]} */
  const collisions = [];
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i];
      const b = group[j];
      if (!a || !b) continue;
      const { overlap, overlapCount, denom } = pairwiseOverlap(a, b);
      if (overlap > overlapThreshold) {
        collisions.push(
          `task=${taskId} #${a.number}↔#${b.number} overlap=${overlap.toFixed(2)} (${overlapCount}/${denom})`,
        );
      }
    }
  }
  return collisions;
}

/**
 * @param {Map<string, OpenPrSnapshot[]>} byTask
 * @param {number} overlapThreshold
 * @returns {string[]}
 */
function findCollisions(byTask, overlapThreshold) {
  /** @type {string[]} */
  const collisions = [];
  for (const [taskId, group] of byTask) {
    if (group.length < 2) continue;
    collisions.push(...findCollisionsInGroup(taskId, group, overlapThreshold));
  }
  return collisions;
}

/**
 * Throughput invariant: ≥2 open PRs share the same `taskId` AND have
 * file-set overlap > `overlapThreshold`. Encodes the operator-spotted
 * 2026-05-05 pattern on PRs #180/#181/#182 (3 overlapping PRs for
 * `daily-changelog-for-humans`).
 *
 * @param {InFlightCollisionInvariantOpts} opts
 * @returns {Invariant}
 */
export function daemonInFlightPrCollisionInvariant(opts) {
  const { openDaemonPrs, overlapThreshold = 0.5 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const prs = await openDaemonPrs();
    const byTask = groupPrsByTaskId(prs);
    const collisions = findCollisions(byTask, overlapThreshold);
    if (collisions.length === 0) return { id: "daemon-in-flight-pr-collision", ok: true };
    return {
      id: "daemon-in-flight-pr-collision",
      ok: false,
      evidence: collisions.join("; "),
      suggestedTaskTitle: `${collisions.length} in-flight PR collision(s) — daemon authored overlapping PRs for the same task`,
      suggestedFix:
        "The daemon authored ≥2 PRs targeting the same task with overlapping file-sets. Pre-spawn check missing: `gh pr list --json files,headRefName --search 'is:open author:@me'` should be queried before authoring a new PR; if any open PR for the same `taskId` overlaps the planned file-set by >50%, the daemon should resume that PR's branch instead of opening a new one. Close or supersede the redundant PRs and add the pre-spawn check to runIteration.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "daemon-in-flight-pr-collision";
  return fn;
}

/**
 * @typedef {object} TaskIdStalenessInvariantOpts
 * @property {() => Promise<readonly string[]>} inFlightTaskIds — taskIds the daemon currently has work-in-flight for (open PRs, active branches, claimed tasks)
 * @property {() => Promise<string>} tasksMdContent — full TASKS.md text
 */

/**
 * Throughput invariant: the daemon is iterating on a task whose block
 * has been removed from TASKS.md. The "stale claim" failure mode —
 * daemon keeps spending budget on work the operator already removed.
 *
 * @param {TaskIdStalenessInvariantOpts} opts
 * @returns {Invariant}
 */
export function daemonTaskIdStalenessInvariant(opts) {
  const { inFlightTaskIds, tasksMdContent } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const ids = await inFlightTaskIds();
    if (ids.length === 0) return { id: "daemon-task-id-staleness", ok: true };
    const md = await tasksMdContent();
    const stale = ids.filter((id) => !md.includes(`**ID**: ${id}`));
    if (stale.length === 0) return { id: "daemon-task-id-staleness", ok: true };
    return {
      id: "daemon-task-id-staleness",
      ok: false,
      // 2026-05-26: auto-close orphan PRs landed in
      // `scripts/auto-close-orphan-prs.mjs` + wired into
      // `distribution/systemd/run-tick-loop.sh`. The daemon now closes
      // these on the next supervisor cycle. Operator-action only when
      // the env-var gate is explicitly off OR the auto-close itself
      // fails (rare — `gh pr close` is idempotent).
      actor: "minsky",
      evidence: `in-flight task ids absent from TASKS.md: ${stale.join(", ")}.`,
      suggestedTaskTitle: `daemon iterating on stale task id(s): ${stale.join(", ")}`,
      suggestedFix:
        "The daemon has work-in-flight (open PRs / active branches / claimed task entries) for task ids that no longer have a `**ID**: <id>` block in TASKS.md. **Minsky auto-fix**: `scripts/auto-close-orphan-prs.mjs` runs every supervisor cycle and closes orphan PRs with a paper-trail comment. To disable, set `MINSKY_AUTO_CLOSE_ORPHAN_PRS=off`. If the work is still wanted, re-file the task block with the same ID and the daemon will re-open the PR on its next pick.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId = "daemon-task-id-staleness";
  return fn;
}

/**
 * @typedef {object} ClaudePrintSpawn
 * @property {number} pid
 * @property {number} etimeSeconds — wall-clock seconds since spawn
 * @property {number | null} ppid — parent process id (the supervisor)
 *
 * @typedef {object} StuckIterationInvariantOpts
 * @property {() => Promise<readonly ClaudePrintSpawn[]>} listClaudePrintSpawns - the daemon's child claude --print processes
 * @property {number} [thresholdSeconds] - fire when any spawn's etime exceeds this (default 1800 = 30 min)
 */

/**
 * Throughput invariant: a `claude --print` spawn (the daemon's per-iteration
 * child process) has been alive longer than `thresholdSeconds`. Live observed
 * 2026-05-05: a daemon iteration ran for 2h+ at ~1% CPU with no commit and
 * no error — the brief had grown too analytical (3 discipline gates on top
 * of the original anti-noop guard) and claude was thrashing on tool calls.
 * Operator killed it manually; this invariant catches the same pattern at
 * the next supervisor self-diagnose tick.
 *
 * `suggestedFix` includes the kill command for each detected spawn so an
 * auto-resolution helper (`scripts/kill-stuck-iterations.mjs`) can act on it
 * without re-deriving the pid.
 *
 * Strategy seam: `listClaudePrintSpawns` is injected so tests can drive the
 * decision function with synthetic snapshots without spawning real claude.
 *
 * @param {StuckIterationInvariantOpts} opts
 * @returns {Invariant}
 */
export function daemonIterationRuntimeInvariant(opts) {
  const { listClaudePrintSpawns, thresholdSeconds = 1800 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const spawns = await listClaudePrintSpawns();
    const stuck = spawns.filter((s) => s.etimeSeconds > thresholdSeconds);
    if (stuck.length === 0) return { id: "daemon-iteration-runtime-exceeded", ok: true };
    const evidence = stuck
      .map((s) => `pid=${s.pid} etime=${formatEtime(s.etimeSeconds)} (>${thresholdSeconds}s)`)
      .join("; ");
    const killCmds = stuck.map((s) => `kill ${s.pid}`).join(" && ");
    return {
      id: "daemon-iteration-runtime-exceeded",
      ok: false,
      evidence,
      suggestedTaskTitle: `daemon iteration stuck: ${stuck.length} \`claude --print\` spawn(s) exceeded ${formatEtime(thresholdSeconds)} runtime`,
      suggestedFix: `One or more daemon-spawned \`claude --print\` processes have been alive longer than ${formatEtime(thresholdSeconds)}. Likely cause: brief grew too analytical and claude is thrashing on tool calls. Kill the spawn(s) so the supervisor's launchd respawns the tick fresh: \`${killCmds}\`. The supervisor itself (parent process) is unaffected; only the per-iteration child dies. Pivot if false-positives ≥1/week: raise threshold to ${formatEtime(thresholdSeconds * 2)}. Auto-resolution: \`node scripts/kill-stuck-iterations.mjs\`.`,
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "daemon-iteration-runtime-exceeded";
  return fn;
}

/**
 * @typedef {object} DaemonPrCleanCiSummary
 * @property {number} number
 * @property {boolean} hasFailure — true iff statusCheckRollup currently shows ≥1 check whose conclusion/state is a red terminal outcome (`RED_CHECK_OUTCOMES` in `scripts/daemon-pr-lint-metrics.mjs` — FAILURE/ERROR/TIMED_OUT/STARTUP_FAILURE/ACTION_REQUIRED); shared via `parsePrListEntries`
 *
 * @typedef {object} PrLintPassRateInvariantOpts
 * @property {() => Promise<readonly DaemonPrCleanCiSummary[]>} recentDaemonPrs — rolling window the brief defines (default impl: `ROLLING_WINDOW_DAYS`-day, currently 30d)
 * @property {number} [windowMinPrs] - only evaluate once the window holds this many PRs; defaults to `ROLLING_30D_MIN_N` (currently 10) imported from `scripts/daemon-pr-lint-metrics.mjs` so the metric script and this invariant can never disagree on the warm-up size
 * @property {number} [minPassRate] - fire below this fraction; defaults to `ROLLING_30D_MIN_PASS_RATE` (currently 0.8) imported from `scripts/daemon-pr-lint-metrics.mjs` so both surfaces use the single pre-registered threshold
 */

/**
 * Pre-registered metric for `daemon-pre-pr-lint-gate` (TASKS.md): rolling
 * 30d fraction of daemon-authored PRs whose `statusCheckRollup` carries
 * zero red checks (`RED_CHECK_OUTCOMES` — FAILURE/ERROR/TIMED_OUT/
 * STARTUP_FAILURE/ACTION_REQUIRED, shared via `parsePrListEntries`) must
 * stay ≥ `minPassRate` (0.8).
 * Below that the gate has drifted — either the canonical lint stack
 * (`scripts/run-pre-pr-lint-stack.mjs`) is missing a check CI runs, or
 * the daemon brief stopped honoring `pnpm pre-pr-lint` before
 * `gh pr create`. Either way the operator gets a TASKS.md block on the
 * next supervisor self-diagnose tick.
 *
 * Strategy seam: `recentDaemonPrs` is injected so tests can drive the
 * decision function without shelling out to gh; production calls
 * `gh pr list --author @me --state all --search "created:>=<30d>"`.
 *
 * @param {PrLintPassRateInvariantOpts} opts
 * @returns {Invariant}
 */
export function daemonPrLintPassRateInvariant(opts) {
  const {
    recentDaemonPrs,
    windowMinPrs = ROLLING_30D_MIN_N,
    minPassRate = ROLLING_30D_MIN_PASS_RATE,
  } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const prs = await recentDaemonPrs();
    if (prs.length < windowMinPrs) {
      return { id: "daemon-pr-lint-pass-rate", ok: true };
    }
    const cleanCount = prs.filter((p) => !p.hasFailure).length;
    const passRate = cleanCount / prs.length;
    if (passRate >= minPassRate) return { id: "daemon-pr-lint-pass-rate", ok: true };
    const dirty = prs.filter((p) => p.hasFailure).map((p) => `#${p.number}`);
    return {
      id: "daemon-pr-lint-pass-rate",
      ok: false,
      evidence: `rolling window: ${cleanCount} clean / ${prs.length} daemon PRs = ${passRate.toFixed(3)} (threshold ${minPassRate}). Failed: ${dirty.join(", ")}.`,
      suggestedTaskTitle: `daemon PR lint pass-rate ${passRate.toFixed(3)} below ${minPassRate} (${cleanCount}/${prs.length} clean)`,
      suggestedFix:
        "The pre-PR lint gate has drifted from CI. Two known root causes: (1) `scripts/run-pre-pr-lint-stack.mjs` is missing a check that CI's `needs:` aggregator runs — diff the script's manifest against `.github/workflows/ci.yml` and add the missing step; (2) the daemon brief's `pnpm pre-pr-lint` mandate is being skipped — inspect `novel/tick-loop/src/daemon.ts`'s `buildDaemonBrief` to confirm the directive is still emitted, and check recent iteration logs in `.minsky/tick-loop.out.log` for the `pre-pr-lint-failures: <step>` noop-exit string. If neither is the cause, the threshold may be too aggressive — pivot per the task block to a staged gate (fast lints pre-PR, slow lints CI-only).",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId = "daemon-pr-lint-pass-rate";
  return fn;
}

/**
 * @typedef {object} GitConfigParseableInvariantOpts
 * @property {() => Promise<{ ok: boolean, durationMs: number, stderr?: string }>} probeGitStatus - runs `git status` (or equiv) under a tight timeout
 * @property {() => Promise<readonly { line: number, marker: string }[]>} scanGitConfigForConflicts - probes ~/.gitconfig for merge-conflict markers
 * @property {() => Promise<boolean>} [probeGitBare] - reads `git config core.bare`; resolves true when set to `true`. Optional so existing callers/tests stay valid.
 * @property {() => Promise<number>} [probeGitWorktreeCount] - counts entries under `.git/worktrees/`; >0 means a working tree coexists with a bare flag. Optional.
 * @property {number} [timeoutMs] - declare broken if git status takes longer than this (default 5000)
 */

/**
 * Bare-misset detection (task minsky-repo-git-config-bare-misset): when
 * `git status` fails with `fatal: this operation must be run in a work tree`
 * the historic fix was a blind `rm .git/index.lock` — but the index isn't
 * locked. The mechanically-diagnostic combination is `core.bare = true` AND
 * >=1 entry under `.git/worktrees/` (a working tree coexisting with the bare
 * flag). When both hold, the correct one-line fix is `git config core.bare
 * false`. Only probed on the work-tree-error path so a parse-error /
 * conflict-marker failure keeps its existing, more-specific fix.
 *
 * @param {{ ok: boolean, durationMs: number, stderr?: string }} result
 * @param {readonly { line: number, marker: string }[]} markers
 * @param {(() => Promise<boolean>) | undefined} probeGitBare
 * @param {(() => Promise<number>) | undefined} probeGitWorktreeCount
 * @returns {Promise<InvariantViolation | null>}
 */
async function diagnoseBareMissetFailure(result, markers, probeGitBare, probeGitWorktreeCount) {
  const isWorkTreeError = !result.ok && /must be run in a work tree/i.test(result.stderr ?? "");
  if (!(markers.length === 0 && isWorkTreeError && probeGitBare && probeGitWorktreeCount)) {
    return null;
  }
  const bare = await probeGitBare();
  const worktreeCount = bare ? await probeGitWorktreeCount() : 0;
  if (!(bare && worktreeCount > 0)) return null;
  return {
    id: "git-config-parseable",
    ok: false,
    evidence: `git status failed: ${result.stderr ?? "unknown error"}. Diagnosed: \`core.bare = true\` with ${worktreeCount} active worktree(s) under .git/worktrees/ — a working tree coexists with the bare flag, so git refuses every work-tree op.`,
    suggestedTaskTitle: "git config core.bare is true but a working tree exists — flip it back",
    suggestedFix:
      "core.bare is set true on a repo that has a working tree (active .git/worktrees/ entries). The index lock is NOT the issue. Fix: `git config core.bare false`. Then verify: `git status` succeeds.",
  };
}

/**
 * Build the non-bare-misset failure result for the git-config-parseable
 * invariant: a slow-but-ok `git status`, or a non-zero/timeout failure,
 * optionally annotated with ~/.gitconfig conflict markers.
 *
 * @param {{ ok: boolean, durationMs: number, stderr?: string }} result
 * @param {readonly { line: number, marker: string }[]} markers
 * @param {number} timeoutMs
 * @returns {InvariantViolation}
 */
function buildGitStatusFailureResult(result, markers, timeoutMs) {
  const markerEvidence =
    markers.length > 0
      ? ` Conflict markers in ~/.gitconfig: ${markers.map((m) => `line ${m.line} (${m.marker})`).join(", ")}.`
      : "";
  const evidence = result.ok
    ? `git status took ${result.durationMs}ms (>${timeoutMs}ms threshold).${markerEvidence}`
    : `git status failed (exit non-zero or timeout): ${result.stderr ?? "unknown error"}.${markerEvidence}`;
  const fixCmd =
    markers.length > 0
      ? "Resolve the conflict markers in ~/.gitconfig: `python3 -c \"import re; p='/Users/$(whoami)/.gitconfig'; s=open(p).read(); s=re.sub(r'<<<<<<<.*?=======\\\\n(.*?)>>>>>>>.*?\\\\n', r'\\\\1', s, flags=re.S); open(p,'w').write(s)\"` (keeps the post-====== branch). Then verify: `git status` succeeds in <1s."
      : "git status is failing or slow but no conflict markers found in ~/.gitconfig. Likely cause: corrupt `.git/index` or stale lock. Run `rm .git/index.lock 2>/dev/null; git status` and inspect the output.";
  return {
    id: "git-config-parseable",
    ok: false,
    evidence,
    suggestedTaskTitle: "git status is broken — supervisor's git ops will fail on next respawn",
    suggestedFix: fixCmd,
  };
}

/**
 * Live-fire invariant: `git status` must exit cleanly within `timeoutMs`.
 * Live observed 2026-05-06: a stash-apply left unresolved merge markers in
 * `~/.gitconfig` line 100; every `git`/`gh` command in the operator's
 * foreground session failed with `bad config line 100`, blocking PR
 * shipping for hours. The supervisor's daemon process (started before the
 * conflict) kept the parsed config in memory and continued shipping,
 * masking the failure. This invariant catches the next supervisor respawn
 * before it grounds the daemon.
 *
 * Auto-resolution path: when `scanGitConfigForConflicts` returns ≥1 marker
 * line, the suggestedFix names the exact `python3` (or `git mergetool`)
 * fix command. Operators can wire `kill-stuck-iterations.mjs`-style helper
 * to apply the fix automatically.
 *
 * @param {GitConfigParseableInvariantOpts} opts
 * @returns {Invariant}
 */
export function gitConfigParseableInvariant(opts) {
  const {
    probeGitStatus,
    scanGitConfigForConflicts,
    probeGitBare,
    probeGitWorktreeCount,
    timeoutMs = 5000,
  } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const result = await probeGitStatus();
    if (result.ok && result.durationMs <= timeoutMs) {
      return { id: "git-config-parseable", ok: true };
    }
    const markers = await scanGitConfigForConflicts();
    const bareMisset = await diagnoseBareMissetFailure(
      result,
      markers,
      probeGitBare,
      probeGitWorktreeCount,
    );
    if (bareMisset) return bareMisset;
    return buildGitStatusFailureResult(result, markers, timeoutMs);
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId = "git-config-parseable";
  return fn;
}

/**
 * @typedef {object} OpenDaemonPrSnapshotForDirty
 * @property {number} number
 * @property {string} mergeableState - GitHub's mergeable_state field: clean | dirty | blocked | behind | unstable | unknown
 * @property {number} ageHours - hours since the PR's head commit was authored
 *
 * @typedef {object} DaemonPrStuckDirtyInvariantOpts
 * @property {() => Promise<readonly OpenDaemonPrSnapshotForDirty[]>} openDaemonPrs
 * @property {number} [maxAgeHours] - fire when any PR has been dirty/conflicting for longer than this (default 2)
 */

/**
 * Throughput invariant: a daemon-authored PR has been in `dirty` (merge
 * conflict) state for ≥ `maxAgeHours`. Distinct from
 * `daemon-pr-stuck-on-ci-failure` (CI-failure-based) — this catches the
 * silent-rebase-needed failure mode observed 2026-05-06 where #227 sat
 * dirty for 6+ hours after #228 merged its imports first; daemon never
 * rebased because no CI failure ever fired.
 *
 * Auto-resolution path: watchdog can run `gh pr update-branch <n>` for
 * each finding to attempt automatic rebase.
 *
 * @param {DaemonPrStuckDirtyInvariantOpts} opts
 * @returns {Invariant}
 */
export function daemonPrStuckDirtyInvariant(opts) {
  const { openDaemonPrs, maxAgeHours = 2 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const prs = await openDaemonPrs();
    const stuck = prs.filter((p) => p.mergeableState === "dirty" && p.ageHours >= maxAgeHours);
    if (stuck.length === 0) return { id: "daemon-pr-stuck-dirty", ok: true };
    const evidence = stuck
      .map((p) => `#${p.number} dirty for ${p.ageHours.toFixed(1)}h (>${maxAgeHours}h)`)
      .join("; ");
    const updateCmds = stuck.map((p) => `gh pr update-branch ${p.number}`).join(" && ");
    return {
      id: "daemon-pr-stuck-dirty",
      ok: false,
      // 2026-05-26: auto-rebase landed in
      // `scripts/auto-rebase-dirty-prs.mjs` + wired into the
      // supervisor. The daemon now runs `gh pr update-branch` on every
      // cycle; if that succeeds, the PR transitions to MERGEABLE and CI
      // re-triggers. If `gh pr update-branch` fails with conflicts, the
      // daemon escalates to close-as-superseded automatically. Both
      // paths are gated by `MINSKY_AUTO_REBASE_DIRTY_PRS` (default on).
      // The "minsky-then-operator" actor signals: minsky tries first; if
      // both the rebase AND the close-superseded fail (unlikely — `gh`
      // returning non-zero on a transient network/auth issue), the
      // operator may need to clear the PR manually. In practice that's
      // a rare failure mode.
      actor: "minsky-then-operator",
      evidence,
      suggestedTaskTitle: `${stuck.length} daemon PR(s) stuck dirty (merge conflict) for >${maxAgeHours}h`,
      suggestedFix: `One or more daemon-authored PRs have been in DIRTY (merge-conflict) state for >${maxAgeHours}h. **Minsky auto-fix**: \`scripts/auto-rebase-dirty-prs.mjs\` runs every supervisor cycle and (a) tries \`gh pr update-branch\`, (b) escalates to close-as-superseded on conflict. To disable, set \`MINSKY_AUTO_REBASE_DIRTY_PRS=off\`. Manual fallback: \`${updateCmds}\` (only needed if both auto-paths hit a transient \`gh\` error). Pivot if auto-close-superseded false-positives ≥1/week: raise threshold to 4h.`,
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId = "daemon-pr-stuck-dirty";
  return fn;
}

/**
 * @typedef {object} DaemonPrStuckConflictingInvariantOpts
 * @property {() => Promise<readonly OpenDaemonPrSnapshotForDirty[]>} openDaemonPrs
 * @property {number} [maxAgeHours] - fire when any PR has been conflicting for longer than this (default 2)
 */

/**
 * Throughput invariant: a daemon-authored PR has been in `conflicting`
 * (GitHub-computed merge conflict against the advanced base) state for
 * ≥ `maxAgeHours`. The watchdog-extension sibling of
 * `daemon-pr-stuck-dirty` — DIRTY is the locally-computed conflict;
 * CONFLICTING is GitHub's `mergeStateStatus` when `main` advanced under
 * the PR. A long monitoring window found CONFLICTING-stuck PRs were the
 * #1 manual-unblock class, yet only `dirty` was surfaced — so the MAPE-K
 * analyse step never saw the conflicting population the
 * `scripts/auto-rebase-dirty-prs.mjs` Execute step now acts on.
 *
 * Auto-resolution path: the same `scripts/auto-rebase-dirty-prs.mjs`
 * watchdog rebases-or-closes CONFLICTING PRs identically to DIRTY ones.
 *
 * @param {DaemonPrStuckConflictingInvariantOpts} opts
 * @returns {Invariant}
 */
export function daemonPrStuckConflictingInvariant(opts) {
  const { openDaemonPrs, maxAgeHours = 2 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const prs = await openDaemonPrs();
    const stuck = prs.filter(
      (p) => p.mergeableState === "conflicting" && p.ageHours >= maxAgeHours,
    );
    if (stuck.length === 0) return { id: "daemon-pr-stuck-conflicting", ok: true };
    const evidence = stuck
      .map((p) => `#${p.number} conflicting for ${p.ageHours.toFixed(1)}h (>${maxAgeHours}h)`)
      .join("; ");
    const updateCmds = stuck.map((p) => `gh pr update-branch ${p.number}`).join(" && ");
    return {
      id: "daemon-pr-stuck-conflicting",
      ok: false,
      // Same actor signal as `daemon-pr-stuck-dirty`: minsky tries the
      // rebase-or-close first; the operator only steps in if both the
      // `gh pr update-branch` AND the close-superseded escalation hit a
      // transient `gh` error — a rare failure mode.
      actor: "minsky-then-operator",
      evidence,
      suggestedTaskTitle: `${stuck.length} daemon PR(s) stuck conflicting for >${maxAgeHours}h`,
      suggestedFix: `One or more daemon-authored PRs have been in CONFLICTING (base advanced under them) state for >${maxAgeHours}h. **Minsky auto-fix**: \`scripts/auto-rebase-dirty-prs.mjs\` treats CONFLICTING like DIRTY — it (a) tries \`gh pr update-branch\`, (b) escalates to close-as-superseded on conflict. To disable, set \`MINSKY_AUTO_REBASE_DIRTY_PRS=off\`. Manual fallback: \`${updateCmds}\`. Pivot if >50% of CONFLICTING PRs can't be rebased: degrade to soft-escalation (file \`Blocked: needs-operator-rebase\`).`,
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "daemon-pr-stuck-conflicting";
  return fn;
}

/**
 * @typedef {object} OpenDaemonPrSnapshotForThrash
 * @property {number} number
 * @property {number} commitCount - number of commits stacked on the PR head
 * @property {number} ageHours - hours since the PR was created
 * @property {string} mergeable - GitHub's mergeable field: MERGEABLE | CONFLICTING | UNKNOWN
 *
 * @typedef {object} DaemonPrThrashInvariantOpts
 * @property {() => Promise<readonly OpenDaemonPrSnapshotForThrash[]>} openDaemonPrs
 * @property {number} [maxCommits] - fire when a non-MERGEABLE PR exceeds this commit count (default 5)
 * @property {number} [maxAgeHours] - …and this wall-clock age in hours (default 2)
 */

/**
 * Throughput invariant: a daemon-authored PR keeps accumulating commits
 * without ever merging because it stays non-MERGEABLE — the
 * "optimize-thrash" pattern. Live observed 9h window 2026-05-07: worker-1
 * stacked 11+ brief-compression commits onto PR #322 over ~5h while the PR
 * stayed CONFLICTING, stranding ~−4,195 bytes/iter of token savings that
 * never landed. Distinct from `daemon-pr-stuck-dirty` (age-of-dirtiness
 * only) and `daemon-task-scope-explosion` (merged-PR count) — this catches
 * the *single stuck PR being polished in place* failure mode before the
 * wasted commits compound.
 *
 * @param {DaemonPrThrashInvariantOpts} opts
 * @returns {Invariant}
 */
export function daemonPrThrashInvariant(opts) {
  const { openDaemonPrs, maxCommits = 5, maxAgeHours = 2 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const prs = await openDaemonPrs();
    const thrashed = prs.filter(
      (p) => p.commitCount > maxCommits && p.ageHours > maxAgeHours && p.mergeable !== "MERGEABLE",
    );
    if (thrashed.length === 0) return { id: "daemon-pr-thrash", ok: true };
    const evidence = thrashed
      .map(
        (p) => `#${p.number}: ${p.commitCount} commits, ${p.ageHours.toFixed(1)}h, ${p.mergeable}`,
      )
      .join("; ");
    const list = thrashed.map((p) => `#${p.number}`).join(", ");
    return {
      id: "daemon-pr-thrash",
      ok: false,
      evidence,
      suggestedTaskTitle: `${thrashed.length} daemon PR(s) thrashing: >${maxCommits} commits + >${maxAgeHours}h age + not MERGEABLE`,
      suggestedFix: `Optimize-thrash detected (PR #322 pattern, 9h window 2026-05-07): ${list} accumulated >${maxCommits} commits over >${maxAgeHours}h without merging because the PR is not MERGEABLE. The daemon's next pick of the matching task ID must rebase ${list} or close it; do NOT add more commits to a stuck PR. Auto-resolution: \`gh pr update-branch <n>\` then re-trigger CI; if conflicts persist, close as superseded and open a fresh PR. Pivot if legitimate long-lived substrate work false-positives ≥1/week: raise to 10 commits / 4h.`,
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId = "daemon-pr-thrash";
  return fn;
}

/**
 * @typedef {object} DaemonTaskScopeInvariantOpts
 * @property {() => Promise<ReadonlyMap<string, number>>} mergedPrCountByTaskId - rolling-24h count of daemon-merged PRs grouped by taskId
 * @property {number} [threshold] - fire when any taskId crosses this (default 6)
 */

/**
 * Throughput invariant: a single taskId has shipped ≥`threshold` daemon
 * PRs in the last 24h. Live observed 2026-05-06: `daemon-pre-pr-lint-gate`
 * shipped 18 slices in ~6h — slices 10+ were single-source-of-truth
 * refactors and parity tests that could have been ≤3 bundled PRs. Each
 * slice individually committed (so `daemon-noop-iteration-rate-too-high`
 * never fired) and individually shipped (so `daemon-iteration-vs-shipped-
 * ratio` stayed healthy) — but the operator's read-time was wasted on
 * tiny PRs.
 *
 * @param {DaemonTaskScopeInvariantOpts} opts
 * @returns {Invariant}
 */
export function daemonTaskScopeExplosionInvariant(opts) {
  const { mergedPrCountByTaskId, threshold = 6 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const counts = await mergedPrCountByTaskId();
    /** @type {[string, number][]} */
    const exploded = [];
    for (const [taskId, count] of counts) {
      if (count >= threshold) exploded.push([taskId, count]);
    }
    if (exploded.length === 0) return { id: "daemon-task-scope-explosion", ok: true };
    const evidence = exploded.map(([id, n]) => `${id}: ${n} PRs/24h`).join("; ");
    const top = exploded[0];
    const topId = top?.[0] ?? "<unknown>";
    return {
      id: "daemon-task-scope-explosion",
      ok: false,
      evidence,
      suggestedTaskTitle: `daemon scope-explosion: ${exploded.length} task(s) shipped ≥${threshold} PRs in 24h`,
      suggestedFix: `One or more taskIds have shipped ≥${threshold} daemon PRs in 24h — likely the task is done but the block is still in TASKS.md, OR the daemon is over-slicing. Action: (1) check whether the task's Acceptance criteria are met on main; if yes, close the task block (operator-curated cleanup, same pattern as PR #195 / #217). (2) If acceptance is genuinely incomplete, the daemon brief should bundle related slices — extend \`buildDaemonBrief\` with a "bundle similar slices" directive. Concrete: file \`chore(tasks): close ${topId}\` PR.`,
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "daemon-task-scope-explosion";
  return fn;
}

/**
 * @typedef {object} ClaudePrintTimeoutInvariantOpts
 * @property {() => Promise<number>} countTimeoutsInRollingWindow - total `claude-print-timeout` log occurrences across worker logs in the rolling 7d window
 * @property {number} [threshold] - fire when count exceeds this (default 14 = 2/day average across workers)
 */

/**
 * Throughput invariant: the rolling 7d count of `claude-print-timeout`
 * log entries across worker logs exceeds the operator's tolerance
 * (default 14 = 2/day average across workers). Encodes the 2026-05-07
 * monitoring window — a single 1h 56min hang silently lost ~24
 * iterations of throughput because the daemon parent waited
 * indefinitely on a stuck child. The `daemon-claude-print-hang-watchdog`
 * task added a `timeoutMs` watchdog to `ProcessSpawnStrategy.spawn`
 * (default 30 min, env-overridable via `MINSKY_CLAUDE_PRINT_TIMEOUT_MS`)
 * that SIGKILLs hung children. The visible-not-silent failure mode is
 * now `claude-print-timeout: <ms>ms` in the iteration log — but if
 * those start firing too often, the timeout is too aggressive (Beyer
 * SRE 2016 Ch. 6 — silence is failure, but a chatty false-positive is
 * also a failure mode). This invariant closes the loop by surfacing the
 * over-aggressive-timeout case as a daemon-pickable task.
 *
 * Closes Acceptance criterion (e) of `daemon-claude-print-hang-watchdog`.
 *
 * @param {ClaudePrintTimeoutInvariantOpts} opts
 * @returns {Invariant}
 */
export function claudePrintTimeoutFrequencyInvariant(opts) {
  const { countTimeoutsInRollingWindow, threshold = 14 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const count = await countTimeoutsInRollingWindow();
    if (count <= threshold) return { id: "claude-print-timeout-frequency", ok: true };
    return {
      id: "claude-print-timeout-frequency",
      ok: false,
      evidence: `${count} \`claude-print-timeout\` events in rolling 7d window (threshold ${threshold} = 2/day across workers).`,
      suggestedTaskTitle: `claude --print timeouts firing too often (${count} in 7d, threshold ${threshold})`,
      suggestedFix:
        "The spawn-strategy `timeoutMs` watchdog is killing children too aggressively. Options: (1) raise `MINSKY_CLAUDE_PRINT_TIMEOUT_MS` from the default 30min if the workload genuinely needs longer iterations (likely if a few tasks are large-refactor sized); (2) inspect the per-iteration logs for the killed children — if they were genuinely hung (no progress for 5min+), the timeout is correct and the underlying child needs the fix (e.g., `claude --print` retry-with-backoff inside the spawn). Concretely: `grep -B 5 'claude-print-timeout' .minsky/workers/*.log | head -50` shows what each killed child was doing right before SIGKILL.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "claude-print-timeout-frequency";
  return fn;
}

/**
 * Format seconds as `<H>h<M>m<S>s` short form. Used in evidence and
 * suggestedFix rendering for human readability.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatEtime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

/**
 * Default probe: spawns `<name> --version` and resolves based on exit code.
 *
 * @param {string} name
 * @returns {Promise<{ ok: boolean }>}
 */
async function spawnVersionProbe(name) {
  try {
    await execFileAsync(name, ["--version"], { timeout: 5_000 });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Production probe for `claudePrintTimeoutFrequencyInvariant`: counts
 * `claude-print-timeout` substring occurrences across all worker log
 * files (`.minsky/workers/*.log`) whose mtime is within the last 7d.
 * Older files are skipped because their timeout entries are outside
 * the rolling window. Returns 0 on any I/O failure (rule #7
 * graceful-degrade — if logs can't be read, the invariant doesn't fire
 * spuriously; a real timeout-storm becomes visible on the next
 * iteration once logs are readable).
 *
 * The mtime filter is an approximation of "events within 7d": a log
 * file that was last appended to within 7d may still contain older
 * entries from the same session, but in practice worker logs are
 * short-lived (per-iteration or per-worker-session) so the
 * approximation is close enough. The pivot threshold (default 14) is
 * tolerant of approximation drift.
 *
 * @param {string} repoRoot
 * @returns {Promise<number>}
 */
async function countClaudePrintTimeoutsIn7d(repoRoot) {
  const workersDir = join(repoRoot, ".minsky", "workers");
  /** @type {readonly string[]} */
  let entries;
  try {
    entries = await readdir(workersDir);
  } catch {
    return 0;
  }
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 3_600_000;
  let total = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".log")) continue;
    total += await countTimeoutsInLogFile(join(workersDir, entry), sevenDaysAgoMs);
  }
  return total;
}

/**
 * Count `claude-print-timeout` occurrences in a single log file, gated
 * by mtime against `sevenDaysAgoMs`. Returns 0 on any per-file failure
 * (rule #7 graceful-degrade — one bad file doesn't poison the
 * aggregate).
 *
 * @param {string} path
 * @param {number} sevenDaysAgoMs
 * @returns {Promise<number>}
 */
async function countTimeoutsInLogFile(path, sevenDaysAgoMs) {
  try {
    const stats = await stat(path);
    if (stats.mtimeMs < sevenDaysAgoMs) return 0;
    const content = await readFile(path, "utf8");
    const matches = content.match(/claude-print-timeout/g);
    return matches ? matches.length : 0;
  } catch {
    // rule-6: handled-locally — per-file errors collapse to 0; the aggregate degrades gracefully
    return 0;
  }
}

/**
 * Production probe for `listClaudePrintSpawns`: shells out to `pgrep -f 'claude --print'`,
 * then `ps -o pid=,ppid=,etime=` for each. Returns `[]` if pgrep is unavailable
 * or there are no spawns. Etime is parsed from `[[DD-]HH:]MM:SS` format.
 *
 * @returns {Promise<readonly ClaudePrintSpawn[]>}
 */
async function listClaudePrintSpawnsViaPgrep() {
  const pids = await pgrepClaudePrintPids();
  /** @type {ClaudePrintSpawn[]} */
  const out = [];
  for (const pidStr of pids) {
    const spawn = await readSpawnViaPs(pidStr);
    if (spawn !== null) out.push(spawn);
  }
  return out;
}

/**
 * Run `pgrep -f 'claude --print'`. Returns numeric pid strings; `[]` on failure.
 *
 * @returns {Promise<readonly string[]>}
 */
async function pgrepClaudePrintPids() {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", "claude --print"], { timeout: 5_000 });
    return stdout
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
  } catch {
    return [];
  }
}

/**
 * Run `ps -p <pid> -o pid=,ppid=,etime=` and parse the single line.
 * Returns null on any failure (race, malformed output).
 *
 * @param {string} pidStr
 * @returns {Promise<ClaudePrintSpawn | null>}
 */
async function readSpawnViaPs(pidStr) {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", pidStr, "-o", "pid=,ppid=,etime="], {
      timeout: 5_000,
    });
    const line = stdout.trim();
    if (!line) return null;
    const parts = line.split(/\s+/);
    if (parts.length < 3) return null;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    const etimeSeconds = parseEtime(parts[2] ?? "");
    if (!Number.isFinite(pid) || etimeSeconds === null) return null;
    return { pid, etimeSeconds, ppid: Number.isFinite(ppid) ? ppid : null };
  } catch {
    return null;
  }
}

/**
 * Parse the BSD/Linux `ps -o etime` format `[[DD-]HH:]MM:SS` into seconds.
 * Returns null on malformed input.
 *
 * @param {string} s
 * @returns {number | null}
 */
export function parseEtime(s) {
  const dayMatch = s.match(/^(\d+)-(.+)$/);
  let days = 0;
  let rest = s;
  if (dayMatch) {
    days = Number(dayMatch[1]);
    rest = dayMatch[2] ?? "";
  }
  const parts = rest.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  let h = 0;
  let m = 0;
  let sec = 0;
  if (parts.length === 3) [h, m, sec] = /** @type {[number, number, number]} */ (parts);
  else if (parts.length === 2) [m, sec] = /** @type {[number, number]} */ (parts);
  else if (parts.length === 1) sec = parts[0] ?? 0;
  else return null;
  return days * 86400 + h * 3600 + m * 60 + sec;
}

/**
 * Best-effort `gh` invocation. Returns null when gh is unavailable or
 * the command fails — keeps invariants graceful-degrade rather than
 * surfacing self-inflicted false positives on a fresh clone.
 *
 * @param {readonly string[]} args
 * @returns {Promise<unknown | null>}
 */
async function ghJson(args) {
  try {
    const { stdout } = await execFileAsync("gh", [...args], { timeout: 10_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Extract a `taskId` reference from a PR title or branch name. Daemon
 * convention: branches and PR titles carry the taskId after a `/` or
 * the conventional-commit scope.
 *
 * Two-pass: prefer the title's backtick-quoted taskId (e.g., the
 * "Pre-registered task: `daemon-foo-bar`" pattern), then fall back to
 * branch's leading task-prefix. Branch suffix-stripping (slice numbers,
 * "-substrate", "-final") yields the same taskId for sibling branches
 * — closes the failure mode observed 2026-05-06 where #218 + #219
 * were the same task but different post-slash text.
 *
 * @param {string} headRefName
 * @param {string} title
 * @returns {string | null}
 */
export function extractTaskIdFromPr(headRefName, title) {
  const titleMatch = title.match(/`([a-z][a-z0-9-]+)`/);
  if (titleMatch?.[1]) return titleMatch[1];
  return stripBranchSuffixes(stripBranchPrefix(headRefName)) || null;
}

/**
 * Find git merge-conflict marker lines in a config-file's text.
 *
 * @param {string} content
 * @returns {readonly { line: number, marker: string }[]}
 */
export function findConflictMarkers(content) {
  /** @type {{ line: number, marker: string }[]} */
  const out = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const marker = detectConflictMarker(lines[i] ?? "");
    if (marker !== null) out.push({ line: i + 1, marker });
  }
  return out;
}

/**
 * @param {string} line
 * @returns {string | null}
 */
export function detectConflictMarker(line) {
  if (line.startsWith("<<<<<<<")) return "<<<<<<<";
  if (line.startsWith(">>>>>>>")) return ">>>>>>>";
  if (line.startsWith("|||||||")) return "|||||||";
  return null;
}

/**
 * Pure transform: turn the raw `gh pr list ... --json statusCheckRollup` output
 * into the `DaemonPrCiSnapshot[]` shape consumed by
 * `daemonPrStuckOnCiInvariant`. Extracted so coverage tests can exercise the
 * mapping without spawning `gh`.
 *
 * @param {readonly { number: number, headRefName: string, statusCheckRollup?: unknown }[]} data
 * @returns {readonly DaemonPrCiSnapshot[]}
 */
export function mapGhPrListToCiSnapshots(data) {
  /** @type {DaemonPrCiSnapshot[]} */
  const out = [];
  for (const pr of data) {
    /** @type {readonly {conclusion?: string, state?: string}[]} */
    const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
    const failed = checks.filter(
      (c) => Boolean(c) && (c.conclusion === "FAILURE" || c.state === "FAILURE"),
    );
    out.push({
      number: pr.number,
      headRefName: pr.headRefName,
      ciFailureCount: failed.length,
      hasDaemonFixCommitSinceLastFailure: false,
    });
  }
  return out;
}

/**
 * Strip a leading conventional-commit-style scope prefix from a branch.
 *
 * @param {string} branch
 * @returns {string}
 */
export function stripBranchPrefix(branch) {
  const prefixes = ["feat/", "fix/", "chore/", "docs/"];
  for (const prefix of prefixes) {
    if (branch.startsWith(prefix)) return branch.slice(prefix.length);
  }
  return branch;
}

/**
 * Strip slice/version/substrate suffixes from a branch tail so sibling
 * branches collapse to the same task-id. Examples:
 *   `daemon-foo-substrate`         → `daemon-foo`
 *   `daemon-foo-slice-2`           → `daemon-foo`
 *   `daemon-foo-slice-12-docs`     → `daemon-foo`
 *   `daemon-foo-final`             → `daemon-foo`
 *   `daemon-foo-rebased`           → `daemon-foo`
 *   `daemon-foo-v2`                → `daemon-foo`
 *
 * @param {string} branch
 * @returns {string}
 */
export function stripBranchSuffixes(branch) {
  let out = branch;
  // Strip `-slice-N[-anything]`, `-substrate[-anything]`, `-final`, `-rebased`,
  // `-vN`, repeatedly until the suffix stops shrinking.
  for (let i = 0; i < 5; i++) {
    const next = out
      .replace(/-slice-\d+(?:-[a-z0-9-]+)?$/i, "")
      .replace(/-substrate(?:-[a-z0-9-]+)?$/i, "")
      .replace(/-final$/i, "")
      .replace(/-rebased$/i, "")
      .replace(/-v\d+$/i, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Production probe for `recentIterations`: parses the supervisor's
 * tick-loop log into a flat list of `{taskId, committed}` records.
 * Returns `[]` when the log file is absent (fresh checkout, supervisor
 * never ran).
 *
 * Conventions: each iteration emits the live span line
 * `[span] tick-loop.iteration {"iteration.index":N,"iteration.status":...,"task.id":...,"iteration.reason":...}`
 * — the exact shape `scripts/llm-provider-throughput.mjs` already
 * consumes. `committed` is
 * derived from `iteration.status === "completed"`. Lines that don't carry
 * the span prefix or don't parse are silently skipped.
 *
 * @param {string} logPath
 * @returns {Promise<readonly DaemonIteration[]>}
 */
async function readIterationsFromLog(logPath) {
  try {
    await stat(logPath);
  } catch {
    return [];
  }
  let raw;
  try {
    raw = await readFile(logPath, "utf8");
  } catch {
    return [];
  }
  /** @type {DaemonIteration[]} */
  const out = [];
  for (const line of raw.split("\n")) {
    const iter = parseIterationLogLine(line);
    if (iter) out.push(iter);
  }
  return out;
}

/**
 * Live tick-loop span prefix. Mirrors `SPAN_PREFIX` in
 * `scripts/llm-provider-throughput.mjs`
 * — the single source of truth for the emitter's stdout shape.
 */
const ITERATION_SPAN_PREFIX = "[span] tick-loop.iteration ";

/**
 * Parse one supervisor log line into a `DaemonIteration`, or `null` when the
 * line isn't a live `tick-loop.iteration` span. Reads the same fields
 * `activity.ts::parseSpan` consumes — `iteration.index`, `iteration.status`,
 * `task.id`, `iteration.reason` — and derives `committed` from
 * `iteration.status === "completed"`. Malformed JSON / non-span lines yield
 * `null` rather than throwing (rule #7 graceful-degrade for upstream input).
 *
 * @param {string} line
 * @returns {DaemonIteration | null}
 */
export function parseIterationLogLine(line) {
  if (!line?.startsWith(ITERATION_SPAN_PREFIX)) return null;
  const json = line.slice(ITERATION_SPAN_PREFIX.length).trim();
  if (json === "") return null;
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object") return null;
  const status = obj["iteration.status"];
  const taskId = obj["task.id"];
  if (typeof status !== "string" || typeof taskId !== "string") return null;
  return {
    taskId,
    committed: status === "completed",
    timestamp: "",
  };
}

/**
 * Slice 7 of `claude-usage-aware-strategic-model-router` — supervisor
 * invariant: every row in the strategic-router's MODEL_CATALOG must
 * pass `validateModelCatalog`'s shape + monotone-floor checks. Catches
 * editor mistakes (a slice 5 PR that breaks the monotone-descending
 * floors invariant would otherwise show up only when an iteration
 * routes incorrectly; this fires at supervisor boot).
 *
 * Strategy seam: `validate` is injected so tests can drive the
 * decision function with synthetic catalogs; production wiring
 * passes `validateModelCatalog(MODEL_CATALOG)`.
 *
 * @typedef {object} ModelCatalogInvariantOpts
 * @property {() => { readonly ok: boolean; readonly errors: readonly string[] }} validate
 *
 * @param {ModelCatalogInvariantOpts} opts
 * @returns {Invariant}
 */
export function modelCatalogInvariantsHoldInvariant(opts) {
  const { validate } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const result = validate();
    if (result.ok) return { id: "model-catalog-invariants-hold", ok: true };
    return {
      id: "model-catalog-invariants-hold",
      ok: false,
      evidence: `MODEL_CATALOG fails validation: ${result.errors.join("; ")}`,
      suggestedTaskTitle:
        "MODEL_CATALOG broken — strategic-router will mis-route iterations until fixed",
      suggestedFix:
        "Restore monotone-descending floors in `scripts/lib/model-catalog.mjs`. Run `pnpm vitest run scripts/lib/model-catalog.test.mjs` to verify.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "model-catalog-invariants-hold";
  return fn;
}

/**
 * Detect operator over-promise on `MINSKY_LOCAL_SERVER_MAX_CONCURRENT`.
 * Fires when the env var is set to N≥2 BUT the operator's local-LLM
 * backend can only handle 1 concurrent inference (the default for
 * mlx_lm.server and stock LM Studio). Symptom is GPU OOM under multi-
 * worker fanout — the bypass the gate created.
 *
 * Heuristic: probe `${probeUrl}` and check whether the response body
 * advertises a concurrency hint (custom backends like vLLM do; stock
 * mlx_lm.server does not). When the body is silent on concurrency AND
 * the env var is ≥2, fire — the operator probably set the env
 * speculatively.
 *
 * @typedef {object} LocalServerConcurrencyMismatchOpts
 * @property {string | undefined} envValue   The raw value of `MINSKY_LOCAL_SERVER_MAX_CONCURRENT` (or `undefined` when unset).
 * @property {() => Promise<{ ok: boolean, body?: string }>} probe Network probe; returns the response body on success.
 *
 * @param {LocalServerConcurrencyMismatchOpts} opts
 * @returns {Invariant}
 */
export function localServerConcurrencyMismatchInvariant(opts) {
  const { envValue, probe } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const id = "local-server-concurrency-mismatch";
    const parsed = parseConcurrencyEnv(envValue);
    if (parsed === undefined) return { id, ok: true };
    // Operator declared N≥2. Probe the backend; if the body doesn't
    // mention concurrency hints, the backend is probably the stock
    // single-inference flavor and the env value is wrong.
    const result = await probe();
    if (!result.ok || hasConcurrencyHint(result.body ?? "")) return { id, ok: true };
    return {
      id,
      ok: false,
      evidence: `MINSKY_LOCAL_SERVER_MAX_CONCURRENT=${parsed} but probe returned a body with no concurrent-inference hints (vLLM/sglang/LM-Studio-Pro advertise; stock mlx_lm.server does not). N≥2 will GPU-OOM on stock backends.`,
      suggestedTaskTitle:
        "MINSKY_LOCAL_SERVER_MAX_CONCURRENT set above 1 but backend looks single-inference",
      suggestedFix:
        "Unset MINSKY_LOCAL_SERVER_MAX_CONCURRENT (or set to 1) until you migrate to vLLM/sglang/LM-Studio-Pro. Verify with `curl http://127.0.0.1:8080/v1/models` — concurrent backends advertise concurrency hints in the response body.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "local-server-concurrency-mismatch";
  return fn;
}

/**
 * Parse `MINSKY_LOCAL_SERVER_MAX_CONCURRENT`. Returns `undefined` when
 * the value is missing, blank, non-numeric, or ≤1 — i.e., no mismatch
 * is possible.
 *
 * @param {string | undefined} envValue
 * @returns {number | undefined}
 */
function parseConcurrencyEnv(envValue) {
  if (envValue === undefined || envValue === "" || envValue === "1") return undefined;
  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 1) return undefined;
  return parsed;
}

/**
 * True when the probe body advertises a concurrent-inference hint
 * (vLLM, sglang, LM-Studio Pro, or a generic max_concurrent_requests
 * marker). Stock mlx_lm.server does not advertise these.
 *
 * @param {string} body
 * @returns {boolean}
 */
function hasConcurrencyHint(body) {
  return /concurren|prompt_concurrency|decode_concurrency|max_concurrent_requests|vllm|sglang/.test(
    body.toLowerCase(),
  );
}

/**
 * @typedef {Object} DaemonSpawnFailureRateOpts
 * @property {() => Promise<readonly {verdict: string, timestampMs: number}[]>} recentVerdicts
 *   -- returns the most recent iteration verdicts across all tasks. Each
 *   record needs `verdict` and `timestampMs` (ms-since-epoch). Production
 *   wires this to scan `.minsky/experiment-store/cross-repo/*.jsonl`.
 * @property {number} [windowSize] -- number of most-recent iterations to
 *   evaluate. Default 5.
 * @property {number} [maxFailures] -- number of `spawn-failed` verdicts in
 *   the window above which the invariant fires. Default 3.
 */

/**
 * Spawn-failure-rate invariant: fire when ≥`maxFailures` of the last
 * `windowSize` iterations have `verdict: "spawn-failed"`. This catches
 * the silent class of failure where:
 *   - launchd-managed supervisor doesn't see the operator's
 *     `ANTHROPIC_API_KEY` shell export (the spawn shim hard-fails with
 *     exit 64), AND
 *   - `self-diagnose` reported "all invariants pass ✓" because no
 *     existing invariant looked at the iteration verdict distribution.
 *
 * Source: 2026-05-27 operator session — 30 consecutive `spawn-failed`
 * iterations went undetected for ~12h. The pre-fix self-diagnose was
 * GREEN throughout. New invariant closes the gap.
 *
 * @param {DaemonSpawnFailureRateOpts} opts
 * @returns {Invariant}
 */
export function daemonSpawnFailureRateInvariant(opts) {
  const { recentVerdicts, windowSize = 5, maxFailures = 3 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const all = await recentVerdicts();
    if (all.length === 0) return { id: "daemon-spawn-failure-rate", ok: true };
    // Take the last `windowSize` verdicts (already sorted newest-first
    // by the production loader, but we re-sort defensively).
    const sorted = [...all].sort((a, b) => b.timestampMs - a.timestampMs);
    const window = sorted.slice(0, windowSize);
    const failed = window.filter((v) => v.verdict === "spawn-failed");
    if (failed.length < maxFailures) {
      return { id: "daemon-spawn-failure-rate", ok: true };
    }
    const evidence = `${failed.length}/${window.length} of the last ${windowSize} iterations spawn-failed`;
    return {
      id: "daemon-spawn-failure-rate",
      ok: false,
      actor: "operator",
      evidence,
      suggestedTaskTitle: `Daemon spawning fails ${failed.length}/${window.length} of the time — agent runtime is misconfigured`,
      suggestedFix:
        "The cloud-agent spawn has been failing repeatedly. Common causes: " +
        "(a) `ANTHROPIC_API_KEY` not set in the launchd env — set via " +
        "`launchctl setenv ANTHROPIC_API_KEY sk-...` and restart the supervisor; " +
        "(b) `local_llm_enabled: true` in `~/.minsky/config.json` but Ollama isn't running — " +
        "`brew services start ollama` and verify `curl http://localhost:11434/api/tags`; " +
        "(c) `cloud_agent` field names a backend the dispatcher doesn't recognize — " +
        "check `tail -5 .minsky/experiment-store/cross-repo/*.jsonl` for the exact " +
        "`notes` field to see the agent's stderr. Operator-action: pick one of (a/b/c) " +
        "and restart the tick-loop via `pnpm minsky:setup`.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "daemon-spawn-failure-rate";
  return fn;
}

/**
 * @typedef {Object} DaemonNoProgressRateOpts
 * @property {() => Promise<readonly {verdict: string, timestampMs: number}[]>} recentVerdicts
 * @property {number} [windowSize] -- default 5
 * @property {number} [maxNoProgress] -- default 3
 */

/**
 * No-progress-rate invariant: fire when ≥`maxNoProgress` of the last
 * `windowSize` iterations have `verdict: "no-progress"`. Distinct from
 * spawn-failure-rate because it catches a DIFFERENT bug class — the
 * agent reaches the model and converses cleanly (so `spawn-failed`
 * never fires), but produces zero useful output (no PR, no commits, no
 * push). Surfaces engagement / brief / model-choice problems instead of
 * configuration problems.
 *
 * Source: 2026-05-27 operator session — 9-hour monitor of the
 * qwen3-coder:30b daemon caught 13/13 iterations exiting 0 with one
 * `ls -la` and no further engagement. Pre-fix the verdict was
 * `validated` (false positive) and `self-diagnose` was all-green.
 * Pair-PR landed evidence-of-work gate in bin/minsky-run.sh that
 * downgrades verdict to `no-progress` when none of the 3-stage PR
 * backstops found/created a PR; this invariant catches the new class
 * within ≤60s of recurrence.
 *
 * @param {DaemonNoProgressRateOpts} opts
 * @returns {Invariant}
 */
export function daemonNoProgressRateInvariant(opts) {
  const { recentVerdicts, windowSize = 5, maxNoProgress = 3 } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const all = await recentVerdicts();
    if (all.length === 0) return { id: "daemon-no-progress-rate", ok: true };
    const sorted = [...all].sort((a, b) => b.timestampMs - a.timestampMs);
    const window = sorted.slice(0, windowSize);
    const noProgress = window.filter((v) => v.verdict === "no-progress");
    if (noProgress.length < maxNoProgress) {
      return { id: "daemon-no-progress-rate", ok: true };
    }
    const evidence = `${noProgress.length}/${window.length} of the last ${windowSize} iterations made no progress (exit 0, no PR, no commits, no push)`;
    return {
      id: "daemon-no-progress-rate",
      ok: false,
      actor: "operator",
      evidence,
      suggestedTaskTitle: `Daemon agent makes no progress ${noProgress.length}/${window.length} of the time — model engagement issue`,
      suggestedFix:
        "The agent reaches the model cleanly but produces zero useful output (no PR, no commits, no push). " +
        "This is distinct from spawn failures — the conversation completes, just produces nothing. Common causes: " +
        "(a) model is under-engaging the brief — read `.minsky/failures/<latest>/stdout.log` to see what the agent actually output; " +
        "(b) brief is too verbose for the model — local-LLM path should use a shorter brief than the cloud-LLM path; " +
        "(c) tool-call format mismatch — qwen / non-Claude models may need different agent framework (try aider over openhands); " +
        "(d) model is too small for autonomous coding — qwen3-coder:30b is the floor; try claude-opus-4-7 or qwen3-coder:480b. " +
        "Operator-action: inspect the latest `.minsky/failures/<ts>-<task>/stdout.log` to triage.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId = "daemon-no-progress-rate";
  return fn;
}

/**
 * Parse one JSONL line into a verdict-timestamp pair. Returns null for
 * malformed lines or lines missing a parseable timestamp.
 *
 * @param {string} line
 * @returns {{verdict: string, timestampMs: number} | null}
 */
function parseExperimentStoreLine(line) {
  if (!line.trim()) return null;
  /** @type {Record<string, unknown> | null} */
  let r;
  try {
    r = JSON.parse(line);
  } catch {
    return null;
  }
  if (!r || typeof r !== "object") return null;
  // The cross-repo experiment-store record format (`bin/minsky-run.sh`
  // § `record_iteration`) uses `ts` as the ISO-8601 timestamp field.
  // Also accept `iso_timestamp` / `timestamp` for forward-compat.
  const ts = /** @type {string | null} */ (r["ts"] ?? r["iso_timestamp"] ?? r["timestamp"] ?? null);
  const verdict = typeof r["verdict"] === "string" ? r["verdict"] : "unknown";
  const timestampMs = ts ? Date.parse(ts) : 0;
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return null;
  return { verdict, timestampMs };
}

/**
 * Read one JSONL file and accumulate its parsed verdict entries into
 * `acc`. Skips unreadable files and malformed lines silently (the
 * caller is interested in aggregate counts, not per-record errors).
 *
 * @param {string} filepath
 * @param {{verdict: string, timestampMs: number}[]} acc
 */
async function accumulateVerdictsFromFile(filepath, acc) {
  /** @type {string} */
  let raw;
  try {
    raw = await readFile(filepath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const entry = parseExperimentStoreLine(line);
    if (entry) acc.push(entry);
  }
}

/**
 * Read all iteration JSONL records from `.minsky/experiment-store/
 * cross-repo/*.jsonl`, returning the union with `timestampMs` parsed
 * from the iso_timestamp field. Used by the spawn-failure-rate
 * invariant and the matching metric collector.
 *
 * @param {string} repoRoot
 * @returns {Promise<readonly {verdict: string, timestampMs: number}[]>}
 */
export async function readExperimentStoreVerdicts(repoRoot) {
  const dir = resolve(repoRoot, ".minsky/experiment-store/cross-repo");
  /** @type {{verdict: string, timestampMs: number}[]} */
  const acc = [];
  /** @type {string[]} */
  let files;
  try {
    const { readdir } = await import("node:fs/promises");
    files = await readdir(dir);
  } catch {
    return [];
  }
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    await accumulateVerdictsFromFile(resolve(dir, f), acc);
  }
  return acc;
}

/**
 * Production wiring — the invariants the supervisor probes at start-up.
 * Each invariant closes over its production data source; tests bypass
 * this by calling {@link runInvariants} directly with synthetic
 * invariants.
 *
 * @returns {readonly Invariant[]}
 */
export function defaultInvariants() {
  const configDir = join(homedir(), ".claude");
  /** @type {(plan: "pro"|"max5"|"max20"|"custom") => Promise<TokenSnapshot>} */
  const snapshotPerPlan = async (plan) => new MaciekTokenMonitor({ configDir, plan }).snapshot();

  const repoRoot = process.cwd();
  const logPath = resolve(repoRoot, ".minsky/tick-loop.out.log");
  const tasksMdPath = resolve(repoRoot, "TASKS.md");

  const recentIterations = () => readIterationsFromLog(logPath);

  /** @type {() => Promise<readonly DaemonPrCiSnapshot[]>} */
  const daemonPrs = async () => {
    const data = await ghJson([
      "pr",
      "list",
      "--author",
      "@me",
      "--state",
      "open",
      "--json",
      "number,headRefName,statusCheckRollup,commits",
      "--limit",
      "50",
    ]);
    if (!Array.isArray(data)) return [];
    return mapGhPrListToCiSnapshots(data);
  };

  const rollingStats = async () => {
    const iters = await recentIterations();
    const merged = await ghJson([
      "pr",
      "list",
      "--author",
      "@me",
      "--state",
      "merged",
      "--search",
      "merged:>=2026-04-28",
      "--json",
      "number",
      "--limit",
      "100",
    ]);
    return {
      iterationCount: iters.length,
      shippedPrCount: Array.isArray(merged) ? merged.length : 0,
    };
  };

  /** @type {() => Promise<readonly OpenPrSnapshot[]>} */
  const openDaemonPrs = async () => {
    const data = await ghJson([
      "pr",
      "list",
      "--author",
      "@me",
      "--state",
      "open",
      "--json",
      "number,headRefName,title,files",
      "--limit",
      "50",
    ]);
    if (!Array.isArray(data)) return [];
    return data.map((pr) => {
      /** @type {readonly { path?: string }[]} */
      const files = Array.isArray(pr.files) ? pr.files : [];
      return {
        number: pr.number,
        taskId: extractTaskIdFromPr(pr.headRefName ?? "", pr.title ?? ""),
        files: files.map((f) => f.path ?? "").filter((p) => p.length > 0),
      };
    });
  };

  const inFlightTaskIds = async () => {
    const prs = await openDaemonPrs();
    /** @type {string[]} */
    const ids = [];
    for (const pr of prs) {
      if (pr.taskId) ids.push(pr.taskId);
    }
    return ids;
  };

  const tasksMdContent = async () => {
    try {
      return await readFile(tasksMdPath, "utf8");
    } catch {
      return "";
    }
  };

  /** @type {() => Promise<readonly DaemonPrCleanCiSummary[]>} */
  const recentDaemonPrs = async () => {
    const since = new Date(Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const data = await ghJson(buildRecentPrListGhArgs(since));
    if (!Array.isArray(data)) return [];
    return parsePrListEntries(data);
  };

  // Single shared fetch for open daemon PRs. `openDaemonPrsForDirty` and
  // `openDaemonPrsForThrash` previously each issued their own
  // `gh pr list --repo … --state open` subprocess — same query, different
  // JSON projections. `runInvariants` runs invariants sequentially, so a
  // memoised promise lets the second consumer reuse the first's result:
  // net `gh pr list` round-trips for the open-PR snapshot stays 1, not 2.
  //
  // Declared-optional-property typedef (not an index signature) so dot
  // access stays legal under `noPropertyAccessFromIndexSignature`.
  /**
   * @typedef {object} RawOpenDaemonPr
   * @property {number} [number]
   * @property {string} [mergeStateStatus]
   * @property {string} [createdAt]
   * @property {readonly unknown[]} [commits]
   * @property {string} [mergeable]
   */
  /** @type {Promise<readonly RawOpenDaemonPr[]> | null} */
  let openDaemonPrsRawCache = null;
  /** @type {() => Promise<readonly RawOpenDaemonPr[]>} */
  const fetchOpenDaemonPrsRaw = () => {
    if (openDaemonPrsRawCache) return openDaemonPrsRawCache;
    openDaemonPrsRawCache = (async () => {
      const data = await ghJson([
        "pr",
        "list",
        "--repo",
        CANONICAL_REPO,
        "--author",
        "@me",
        "--state",
        "open",
        "--json",
        "number,mergeStateStatus,createdAt,commits,mergeable",
        "--limit",
        "20",
      ]);
      return Array.isArray(data) ? data : [];
    })();
    return openDaemonPrsRawCache;
  };

  /** @type {() => Promise<readonly OpenDaemonPrSnapshotForDirty[]>} */
  const openDaemonPrsForDirty = async () => {
    const data = await fetchOpenDaemonPrsRaw();
    const now = Date.now();
    return data.map((pr) => ({
      number: pr.number ?? 0,
      mergeableState:
        typeof pr.mergeStateStatus === "string" ? pr.mergeStateStatus.toLowerCase() : "unknown",
      ageHours:
        typeof pr.createdAt === "string"
          ? Math.max(0, (now - Date.parse(pr.createdAt)) / 3_600_000)
          : 0,
    }));
  };

  /** @type {() => Promise<readonly OpenDaemonPrSnapshotForThrash[]>} */
  const openDaemonPrsForThrash = async () => {
    const data = await fetchOpenDaemonPrsRaw();
    const now = Date.now();
    return data.map((pr) => ({
      number: pr.number ?? 0,
      commitCount: Array.isArray(pr.commits) ? pr.commits.length : 0,
      ageHours:
        typeof pr.createdAt === "string"
          ? Math.max(0, (now - Date.parse(pr.createdAt)) / 3_600_000)
          : 0,
      mergeable: typeof pr.mergeable === "string" ? pr.mergeable : "UNKNOWN",
    }));
  };

  /** @type {() => Promise<ReadonlyMap<string, number>>} */
  const mergedPrCountByTaskId = async () => {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10);
    const data = await ghJson([
      "pr",
      "list",
      "--repo",
      CANONICAL_REPO,
      "--author",
      "@me",
      "--state",
      "merged",
      "--search",
      `merged:>=${since}`,
      "--json",
      "number,headRefName,title",
      "--limit",
      "50",
    ]);
    /** @type {Map<string, number>} */
    const counts = new Map();
    if (!Array.isArray(data)) return counts;
    for (const pr of data) {
      const id = extractTaskIdFromPr(pr.headRefName ?? "", pr.title ?? "");
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  };

  /** @type {() => Promise<{ ok: boolean, durationMs: number, stderr?: string }>} */
  const probeGitStatus = async () => {
    const start = Date.now();
    try {
      await execFileAsync("git", ["status", "--porcelain"], {
        timeout: 5_000,
        cwd: repoRoot,
      });
      return { ok: true, durationMs: Date.now() - start };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, durationMs: Date.now() - start, stderr: message };
    }
  };

  /** @type {() => Promise<readonly { line: number, marker: string }[]>} */
  const scanGitConfigForConflicts = async () => {
    const path = join(homedir(), ".gitconfig");
    try {
      const content = await readFile(path, "utf8");
      return findConflictMarkers(content);
    } catch {
      return [];
    }
  };

  /** @type {() => Promise<boolean>} - reads core.bare on the repo under diagnosis */
  const probeGitBare = async () => {
    try {
      const { stdout } = await execFileAsync("git", ["config", "--get", "core.bare"], {
        timeout: 5_000,
        cwd: repoRoot,
      });
      return stdout.trim() === "true";
    } catch {
      // core.bare unset (git config exits 1) means not bare.
      return false;
    }
  };

  /** @type {() => Promise<number>} - counts entries under .git/worktrees/ */
  const probeGitWorktreeCount = async () => {
    try {
      const entries = await readdir(join(repoRoot, ".git", "worktrees"));
      return entries.length;
    } catch {
      return 0;
    }
  };

  return [
    tokenMonitorNotAllPeggedInvariant({ snapshotPerPlan }),
    claudeBinaryReachableInvariant({ probe: spawnVersionProbe }),
    daemonNoopIterationRateInvariant({ recentIterations }),
    daemonPrStuckOnCiInvariant({ daemonPrs }),
    daemonShippedRatioInvariant({ rollingStats }),
    daemonInFlightPrCollisionInvariant({ openDaemonPrs }),
    daemonTaskIdStalenessInvariant({ inFlightTaskIds, tasksMdContent }),
    daemonIterationRuntimeInvariant({ listClaudePrintSpawns: listClaudePrintSpawnsViaPgrep }),
    daemonPrLintPassRateInvariant({ recentDaemonPrs }),
    gitConfigParseableInvariant({
      probeGitStatus,
      scanGitConfigForConflicts,
      probeGitBare,
      probeGitWorktreeCount,
    }),
    daemonPrStuckDirtyInvariant({ openDaemonPrs: openDaemonPrsForDirty }),
    daemonPrStuckConflictingInvariant({ openDaemonPrs: openDaemonPrsForDirty }),
    daemonPrThrashInvariant({ openDaemonPrs: openDaemonPrsForThrash }),
    daemonSpawnFailureRateInvariant({
      recentVerdicts: () => readExperimentStoreVerdicts(repoRoot),
    }),
    daemonNoProgressRateInvariant({
      recentVerdicts: () => readExperimentStoreVerdicts(repoRoot),
    }),
    daemonTaskScopeExplosionInvariant({ mergedPrCountByTaskId }),
    claudePrintTimeoutFrequencyInvariant({
      countTimeoutsInRollingWindow: () => countClaudePrintTimeoutsIn7d(repoRoot),
    }),
    modelCatalogInvariantsHoldInvariant({
      validate: () => validateModelCatalog(MODEL_CATALOG),
    }),
    localServerConcurrencyMismatchInvariant({
      envValue: process.env["MINSKY_LOCAL_SERVER_MAX_CONCURRENT"],
      probe: async () => {
        const probeUrl =
          process.env["MINSKY_LOCAL_LLM_PROBE_URL"] ?? "http://127.0.0.1:8080/v1/models";
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);
          const res = await fetch(probeUrl, { signal: controller.signal });
          clearTimeout(timer);
          if (!res.ok) return { ok: false };
          const body = await res.text();
          return { ok: true, body };
        } catch {
          // rule-6: handled-locally — probe failures collapse to "no signal"; invariant does not fire under network errors
          return { ok: false };
        }
      },
    }),
  ];
}

/**
 * Render findings as a TASKS.md-shaped block per finding. Per the
 * file-level policy "every new task entry MUST include … Measurement
 * and Pivot threshold", we encode both — the measurement is the probe
 * itself; the pivot is "if the same finding fires for >7 consecutive
 * days, the invariant is wrong, not the system".
 *
 * The `**Tags**:` line MUST lead with `p0`: `scripts/drain-concerns.mjs`
 * routes a pending block to its `## PX` section by matching
 * `/\b(p[0-3])\b/i` against the Tags line (`parsePriority`). Without a
 * recognized priority tag the drainer moves the block to `invalid/` and
 * the finding is never filed — so a self-diagnosed throughput issue
 * would be detected but silently dropped instead of becoming a
 * daemon-pickable P0 task. The paired test pins this contract.
 *
 * @param {readonly InvariantViolation[]} findings
 * @param {string} nowIso
 * @returns {string}
 */
export function findingsToTasksMd(findings, nowIso) {
  if (findings.length === 0) return "";
  const blocks = findings.map((f) => {
    const id = `self-diagnose-${f.id}-${nowIso.slice(0, 10)}`;
    return [
      `- [ ] \`${id}\` — ${f.suggestedTaskTitle}`,
      `  - **ID**: ${id}`,
      `  - **Tags**: p0, self-detected, ${f.id}`,
      "  - **Estimate**: 1d",
      `  - **Hypothesis**: ${f.suggestedFix}`,
      `  - **Evidence**: ${f.evidence}`,
      `  - **Surfaced-by**: \`scripts/self-diagnose.mjs\` invariant \`${f.id}\` at ${nowIso}.`,
      `  - **Measurement**: re-running \`node scripts/self-diagnose.mjs --json\` no longer surfaces invariant \`${f.id}\` in the findings array. Concretely: \`node scripts/self-diagnose.mjs --json | jq -e '[.[] | select(.id == "${f.id}")] | length == 0'\` exits 0.`,
      "  - **Pivot**: if the same finding fires for >7 consecutive days despite attempted fixes, the invariant is wrong (false-positive); audit and adjust the probe rather than chase the underlying state.",
      "  - **Anchor**: rule #9 (pre-registered HDD); Liskov 1987 (invariants as the substrate of correctness).",
      "",
    ].join("\n");
  });
  return blocks.join("\n");
}

/* v8 ignore start */
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const findings = await runInvariants(defaultInvariants());
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  } else if (process.argv.includes("--human")) {
    // Compact one-finding-per-block format, with explicit actor labels.
    // This is what the tick-loop supervisor invokes for its boot log
    // (was `--json` until 2026-05-26 operator directive: "make it clear
    // whether we need an intervention or do we expect minsky to fix the
    // problem in logs"). One JSON-formatted dump per boot was unreadable
    // — every finding ran together and the operator couldn't tell which
    // ones were their action items.
    if (findings.length === 0) {
      process.stdout.write("self-diagnose: all invariants pass ✓\n");
    } else {
      // Roll-up first so the operator sees the count-by-actor at a glance.
      const byActor = { minsky: 0, "minsky-then-operator": 0, operator: 0 };
      for (const f of findings) byActor[f.actor ?? "operator"] += 1;
      process.stdout.write(
        `self-diagnose: ${findings.length} finding(s) — 🤖 ${byActor.minsky} auto-fix · 🤖→👤 ${byActor["minsky-then-operator"]} auto-then-operator · 👤 ${byActor.operator} needs-operator\n`,
      );
      for (const f of findings) {
        process.stdout.write(`\n  ${actorLabel(f.actor)} ${f.id}\n`);
        process.stdout.write(`    evidence: ${f.evidence}\n`);
        process.stdout.write(`    fix:      ${f.suggestedFix}\n`);
      }
      process.stdout.write("\n");
    }
  } else if (findings.length === 0) {
    process.stdout.write("self-diagnose: all invariants pass\n");
  } else {
    for (const f of findings) {
      process.stdout.write(`✗ ${actorLabel(f.actor)} ${f.id}: ${f.evidence}\n`);
      process.stdout.write(`  fix: ${f.suggestedFix}\n`);
    }
    if (process.argv.includes("--write-tasks-md")) {
      const block = findingsToTasksMd(findings, new Date().toISOString());
      process.stdout.write(`\n${block}`);
    }
  }
  process.exit(findings.length === 0 ? 0 : 1);
}
/* v8 ignore stop */
