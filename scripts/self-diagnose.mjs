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
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { MaciekTokenMonitor, PLAN_CAPS } from "@minsky/token-monitor";

const execFileAsync = promisify(execFile);

/**
 * @typedef {object} InvariantOk
 * @property {string} id
 * @property {true} ok
 *
 * @typedef {object} InvariantViolation
 * @property {string} id
 * @property {false} ok
 * @property {string} evidence — human-readable proof of the violation
 * @property {string} suggestedTaskTitle — one-line title for TASKS.md
 * @property {string} suggestedFix — one-paragraph hypothesis for the fix
 *
 * @typedef {InvariantOk | InvariantViolation} InvariantResult
 *
 * @typedef {() => Promise<InvariantResult>} Invariant
 */

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
      evidence: `in-flight task ids absent from TASKS.md: ${stale.join(", ")}.`,
      suggestedTaskTitle: `daemon iterating on stale task id(s): ${stale.join(", ")}`,
      suggestedFix:
        "The daemon has work-in-flight (open PRs / active branches / claimed task entries) for task ids that no longer have a `**ID**: <id>` block in TASKS.md. The operator likely removed or renamed the task. The daemon should refuse to keep iterating: close the orphan PR(s), abandon the branch, and pick a fresh task on the next iteration. If the work is still valuable, re-file the task block with a new ID and retarget the in-flight branch.",
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
 * @property {boolean} hasFailure — true iff statusCheckRollup currently shows ≥1 conclusion=FAILURE check
 *
 * @typedef {object} PrLintPassRateInvariantOpts
 * @property {() => Promise<readonly DaemonPrCleanCiSummary[]>} recentDaemonPrs — rolling window the brief defines (default impl: 30d)
 * @property {number} [windowMinPrs] - only evaluate once the window holds this many PRs (default 10; below that the ratio is too noisy)
 * @property {number} [minPassRate] - fire below this fraction (default 0.8, the brief's pre-registered threshold)
 */

/**
 * Pre-registered metric for `daemon-pre-pr-lint-gate` (TASKS.md): rolling
 * 30d fraction of daemon-authored PRs whose `statusCheckRollup` carries
 * zero `conclusion=FAILURE` checks must stay ≥ `minPassRate` (0.8).
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
  const { recentDaemonPrs, windowMinPrs = 10, minPassRate = 0.8 } = opts;
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
 * Format seconds as `<H>h<M>m<S>s` short form. Used in evidence and
 * suggestedFix rendering for human readability.
 *
 * @param {number} seconds
 * @returns {string}
 */
function formatEtime(seconds) {
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
function parseEtime(s) {
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
 * the conventional-commit scope (e.g., `feat(tick-loop): foo` → null;
 * `chore/daily-changelog-for-humans` → `daily-changelog-for-humans`).
 *
 * @param {string} headRefName
 * @param {string} title
 * @returns {string | null}
 */
function extractTaskIdFromPr(headRefName, title) {
  const slashIdx = headRefName.indexOf("/");
  if (slashIdx >= 0 && slashIdx < headRefName.length - 1) {
    return headRefName.slice(slashIdx + 1);
  }
  const m = title.match(/`([a-z][a-z0-9-]+)`/);
  return m ? (m[1] ?? null) : null;
}

/**
 * Production probe for `recentIterations`: parses the supervisor's
 * tick-loop log into a flat list of `{taskId, committed}` records.
 * Returns `[]` when the log file is absent (fresh checkout, supervisor
 * never ran).
 *
 * Conventions: each iteration emits a JSON line with `evt:"iteration"`,
 * `taskId`, and `committedSha` fields when the OTEL adapter is
 * enabled; `committed` is true iff `committedSha` is a non-empty
 * string. Lines that don't parse are silently skipped.
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
 * @param {string} line
 * @returns {DaemonIteration | null}
 */
function parseIterationLogLine(line) {
  if (!line) return null;
  try {
    const obj = JSON.parse(line);
    if (!obj || obj.evt !== "iteration" || typeof obj.taskId !== "string") return null;
    return {
      taskId: obj.taskId,
      committed: typeof obj.committedSha === "string" && obj.committedSha.length > 0,
      timestamp: typeof obj.ts === "string" ? obj.ts : "",
    };
  } catch {
    return null;
  }
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
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = await ghJson([
      "pr",
      "list",
      "--author",
      "@me",
      "--state",
      "all",
      "--search",
      `created:>=${since}`,
      "--json",
      "number,statusCheckRollup",
      "--limit",
      "100",
    ]);
    if (!Array.isArray(data)) return [];
    /** @type {DaemonPrCleanCiSummary[]} */
    const out = [];
    for (const pr of data) {
      /** @type {readonly { conclusion?: string, state?: string }[]} */
      const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
      const hasFailure = checks.some(
        (c) => Boolean(c) && (c.conclusion === "FAILURE" || c.state === "FAILURE"),
      );
      out.push({ number: pr.number, hasFailure });
    }
    return out;
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
  ];
}

/**
 * Render findings as a TASKS.md-shaped block per finding. Per the
 * file-level policy "every new task entry MUST include … Measurement
 * and Pivot threshold", we encode both — the measurement is the probe
 * itself; the pivot is "if the same finding fires for >7 consecutive
 * days, the invariant is wrong, not the system".
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
      `  - **Tags**: self-detected, ${f.id}`,
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

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const findings = await runInvariants(defaultInvariants());
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  } else if (findings.length === 0) {
    process.stdout.write("self-diagnose: all invariants pass\n");
  } else {
    for (const f of findings) {
      process.stdout.write(`✗ ${f.id}: ${f.evidence}\n`);
      process.stdout.write(`  fix: ${f.suggestedFix}\n`);
    }
    if (process.argv.includes("--write-tasks-md")) {
      const block = findingsToTasksMd(findings, new Date().toISOString());
      process.stdout.write(`\n${block}`);
    }
  }
  process.exit(findings.length === 0 ? 0 : 1);
}
