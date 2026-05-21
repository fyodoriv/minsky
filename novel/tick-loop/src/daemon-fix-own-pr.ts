// <!-- scope: human-approved P0 task `daemon-fix-own-pr-on-ci-failure` (TASKS.md, operator-flagged 2026-05-05) -->

/**
 * Slice 3/N of `daemon-fix-own-pr-on-ci-failure`: the fix-iteration entry.
 *
 * Slices 1+2 (`daemon-pr-state.ts`) shipped the pure decision
 * (`decideDaemonPrState`) and the `gh pr list` JSON parser
 * (`parseGhPrListForDaemonPrState`). This module composes them into the
 * two surfaces the bin wire-in (slice 4) calls:
 *
 *   - `resolveDaemonPrStateFromGh({execFile, taskId, branch, …})` — the
 *     I/O wrapper. Runs `gh pr list --head <branch> --state open --json
 *     number,title,state,statusCheckRollup`, feeds the parser, and runs
 *     the verdict. The injected `execFile` is the only side-effect surface
 *     (mirrors `createGitGhSignalsBuilder` in `cto-audit-cli-wiring.ts`)
 *     so tests drive it deterministically without spawning `gh`.
 *
 *   - `planDaemonFixIteration(verdict, …)` — the pure planner. Turns a
 *     `DaemonPrStateVerdict` into the daemon's next move:
 *       · `standard-task-brief` — no open PR / PR is clean; the daemon
 *         builds its normal task brief (unchanged behaviour).
 *       · `fix-brief` — open PR with failing CI; the daemon passes
 *         `brief` to `claude --print` instead of redoing the task. The
 *         brief explicitly forbids suppressing the failure (Risk
 *         mitigation in the task block: a wrong fix-brief could suppress
 *         a lint instead of fixing the violation).
 *       · `escalate` — retries exhausted; the daemon labels the PR
 *         `Blocked: daemon-stuck` and files an operator-actionable
 *         TASKS.md entry (the I/O for this is slice 4; the planner only
 *         emits the typed intent + the human-readable summary).
 *
 * Why a discriminated union rather than `string | null`: the bin wire-in
 * has three distinct actions (iterate normally / fix-iterate / escalate).
 * Collapsing `escalate` into `null` would conflate "no PR, iterate" with
 * "give up, escalate" — the deadlock this task exists to break. The union
 * keeps the seam honest for slice 4.
 *
 * Graceful-degrade per rule #6/#7: a `gh` outage (offline, rate-limit,
 * binary missing) resolves to `{kind:'no-pr'}` — the daemon iterates
 * normally rather than crashing. The other daemon gates
 * (`duplicate-pr-detector`, the pre-pr-lint gate) backstop the
 * conservative default.
 *
 * @module tick-loop/daemon-fix-own-pr
 */

import {
  type DaemonPrStateVerdict,
  decideDaemonPrState,
  parseGhPrListForDaemonPrState,
} from "./daemon-pr-state.js";

// ---- I/O wrapper ----------------------------------------------------------

/**
 * Minimum subprocess surface the resolver depends on. Production wires
 * `node:child_process.execFile` with `{encoding:'utf-8'}`; tests pass a
 * deterministic stub returning frozen `gh` JSON. Returns trimmed stdout;
 * a rejected promise is the graceful-degrade signal.
 */
export type ExecFileLike = (file: string, args: readonly string[]) => Promise<string>;

export interface ResolveDaemonPrStateOpts {
  readonly execFile: ExecFileLike;
  readonly taskId: string;
  /**
   * The daemon's branch for this task (the `--head` server-side filter).
   * Empty/whitespace ⇒ the daemon has no PR context this iteration; the
   * resolver short-circuits to `{kind:'no-pr'}` WITHOUT spawning `gh`
   * (round-trip elimination — see the skip-earlier gate below).
   */
  readonly branch: string;
  /**
   * Prior fix iterations attempted on the matching PR (persisted by the
   * caller across iterations — wiring in slice 4). Default 0.
   */
  readonly attemptsSoFar?: number;
  /** Max fix attempts before escalation. Default 3 (task Detail d). */
  readonly maxAttempts?: number;
}

/**
 * Resolve the daemon-PR-state verdict for the current task by shelling
 * out to `gh` and feeding the slice-1/2 parser + decision.
 *
 * Skip-earlier gate (round-trip-elimination optimization): when `branch`
 * is empty/whitespace the daemon has no PR for this task yet (e.g. the
 * first iteration before any push), so the `gh` subprocess is pure
 * overhead — short-circuit to `{kind:'no-pr'}`. The decision would return
 * `no-pr` anyway (no branch ⇒ `--head` matches nothing), so this only
 * elides a guaranteed-empty round-trip; behaviour is unchanged.
 *
 * @otel-exempt thin async wrapper; the `bin/tick-loop.mjs` boundary
 *   carries the iteration span (slice 4 wires the call site).
 */
export async function resolveDaemonPrStateFromGh(
  opts: ResolveDaemonPrStateOpts,
): Promise<DaemonPrStateVerdict> {
  if (opts.branch.trim() === "") return { kind: "no-pr" };

  const raw = await opts
    .execFile("gh", [
      "pr",
      "list",
      "--head",
      opts.branch,
      "--state",
      "open",
      "--json",
      "number,title,state,statusCheckRollup",
    ])
    // rule-6: handled-locally — graceful-degrade per rule #7; a `gh`
    // outage must not crash the daemon iteration. Empty string → the
    // parser yields [] → the decision yields `no-pr` (iterate normally).
    .catch(() => "");

  const prs = parseGhPrListForDaemonPrState(raw);
  // Spread the optional caps only when set: `exactOptionalPropertyTypes`
  // rejects an explicit `undefined` on an optional property.
  return decideDaemonPrState({
    taskId: opts.taskId,
    prs,
    ...(opts.attemptsSoFar !== undefined ? { attemptsSoFar: opts.attemptsSoFar } : {}),
    ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
  });
}

// ---- Pure planner ---------------------------------------------------------

/** The `Blocked:` short-code the escalation labels the PR with and tags
 *  the synthesised TASKS.md entry (task Detail d; rule #6 operator-escape
 *  hatch; Beyer SRE 2016 Ch. 6). */
export const DAEMON_STUCK_LABEL = "Blocked: daemon-stuck";

export type DaemonFixPlan =
  /** No open PR, or the PR's checks are all passing/in-flight — the
   *  daemon builds its normal task brief (behaviour unchanged). */
  | { readonly kind: "standard-task-brief" }
  /** Open PR with failing CI and retries remaining — the daemon passes
   *  `brief` to `claude --print` instead of redoing the task. */
  | {
      readonly kind: "fix-brief";
      readonly prNumber: number;
      readonly attemptNumber: number;
      readonly failedChecks: readonly string[];
      readonly brief: string;
    }
  /** Retries exhausted — the daemon labels the PR `Blocked:
   *  daemon-stuck` and files the `summary` as an operator-actionable
   *  TASKS.md entry instead of looping forever. */
  | {
      readonly kind: "escalate";
      readonly prNumber: number;
      readonly failedChecks: readonly string[];
      readonly label: string;
      readonly summary: string;
    };

export interface PlanDaemonFixIterationOpts {
  /**
   * Optional excerpt of `gh run view --log-failed <id>` output the caller
   * fetched for the failing run. Forwarded verbatim into the fix-brief so
   * `claude --print` sees the actual failure, not just check names.
   * Slice 4 wires the log fetch; until then the brief lists check names.
   */
  readonly failureLogExcerpt?: string;
}

/**
 * Pure: turn a `DaemonPrStateVerdict` into the daemon's next move.
 *
 * The fix-brief deliberately forbids suppressing the failure (the task
 * block's Risk: a wrong brief could `// biome-ignore` a violation instead
 * of fixing it; the in-tree pre-push lint stack is the backstop, but the
 * brief is the first line of defence).
 *
 * @otel-exempt pure planner; the I/O for `escalate` (label + file task)
 *   is the caller's (slice 4).
 */
export function planDaemonFixIteration(
  verdict: DaemonPrStateVerdict,
  opts: PlanDaemonFixIterationOpts = {},
): DaemonFixPlan {
  switch (verdict.kind) {
    case "no-pr":
    case "pr-clean":
      return { kind: "standard-task-brief" };
    case "pr-failing":
      return {
        kind: "fix-brief",
        prNumber: verdict.prNumber,
        attemptNumber: verdict.attemptNumber,
        failedChecks: verdict.failedChecks,
        brief: buildFixBrief(verdict.prNumber, verdict.failedChecks, opts.failureLogExcerpt),
      };
    case "pr-retries-exhausted":
      return {
        kind: "escalate",
        prNumber: verdict.prNumber,
        failedChecks: verdict.failedChecks,
        label: DAEMON_STUCK_LABEL,
        summary: buildEscalationSummary(
          verdict.prNumber,
          verdict.failedChecks,
          verdict.attemptsSoFar,
        ),
      };
  }
}

function buildFixBrief(
  prNumber: number,
  failedChecks: readonly string[],
  failureLogExcerpt: string | undefined,
): string {
  const checks = failedChecks.join(", ");
  const logSection =
    failureLogExcerpt !== undefined && failureLogExcerpt.trim() !== ""
      ? `\n\nFailure log excerpt:\n${failureLogExcerpt.trim()}`
      : "";
  return [
    `Fix the failing CI checks on PR #${prNumber}. Failing checks: ${checks}.`,
    "Push the fix as a commit on the SAME branch — do NOT open a new PR, do NOT redo the task from scratch.",
    "Fix the root cause of each failure. Do NOT suppress the check (no inline lint-ignore, no skipped test, no weakened assertion) — a suppressed failure is not a fix and will be rejected.",
    `${logSection}`,
  ]
    .join("\n")
    .trimEnd();
}

function buildEscalationSummary(
  prNumber: number,
  failedChecks: readonly string[],
  attemptsSoFar: number,
): string {
  return [
    `Daemon exhausted ${attemptsSoFar} CI-fix attempt(s) on PR #${prNumber} and the checks are still red: ${failedChecks.join(
      ", ",
    )}.`,
    "The failure class is not fixable by `claude --print` alone (rule #9 pivot). Operator action required:",
    `inspect PR #${prNumber}, resolve the failing checks (or close the PR if the approach is wrong), then remove this block.`,
  ].join(" ");
}
