// <!-- scope: human-approved 2026-05-05 user request "audit itself after every task completion with that cto-ish level loop, so that with every task completed Minsky becomes more powerful" -->
/**
 * Post-task CTO audit — pure brief builder.
 *
 * Pattern: Strategy seam (rule #2 — `runCtoAudit` is the I/O boundary
 * in `daemon.ts`; this module is the pure decision function the spawn
 * brief is derived from). Every input is data (signals from the
 * just-completed iteration); output is a string (the prompt header
 * the daemon hands to its next claude --print invocation).
 *
 * Source: 2026-05-05 user directive — "I want Minsky to audit itself
 * after every task completion with that cto-ish level loop, so that
 * with every task completed Minsky becomes more powerful." The
 * defensive counterpart is `scripts/self-diagnose.mjs`'s throughput
 * invariants (catch failure classes); this is the offensive
 * counterpart (find next leverage).
 *
 * Conformance: full — pure builder, deterministic given the same
 * signals (rule #10), tested per signal type. The CTO-mode prompt
 * itself is data (the `CTO_PROMPT_HEADER` constant), so brief drift
 * surfaces in tests rather than silently in production.
 *
 * Pivot (rule #9): if the CTO-mode brief fires too aggressively
 * (>5 tasks/day) OR too conservatively (0 tasks/week sustained 4
 * weeks), tune the prompt template — don't retire the architecture;
 * only the prompt needs tuning. Hard-pivot at 4 consecutive weeks
 * with <1 audit-filed task that ships.
 */

/** Signals the just-completed iteration emits. */
export interface CompletedIterationSignals {
  /** TASKS.md `**ID**:` of the task that just completed. */
  readonly completedTaskId: string;
  /** Optional URL of the PR opened by the iteration; null if no PR opened. */
  readonly prUrl: string | null;
  /** Files changed by the iteration (relative paths). Empty array = no commit. */
  readonly filesChanged: readonly string[];
  /** First-line commit messages of the last N (≤10) commits on main, oldest-first. */
  readonly recentMainCommits: readonly string[];
  /** Count of currently-open issues + PRs (drift signal — does the queue grow faster than it drains?). */
  readonly openWorkItems: number;
  /** Lint pass-rate snapshot — `{lintName: passRate0to1}`. Empty object = no signal yet. */
  readonly lintScores: Readonly<Record<string, number>>;
}

/** The CTO-mode prompt header. Data, not code — tested. */
export const CTO_PROMPT_HEADER = [
  "You are reviewing what just shipped from a CTO perspective.",
  "",
  "Goal: find the single highest-leverage next task.",
  "",
  "Bias toward:",
  "  (1) automation that removes operator babysitting;",
  "  (2) instrumentation gaps that mask drift;",
  "  (3) duplicated patterns that should become a primitive;",
  "  (4) failure classes likely to recur.",
  "",
  "Output: 1-3 task blocks with full rule-#9 substrate, written directly into",
  "TASKS.md at:",
  "  - P0 if the leverage is mechanical (CI lint, automation);",
  "  - P1 if it's a feature;",
  "  - P2 if it's docs/polish.",
  "",
  "Refuse to file vanity-metric tasks (Ries 2011 — counts that always go up:",
  "LOC, commits, hours, tasks-in-flight). The metric must be falsifiable.",
  "",
  "If no high-leverage task is visible, say so explicitly — don't fabricate work.",
  "",
].join("\n");

/**
 * Build the CTO-audit brief — the prompt the daemon hands to its next
 * claude --print invocation after a successful iteration.
 *
 * @otel tick-loop.post-task-cto-audit.build-brief
 */
export function buildCtoBrief(signals: CompletedIterationSignals): string {
  const filesSection =
    signals.filesChanged.length === 0
      ? "Files changed: (none — iteration may have been a no-op brief refresh)"
      : `Files changed (${signals.filesChanged.length}):\n${signals.filesChanged.map((f) => `  - ${f}`).join("\n")}`;

  const commitsSection =
    signals.recentMainCommits.length === 0
      ? "Recent main commits: (none)"
      : `Recent main commits (oldest-first):\n${signals.recentMainCommits.map((c) => `  - ${c}`).join("\n")}`;

  const lintSection =
    Object.keys(signals.lintScores).length === 0
      ? "Lint pass-rates: (no signal yet)"
      : `Lint pass-rates (rolling 30d, 0 = always-fail, 1 = always-pass):\n${Object.entries(
          signals.lintScores,
        )
          .map(([name, rate]) => `  - ${name}: ${(rate * 100).toFixed(0)}%`)
          .join("\n")}`;

  return [
    CTO_PROMPT_HEADER,
    "## Just-completed iteration",
    "",
    `Task: \`${signals.completedTaskId}\``,
    `PR: ${signals.prUrl ?? "(no PR opened)"}`,
    "",
    filesSection,
    "",
    commitsSection,
    "",
    `Open work items (issues + PRs): ${signals.openWorkItems}`,
    "",
    lintSection,
    "",
    "## Your task now",
    "",
    "Identify the single highest-leverage next task that, if shipped, makes the next iteration faster, safer, or more autonomous. File it as a TASKS.md block at the right priority. If you cannot identify a high-leverage task, say so and stop.",
  ].join("\n");
}

/**
 * Should the CTO audit run for this iteration's signals? Skips no-op
 * iterations + budget-paused + when MINSKY_CTO_AUDIT=off.
 *
 * @otel-exempt pure decision function — `runCtoAudit` carries the
 *   audit-execution span; this is the gate.
 */
export function shouldRunCtoAudit(args: {
  readonly status: "completed" | "budget-paused" | "failed" | "no-task" | "missing-tasks-md";
  readonly filesChanged: readonly string[];
  readonly prUrl: string | null;
  readonly env: Readonly<Record<string, string | undefined>>;
}): boolean {
  if (args.env["MINSKY_CTO_AUDIT"] === "off") return false;
  if (args.status !== "completed") return false;
  if (args.filesChanged.length === 0 && args.prUrl === null) return false;
  return true;
}

// ---- runCtoAudit (I/O wrapper) -------------------------------------------

/**
 * Minimum spawn surface `runCtoAudit` depends on. Structurally compatible
 * with `tick-loop/spawn-strategy.ts` `SpawnStrategy` so the daemon can pass
 * its already-constructed spawn strategy in without an adapter.
 */
export interface CtoAuditSpawn {
  spawn(input: {
    readonly taskId: string;
    readonly brief: string;
    readonly env: Readonly<Record<string, string | undefined>>;
  }): Promise<{
    readonly exitCode: number;
    readonly durationMs: number;
    readonly stdoutTail: string;
    readonly stderrTail: string;
  }>;
}

/**
 * Idempotent per-task lock seam — `lockExists` returns whether an audit
 * for `taskId` has already been recorded; `acquireLock` records one.
 * Production wires these to `.minsky/cto-audit-lock/<taskId>` file presence
 * + creation; tests pass an in-memory Set.
 */
export interface CtoAuditLock {
  lockExists(taskId: string): boolean;
  acquireLock(taskId: string): void;
}

export type RunCtoAuditOutcome =
  | { readonly outcome: "skipped"; readonly reason: SkipReason }
  | {
      readonly outcome: "ran";
      readonly exitCode: number;
      readonly durationMs: number;
      readonly stdoutTail: string;
      readonly stderrTail: string;
    };

export type SkipReason = "gate-rejected" | "no-recurse" | "lock-held";

export interface RunCtoAuditArgs {
  readonly signals: CompletedIterationSignals;
  readonly status: "completed" | "budget-paused" | "failed" | "no-task" | "missing-tasks-md";
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly spawn: CtoAuditSpawn;
  readonly lock: CtoAuditLock;
}

/**
 * Run the CTO audit for the just-completed iteration. The I/O wrapper
 * around `buildCtoBrief` + `shouldRunCtoAudit` (rule #2 — this is the
 * boundary; the gate + brief builder are pure).
 *
 * Skip order is observable + tested:
 *   1. `shouldRunCtoAudit` gate (status / no-op / env override)
 *   2. no-recurse — the audit's own iteration (`task.id === "cto-audit"`)
 *      MUST NOT trigger another audit, or the loop diverges (one audit
 *      per ship, full stop — task spec sub-step (f))
 *   3. lock-held — at most one audit per `completedTaskId`, idempotent
 *      across daemon restarts (the lock persists across process boundaries
 *      via the file-system-backed implementation in production)
 *
 * Lock acquisition happens BEFORE spawn so a crash mid-spawn doesn't yield
 * a duplicate audit on restart. The lock is the audit's "this happened"
 * record, not its "this succeeded" record — operator review of the PR is
 * the success surface (task spec sub-step (e)).
 *
 * @otel tick-loop.post-task-cto-audit.run
 */
export async function runCtoAudit(args: RunCtoAuditArgs): Promise<RunCtoAuditOutcome> {
  const gateAllows = shouldRunCtoAudit({
    status: args.status,
    filesChanged: args.signals.filesChanged,
    prUrl: args.signals.prUrl,
    env: args.env,
  });
  if (!gateAllows) return { outcome: "skipped", reason: "gate-rejected" };

  if (args.signals.completedTaskId === "cto-audit") {
    return { outcome: "skipped", reason: "no-recurse" };
  }

  if (args.lock.lockExists(args.signals.completedTaskId)) {
    return { outcome: "skipped", reason: "lock-held" };
  }
  args.lock.acquireLock(args.signals.completedTaskId);

  const brief = buildCtoBrief(args.signals);
  const result = await args.spawn.spawn({
    taskId: `cto-audit:${args.signals.completedTaskId}`,
    brief,
    env: args.env,
  });

  return {
    outcome: "ran",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
  };
}
