// <!-- pattern: not-applicable — the architectural pattern (declarative
//   throttle-detector + remediation projection, a read-only "drift detector"
//   over the host's OS-throttle surface) is named and anchored in this
//   package's README § "os-throttle-detect" rather than in vision.md, following
//   the novel/human-loop/src precedent (operator-machine-budget-autoscale part
//   (c)); vision.md is operator/MAPE-K-owned and not edited from a task. -->
/**
 * `os-throttle-detect` — the pure detector half of
 * `operator-machine-budget-autoscale` part (c): find OS throttles that
 * *contradict* the operator's machine-utilisation budget so the budget is
 * physically reachable.
 *
 * A budget of 70% is meaningless if macOS QoS-throttles the worker
 * (`ProcessType=Background`), a stale `Nice` deprioritises it, or a low file-
 * descriptor `ulimit` starves the concurrency the budget allocates. This
 * module is a pure function over an already-gathered {@link ThrottleEvidence}
 * snapshot; the snapshot's I/O — reading the launchd plist, `launchctl`,
 * `ulimit -n`, `MINSKY_*` env — lives at the edge in
 * [`novel/tick-loop/bin/tick-loop.mjs`](../bin/tick-loop.mjs). Keeping the
 * decision pure makes the contradiction-detection deterministically testable
 * and lets the same logic back the `scripts/check-machine-budget.mjs` gate.
 *
 * The output is advisory + corrective: each detected throttle carries a
 * `remediation` (the exact host change) AND a `mirrorRepo` so the daemon can
 * emit the durable cross-repo task (`~/apps/dotfiles` for launchd/shell/
 * sysctl/ulimit) per rule #1 (propagate; don't hand-maintain a one-off).
 *
 * Pattern conformance, failure modes, threat model, and the rule-#9
 * hypothesis live in this package's README.
 */

/** The host-throttle surfaces this detector understands. */
export type ThrottleKind =
  | "process-type-background"
  | "nice"
  | "ulimit-nofile"
  | "stale-minsky-cap";

/** Which enterprise mirror durably owns the fix for a given throttle. */
export type MirrorRepo = "dotfiles" | "agentbrew";

/**
 * A raw snapshot of the host's throttle-relevant state. Gathered by the I/O
 * edge; every field is optional so a partial probe (e.g. no launchd on Linux)
 * degrades gracefully (rule #7) rather than crashing.
 */
export interface ThrottleEvidence {
  /** The worker launchd plist's `<ProcessType>` value, or `null` if absent. */
  processType?: string | null;
  /** The worker launchd plist's `<Nice>` value, or `null` if absent. */
  nice?: number | null;
  /** `ulimit -n` (max open file descriptors) for the worker process. */
  ulimitNofile?: number | null;
  /**
   * Stale `MINSKY_*` concurrency caps in the environment that would override
   * the autoscaler with a hard ceiling (e.g. a leftover
   * `MINSKY_SPAWN_ADDITIONAL_WORKERS` from a debugging session).
   */
  staleMinskyCaps?: Record<string, string>;
  /** The resolved machine budget the throttles are being checked against. */
  budgetPct: number;
}

/** One detected throttle that contradicts the budget. */
export interface ThrottleFinding {
  /** Which throttle surface. */
  kind: ThrottleKind;
  /** Human-readable description of the contradiction. */
  detail: string;
  /** The exact corrective host change. */
  remediation: string;
  /** Which enterprise mirror durably owns the fix (rule #1 propagation). */
  mirrorRepo: MirrorRepo;
}

/**
 * Below this budget the box is *meant* to idle, so a `Background` QoS / `Nice`
 * is not a contradiction. Matches `scripts/check-machine-budget.mjs`'s
 * `TRIVIAL_BUDGET_PCT` so the runtime detector and the CI gate agree on the
 * threshold (one definition of "trivial budget", two enforcement points).
 */
export const TRIVIAL_BUDGET_PCT = 10;

/**
 * The minimum file-descriptor ulimit a non-trivial budget needs before fd
 * starvation throttles concurrency. macOS defaults to 256 for launchd agents,
 * which starves >~4 concurrent agent subprocesses; 2048 is the documented
 * floor in the budget runbook.
 */
export const MIN_NOFILE_FOR_BUDGET = 2048;

/**
 * Detect every OS throttle that contradicts the (non-trivial) budget.
 *
 * Returns `[]` when the budget is trivial (≤ {@link TRIVIAL_BUDGET_PCT}) — at
 * that point the operator deliberately wants an idle box and a throttle is
 * not a contradiction. Each finding names the corrective change and the
 * mirror repo that should durably own it.
 *
 * @otel os-throttle-detect.detect
 * @param evidence the gathered host-throttle snapshot
 * @returns the contradicting throttles, empty when none / budget trivial
 */
export function detectThrottles(evidence: ThrottleEvidence): ThrottleFinding[] {
  if (evidence.budgetPct <= TRIVIAL_BUDGET_PCT) return [];
  const findings: ThrottleFinding[] = [];

  if (evidence.processType === "Background") {
    findings.push({
      kind: "process-type-background",
      detail: `launchd ProcessType=Background QoS-throttles CPU/IO, making the ${evidence.budgetPct}% budget physically unreachable.`,
      remediation: "Set <ProcessType>Standard</ProcessType> in the worker launchd plist.",
      mirrorRepo: "dotfiles",
    });
  }

  if (typeof evidence.nice === "number" && evidence.nice > 0) {
    findings.push({
      kind: "nice",
      detail: `launchd Nice=${evidence.nice} deprioritises the worker against other processes, eroding the ${evidence.budgetPct}% budget.`,
      remediation: "Remove the <Nice> key (or set it to 0) in the worker launchd plist.",
      mirrorRepo: "dotfiles",
    });
  }

  if (typeof evidence.ulimitNofile === "number" && evidence.ulimitNofile < MIN_NOFILE_FOR_BUDGET) {
    findings.push({
      kind: "ulimit-nofile",
      detail: `ulimit -n=${evidence.ulimitNofile} is below ${MIN_NOFILE_FOR_BUDGET}; file-descriptor starvation caps concurrency below the ${evidence.budgetPct}% budget.`,
      remediation: `Raise the worker's open-file limit to ≥${MIN_NOFILE_FOR_BUDGET} (launchd <SoftResourceLimits><NumberOfFiles>, or shell ulimit).`,
      mirrorRepo: "dotfiles",
    });
  }

  for (const [key, value] of Object.entries(evidence.staleMinskyCaps ?? {})) {
    findings.push({
      kind: "stale-minsky-cap",
      detail: `${key}=${value} is a stale hard concurrency cap that overrides the budget-matched autoscaler.`,
      remediation: `Unset ${key} so the autoscaler controls concurrency; encode any durable cap as the agent rule in agentbrew, not a leftover env var.`,
      mirrorRepo: "agentbrew",
    });
  }

  return findings;
}

/**
 * Is the host clear of budget-contradicting throttles? Convenience predicate
 * the daemon uses to log a single "budget reachable" line.
 *
 * @otel-exempt pure-function — thin wrapper over detectThrottles; its span covers it.
 * @param evidence the gathered host-throttle snapshot
 * @returns true when no contradicting throttle was found
 */
export function isBudgetReachable(evidence: ThrottleEvidence): boolean {
  return detectThrottles(evidence).length === 0;
}

/** The mirror repo's absolute-path TASKS.md target + the rendered task block. */
export interface MirrorTask {
  /** Which enterprise mirror this task is filed against. */
  mirrorRepo: MirrorRepo;
  /** The repo-relative path the I/O edge appends to (`~/apps/<repo>/TASKS.md`). */
  tasksMdPath: string;
  /** A tasks.md-spec P0 task block ready to append. */
  taskBlock: string;
}

/**
 * Render the cross-repo propagation tasks for a set of throttle findings
 * (part (d) — every host-level change emits a durable task to the mirror that
 * owns it, so minsky *pulls* the durable fix instead of re-applying a one-off,
 * per rule #1). Pure: returns the task-block text; the I/O edge appends it to
 * the mirror's `TASKS.md`. One task per `mirrorRepo` (findings sharing a repo
 * are batched into one block's sub-tasks).
 *
 * @otel os-throttle-detect.render-mirror-tasks
 * @param findings the detected budget-contradicting throttles
 * @returns one {@link MirrorTask} per distinct mirror repo, empty when no findings
 */
export function renderMirrorTasks(findings: ThrottleFinding[]): MirrorTask[] {
  const byRepo = new Map<MirrorRepo, ThrottleFinding[]>();
  for (const f of findings) {
    const list = byRepo.get(f.mirrorRepo) ?? [];
    list.push(f);
    byRepo.set(f.mirrorRepo, list);
  }
  const tasks: MirrorTask[] = [];
  for (const [mirrorRepo, repoFindings] of byRepo) {
    const subTasks = repoFindings
      .map((f) => `    - [ ] ${f.kind}: ${f.detail} Fix: ${f.remediation}`)
      .join("\n");
    const taskBlock = [
      `- [ ] minsky-budget-throttle-${mirrorRepo} — remove OS throttle(s) contradicting the minsky machine-utilisation budget`,
      `  - **ID**: minsky-budget-throttle-${mirrorRepo}`,
      "  - **Tags**: p0, deployment-infra, resource-governance, surfaced-by-minsky-autoscaler",
      "  - **Details**: minsky's os-throttle-detect found host throttle(s) that make the operator machine budget physically unreachable. Apply the durable fix here so minsky pulls it instead of re-applying a one-off.",
      subTasks,
    ].join("\n");
    tasks.push({ mirrorRepo, tasksMdPath: `~/apps/${mirrorRepo}/TASKS.md`, taskBlock });
  }
  return tasks;
}
