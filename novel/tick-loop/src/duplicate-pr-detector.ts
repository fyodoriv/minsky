// <!-- scope: human-approved P0 from 9h monitoring window 2026-05-07 (operator directive) -->

/**
 * P0 watchdog: prevent the daemon from re-creating already-shipped work.
 *
 * The 9h dogfood window 2026-05-06/07 caught worker-1 picking
 * `daemon-pre-pr-lint-gate` and re-creating the substrate that already
 * shipped via #309 — opened as PR #343, closed as duplicate. With N=5
 * workers this scales: each worker independently re-creates work whose
 * task block hasn't been removed yet.
 *
 * `decideDuplicate({ taskId, prs })` is the pure decision; the daemon
 * calls it BEFORE `gh pr create` and either:
 *   - `kind: 'open'` — there's already an open PR for this task; the
 *     daemon should switch to "fix-iterate on PR #N" instead of creating
 *     a duplicate.
 *   - `kind: 'merged-recent'` — a PR with this task ID merged within the
 *     last 7 days; the daemon should `noop, exiting` and rely on the
 *     task-rotation watchdog to remove the TASKS.md block.
 *   - `kind: 'none'` — clear to open a new PR.
 *
 * The decision is conservative: matches PRs whose title contains the
 * task ID (the daemon's branch + commit naming convention). Authored-by
 * filter is applied externally (by the caller passing only daemon-authored
 * PRs in `prs`) — the pure function doesn't know about authorship.
 *
 * @otel-exempt pure decision; the I/O wrapper feeds `gh pr list` results
 * in and runs the verdict.
 */

export type PrSnapshot = {
  readonly number: number;
  readonly title: string;
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  /** ISO-8601 — when the PR closed/merged. Required for MERGED/CLOSED. */
  readonly closedAt?: string;
};

export type DuplicateDecision =
  | { readonly kind: "open"; readonly prNumber: number }
  | { readonly kind: "merged-recent"; readonly prNumber: number; readonly daysAgo: number }
  | { readonly kind: "none" };

/**
 * Pure decision: should the daemon open a new PR for `taskId`, or is it
 * already shipped / in flight?
 *
 * `recentMergedWindowDays` (default 7) is the "merged recently enough that
 * re-opening would be a duplicate" threshold. Older merged PRs are treated
 * as `none` — the task block has presumably been re-filed legitimately.
 *
 * @otel-exempt pure decision.
 */
export function decideDuplicate(input: {
  readonly taskId: string;
  readonly prs: readonly PrSnapshot[];
  readonly now?: number;
  readonly recentMergedWindowDays?: number;
}): DuplicateDecision {
  const matching = input.prs.filter((p) => prTitleNamesTask(p.title, input.taskId));
  const open = matching.find((p) => p.state === "OPEN");
  if (open !== undefined) return { kind: "open", prNumber: open.number };
  return decideFromMerged({
    matching,
    now: input.now ?? Date.now(),
    windowDays: input.recentMergedWindowDays ?? 7,
  });
}

function decideFromMerged(input: {
  readonly matching: readonly PrSnapshot[];
  readonly now: number;
  readonly windowDays: number;
}): DuplicateDecision {
  const merged = input.matching.filter((p) => p.state === "MERGED" && p.closedAt !== undefined);
  if (merged.length === 0) return { kind: "none" };
  const mostRecent = pickMostRecentMerged(merged, input.now);
  if (mostRecent === undefined) return { kind: "none" };
  if (mostRecent.daysAgo > input.windowDays) return { kind: "none" };
  return { kind: "merged-recent", prNumber: mostRecent.prNumber, daysAgo: mostRecent.daysAgo };
}

function pickMostRecentMerged(
  merged: readonly PrSnapshot[],
  now: number,
): { readonly prNumber: number; readonly daysAgo: number } | undefined {
  let result: { prNumber: number; daysAgo: number } | undefined;
  for (const p of merged) {
    if (p.closedAt === undefined) continue;
    const days = (now - Date.parse(p.closedAt)) / (24 * 3_600_000);
    if (result === undefined || days < result.daysAgo) {
      result = { prNumber: p.number, daysAgo: days };
    }
  }
  return result;
}

/**
 * Match a PR title against a task ID. The convention is
 * `feat(<task-id>): …` or `fix(<task-id>): …` — the daemon's commit-message
 * shape — but we accept any title containing the verbatim task ID as a
 * defensive substring match (some operators write `feat: <task-id> — …`).
 *
 * @otel-exempt pure helper of `decideDuplicate`.
 */
export function prTitleNamesTask(title: string, taskId: string): boolean {
  // Word-boundary check so `daemon-pre-pr-lint-gate` doesn't match
  // `daemon-pre-pr-lint-gate-fix` (different task).
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`);
  return re.test(title);
}
