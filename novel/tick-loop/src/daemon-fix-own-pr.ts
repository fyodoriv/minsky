// <!-- scope: human-approved P0 task `daemon-fix-own-pr-on-ci-failure` (TASKS.md, operator-flagged 2026-05-05) -->

/**
 * Slice 4/N for `daemon-fix-own-pr-on-ci-failure`: the pure brief builder
 * the daemon uses when `decideDaemonPrState` returns `pr-failing`. The
 * brief tells `claude --print` to push a fix commit on the existing
 * branch — NOT to redo the task and NOT to open a second PR.
 *
 * Rule #2 (single source of truth): the brief lives next to the decision
 * substrate (`daemon-pr-state.ts`) so the verdict shape and the prompt
 * that consumes it evolve together. Rule #6 (let-it-crash AT the
 * boundary): the daemon's own PR is its boundary; a green CI is the
 * contract; this builder produces the prompt that closes that loop.
 *
 * Slice 5+ wires the call site in `bin/tick-loop.mjs`:
 *
 *   const verdict = decideDaemonPrState({ taskId, prs, attemptsSoFar });
 *   const brief =
 *     verdict.kind === "pr-failing"
 *       ? buildFixCiBrief({ taskId, verdict, maxAttempts })
 *       : verdict.kind === "pr-retries-exhausted"
 *         ? buildEscalationBrief(verdict)        // slice 6+
 *         : buildDaemonBrief({ taskId, ... });
 *
 * The brief is deliberately compact (~1.2KB vs ~3.5KB for `buildDaemonBrief`):
 * the fix iteration's instructions are narrower than a normal task
 * iteration, so duplicating the standard preamble (priority-discipline,
 * security-review, self-grade template) wastes prompt budget and dilutes
 * the directive. Optimization-gate (slice-4 brief-shrinking, measurable):
 * cap the fix-CI brief at ≤1500 chars; the test asserts the cap so a
 * future expansion has to acknowledge the budget.
 *
 * @otel-exempt pure builder; the call-site span is in bin/tick-loop.mjs.
 */

import type { DaemonPrStateVerdict } from "./daemon-pr-state.js";

/**
 * The `pr-failing` arm of {@link DaemonPrStateVerdict}. Re-exported as a
 * named alias so `buildFixCiBrief` callers don't have to recreate the
 * discriminated-union narrowing inline.
 */
export type PrFailingVerdict = Extract<DaemonPrStateVerdict, { readonly kind: "pr-failing" }>;

export interface BuildFixCiBriefInput {
  readonly taskId: string;
  readonly verdict: PrFailingVerdict;
  /**
   * Mirrors `DecideDaemonPrStateInput.maxAttempts` (default 3 — TASKS.md
   * `daemon-fix-own-pr-on-ci-failure` Detail d). Surfaced in the brief so
   * `claude --print` knows how many retries remain before the pivot to
   * `Blocked: daemon-stuck` (rule #6 escalation).
   */
  readonly maxAttempts?: number;
}

/**
 * Maximum brief length, enforced by the test suite. Keeps the fix-CI
 * brief from drifting into preamble bloat. Pivot threshold (rule #9):
 * if the cap blocks a substantive instruction the daemon needs, raise
 * to 2000 — but raising MUST come with the iteration that needs it.
 */
export const FIX_CI_BRIEF_MAX_CHARS = 1500;

/**
 * Build the prompt the daemon hands to `claude --print` on a fix
 * iteration. The shape:
 *
 *   1. Header naming the PR + the failed checks.
 *   2. Anti-noop directive: push to THIS branch, no new PR.
 *   3. Anti-suppression directive: fix the failure, don't disable the
 *      lint / skip the test / bypass the hook (vision.md rule #6 — the
 *      gate IS the contract; suppressing it breaks the contract).
 *   4. Investigation hint: `gh run view --log-failed` to inspect.
 *   5. Retry budget visibility (attempt N of M).
 *
 * Pure builder — no I/O, no env reads. Test-asserted lower (cap, anchor
 * strings, attempt visibility).
 *
 * @otel-exempt pure builder; the call-site span is in bin/tick-loop.mjs.
 */
export function buildFixCiBrief(input: BuildFixCiBriefInput): string {
  const maxAttempts = input.maxAttempts ?? 3;
  const { prNumber, failedChecks, attemptNumber } = input.verdict;
  const checksList = failedChecks.map((name) => `  - \`${name}\``).join("\n");

  return [
    `# Daemon fix-CI brief — PR #${prNumber} (\`${input.taskId}\`)`,
    "",
    `Attempt ${attemptNumber} of ${maxAttempts}. ${failedChecks.length} failing CI check(s):`,
    "",
    checksList,
    "",
    "## Iteration directive",
    "",
    "Push ONE fix commit to **this branch**. Do NOT open a second PR. Do NOT redo the task. Do NOT append to TASKS.md.",
    "",
    "## Forbidden",
    "",
    "- Suppressing the lint, skipping the test, or bypassing the hook (`--no-verify`, rule disable, `.skip`). The gate IS the contract (rule #6); suppressing it just trips the next gate.",
    "- Reverting unrelated commits to clear CI. Address the named failures only.",
    "- Opening a new PR — the duplicate-PR detector will flag it.",
    "",
    "## Investigate then ship",
    "",
    "```",
    `gh pr checks ${prNumber}             # status table`,
    "gh run view --log-failed --job <id>  # failed job's log tail",
    "```",
    "",
    "1. Edit the offending file(s).",
    "2. `pnpm pre-pr-lint` — same gate CI runs (rule #2).",
    "3. Commit `fix(<task-id>): <one-line>` and push.",
    "",
    `If \`pnpm pre-pr-lint\` stays red after 3 in-iteration retries, output \`noop, exiting — pre-pr-lint-failures: <step>\`. After ${maxAttempts} fix iterations the supervisor labels the PR \`Blocked: daemon-stuck\` (rule #6 escape hatch).`,
  ].join("\n");
}

// ---- Iteration plan (slice 5/N) -------------------------------------------

/**
 * Discriminated dispatch verdict the orchestrator (`runClaimedIteration` in
 * `daemon.ts`, slice 6+) consults to decide what to spawn — or whether to
 * spawn at all. Slice 5/N for `daemon-fix-own-pr-on-ci-failure`.
 *
 * Three arms, each mapping a {@link DaemonPrStateVerdict} branch to a
 * concrete daemon action:
 *
 *   - `'spawn-standard'` (verdicts: `'no-pr'`, `'pr-clean'`) — the open PR
 *     either doesn't exist or is green; the standard task brief is what
 *     the daemon hands to `claude --print`. Iteration ships the next slice
 *     or waits on review.
 *   - `'spawn-fix-ci'` (verdict: `'pr-failing'`) — the daemon's own PR is
 *     red; the fix-CI brief replaces the standard brief. Iteration's job
 *     is "push a fix commit on this branch", not "redo the task".
 *   - `'skip-spawn-escalate'` (verdict: `'pr-retries-exhausted'`) — the
 *     daemon has burned its retry budget. The orchestrator MUST NOT spawn
 *     `claude --print` — instead it labels the PR `Blocked: daemon-stuck`
 *     and emits the escalation span (rule #6 — let-it-crash AT the
 *     boundary; the operator is the escape hatch). Skipping the spawn is
 *     the optimization: a fourth retry burns ~$0.50 of token budget for
 *     near-zero recovery probability (TASKS.md pivot threshold: >20%
 *     of failing PRs need >3 retries → switch the cap to 1).
 */
export type IterationPlan =
  | { readonly kind: "spawn-standard"; readonly brief: string }
  | { readonly kind: "spawn-fix-ci"; readonly brief: string; readonly prNumber: number }
  | {
      readonly kind: "skip-spawn-escalate";
      readonly prNumber: number;
      readonly failedChecks: readonly string[];
      readonly attemptsSoFar: number;
      readonly reason: string;
    };

export interface SelectIterationPlanInput {
  readonly taskId: string;
  readonly verdict: DaemonPrStateVerdict;
  /**
   * Standard task brief built upstream by `buildDaemonBrief({ taskId,
   * tasksMdContent })`. Passed in (not re-built here) so the planner stays
   * pure — the orchestrator owns the I/O of reading TASKS.md.
   */
  readonly standardBrief: string;
  /**
   * Mirrors {@link BuildFixCiBriefInput.maxAttempts}. Forwarded to the
   * fix-CI brief on `'pr-failing'`; surfaced in the escalation reason on
   * `'pr-retries-exhausted'` so the operator-facing log line names the cap
   * the daemon was running against.
   */
  readonly maxAttempts?: number;
}

/**
 * Pure planner: maps a {@link DaemonPrStateVerdict} to an
 * {@link IterationPlan} the orchestrator dispatches on. The bridge between
 * `decideDaemonPrState` (slice 1) and the orchestrator wire-in (slice 6+).
 *
 * Slice 5/N for `daemon-fix-own-pr-on-ci-failure`. Pure — no I/O, no env
 * reads, no clock — so the orchestrator's seam is a single planner call
 * (rule #2 — single source of truth for the dispatch decision; the
 * verdict-to-action mapping is tested here, not duplicated in tests of
 * the orchestrator).
 *
 * @otel-exempt pure planner; the call-site span is in `daemon.ts`.
 */
export function selectIterationPlan(input: SelectIterationPlanInput): IterationPlan {
  const { verdict, taskId, standardBrief } = input;
  if (verdict.kind === "no-pr" || verdict.kind === "pr-clean") {
    return { kind: "spawn-standard", brief: standardBrief };
  }
  if (verdict.kind === "pr-failing") {
    return {
      kind: "spawn-fix-ci",
      brief: buildFixCiBrief({
        taskId,
        verdict,
        ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      }),
      prNumber: verdict.prNumber,
    };
  }
  // verdict.kind === "pr-retries-exhausted"
  const cap = input.maxAttempts ?? 3;
  return {
    kind: "skip-spawn-escalate",
    prNumber: verdict.prNumber,
    failedChecks: verdict.failedChecks,
    attemptsSoFar: verdict.attemptsSoFar,
    reason: `pr-retries-exhausted: ${verdict.attemptsSoFar} of ${cap} fix attempts on PR #${verdict.prNumber} did not clear ${verdict.failedChecks.length} failing check(s); supervisor MUST label \`Blocked: daemon-stuck\` and skip the spawn (rule #6 escape hatch).`,
  };
}
