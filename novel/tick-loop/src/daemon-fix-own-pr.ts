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
