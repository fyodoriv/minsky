// <!-- scope: human-approved P0 task `daemon-fix-own-pr-on-ci-failure` (TASKS.md, operator-flagged 2026-05-05) -->

/**
 * P0 watchdog: when the daemon's own PR for the current task is failing CI,
 * the next iteration must FIX the failures rather than redo the task or
 * brief-refresh.
 *
 * Empirical observation 2026-05-05: with the `cross-repo-ci-action` task
 * block in TASKS.md (PR #167 open), the daemon iterated 80+ times producing
 * brief refreshes / noops because the PR couldn't merge while CI failed,
 * the task block couldn't be removed while the PR was open, and the daemon
 * had no path to fix CI on its own PR. **Deadlock pattern.**
 *
 * `decideDaemonPrState({ taskId, prs, attemptsSoFar })` is the pure
 * decision the daemon consults BEFORE building the iteration brief:
 *
 *   - `kind: 'no-pr'` — no open PR matches the task; iterate normally
 *     (the brief becomes the standard task brief).
 *   - `kind: 'pr-clean'` — open PR exists, no failing checks; iterate
 *     normally (the next iteration ships the next slice / waits on review).
 *   - `kind: 'pr-failing'` — open PR with ≥1 failing check; the brief
 *     becomes "Fix the failing CI checks on PR #N" with the failed-check
 *     names forwarded.
 *   - `kind: 'pr-retries-exhausted'` — `attemptsSoFar` ≥ `maxAttempts`
 *     (default 3); escalate by labelling the PR `Blocked: daemon-stuck`
 *     and synthesising a TASKS.md `Blocked: daemon-stuck` entry instead
 *     of looping forever (rule #6 — let-it-crash AT the boundary).
 *
 * The decision is **pure** (no I/O). Caller wraps with `gh pr list --head
 * <branch> --json number,title,state,statusCheckRollup` and `gh pr view
 * --json statusCheckRollup` (slice 2+). Title-based naming-convention
 * matching mirrors `decideDuplicate` in `duplicate-pr-detector.ts`.
 *
 * Pivot threshold (rule #9, TASKS.md `daemon-fix-own-pr-on-ci-failure`):
 * if >20% of failing PRs need >3 retries, the failure classes aren't
 * fixable by `claude --print` alone — switch the cap to 1 and label
 * `needs-operator` instead of looping. Slice 1 ships the cap as a
 * configurable arg so the pivot is a one-line change.
 *
 * @otel-exempt pure decision; the I/O wrapper feeds `gh pr list` results
 * in and runs the verdict at the call-site span.
 */

import { prTitleNamesTask } from "./duplicate-pr-detector.js";

// ---- Types ----------------------------------------------------------------

/**
 * Status of a single check run, as surfaced by `gh pr view --json
 * statusCheckRollup`. `conclusion` is `null` while the check is in flight
 * (status === "IN_PROGRESS" / "QUEUED" / "PENDING"); a `null` conclusion
 * is treated as **not failing** (the daemon waits rather than redo-ing).
 *
 * Conclusion values mirror GitHub's `CheckConclusionState` GraphQL enum.
 */
export type CheckRunSnapshot = {
  readonly name: string;
  readonly conclusion:
    | "SUCCESS"
    | "FAILURE"
    | "CANCELLED"
    | "TIMED_OUT"
    | "ACTION_REQUIRED"
    | "STARTUP_FAILURE"
    | "SKIPPED"
    | "NEUTRAL"
    | null;
};

/**
 * Open daemon-authored PR snapshot. Caller filters `gh pr list` to
 * `--author "@me"` (or the daemon's bot identity) so the verdict only
 * applies to PRs the daemon owns. Branch-name-based matching is also
 * acceptable upstream — the decision uses `title` for the actual match
 * (mirrors `prTitleNamesTask` in `duplicate-pr-detector.ts`).
 */
export type DaemonOwnPrSnapshot = {
  readonly number: number;
  readonly title: string;
  readonly state: "OPEN";
  readonly checks: readonly CheckRunSnapshot[];
};

export type DaemonPrStateVerdict =
  | { readonly kind: "no-pr" }
  | { readonly kind: "pr-clean"; readonly prNumber: number }
  | {
      readonly kind: "pr-failing";
      readonly prNumber: number;
      readonly failedChecks: readonly string[];
      readonly attemptNumber: number;
    }
  | {
      readonly kind: "pr-retries-exhausted";
      readonly prNumber: number;
      readonly failedChecks: readonly string[];
      readonly attemptsSoFar: number;
    };

export interface DecideDaemonPrStateInput {
  readonly taskId: string;
  readonly prs: readonly DaemonOwnPrSnapshot[];
  /**
   * How many fix iterations the daemon has already attempted on the
   * matching PR. Caller persists this across iterations (counter on the
   * PR via a label like `daemon-fix-attempt:<n>`, or a sidecar file
   * keyed by PR number — wiring TBD in slice 2+).
   *
   * Default 0. The first fix iteration emits `attemptNumber: 1`.
   */
  readonly attemptsSoFar?: number;
  /**
   * Maximum fix attempts before escalation. Default 3 (TASKS.md
   * `daemon-fix-own-pr-on-ci-failure` Detail d). Pivot to 1 if the >20%
   * pivot-threshold fires (rule #9 in the task block).
   */
  readonly maxAttempts?: number;
}

// ---- Pure decision --------------------------------------------------------

/**
 * Pure decision: should the next daemon iteration redo the task, fix CI
 * on the open PR, or escalate?
 *
 * Selection rule:
 *   1. Filter `prs` to titles matching `taskId` via `prTitleNamesTask`
 *      (the same word-boundary match the duplicate detector uses).
 *   2. If no match → `'no-pr'`.
 *   3. If matching PR has ≥1 check with a failing conclusion → either
 *      `'pr-failing'` (more retries left) or `'pr-retries-exhausted'`
 *      (cap reached).
 *   4. Otherwise (all checks passing or in-flight) → `'pr-clean'`.
 *
 * `attemptsSoFar` is the count of *prior* fix iterations the daemon has
 * run on this PR; the caller increments it and persists. The verdict's
 * `attemptNumber` is the 1-indexed attempt the daemon is about to start.
 *
 * @otel-exempt pure decision.
 */
export function decideDaemonPrState(input: DecideDaemonPrStateInput): DaemonPrStateVerdict {
  const attemptsSoFar = input.attemptsSoFar ?? 0;
  const maxAttempts = input.maxAttempts ?? 3;

  const matching = input.prs.find(
    (p) => p.state === "OPEN" && prTitleNamesTask(p.title, input.taskId),
  );
  if (matching === undefined) return { kind: "no-pr" };

  const failedChecks = matching.checks
    .filter((c) => isFailingConclusion(c.conclusion))
    .map((c) => c.name);

  if (failedChecks.length === 0) {
    return { kind: "pr-clean", prNumber: matching.number };
  }

  if (attemptsSoFar >= maxAttempts) {
    return {
      kind: "pr-retries-exhausted",
      prNumber: matching.number,
      failedChecks,
      attemptsSoFar,
    };
  }

  return {
    kind: "pr-failing",
    prNumber: matching.number,
    failedChecks,
    attemptNumber: attemptsSoFar + 1,
  };
}

/**
 * Map a `CheckRunSnapshot.conclusion` to "is this failing the merge gate?"
 *
 * Failing conclusions block the merge (`FAILURE`, `CANCELLED`, `TIMED_OUT`,
 * `ACTION_REQUIRED`, `STARTUP_FAILURE`); the daemon must address them.
 * Non-failing conclusions (`SUCCESS`, `SKIPPED`, `NEUTRAL`) and `null`
 * (still in flight) do NOT trigger a fix iteration — `null` means the
 * daemon should wait, not redo.
 *
 * @otel-exempt pure helper of `decideDaemonPrState`.
 */
export function isFailingConclusion(conclusion: CheckRunSnapshot["conclusion"]): boolean {
  return (
    conclusion === "FAILURE" ||
    conclusion === "CANCELLED" ||
    conclusion === "TIMED_OUT" ||
    conclusion === "ACTION_REQUIRED" ||
    conclusion === "STARTUP_FAILURE"
  );
}
