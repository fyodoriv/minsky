// <!-- scope: human-approved slice 4 of daemon-parallel-worktree-launch (operator 2026-05-06) -->

/**
 * Slice 4 substrate of `daemon-parallel-worktree-launch`.
 *
 * Pure decision functions for the parallel-worker sweeper. The sweeper
 * runs every tick and removes three classes of debris that accumulate
 * across N parallel workers:
 *
 *   1. **Stale `.git/index.lock`** — Claude Code's background ops can
 *      leak this file (anthropics/claude-code#11005); >5min old + no
 *      live writer = abandoned, safe to remove.
 *   2. **Expired claim leases** — `.minsky/locks/task-*.lock` whose
 *      `expiresAt` is in the past; the holding worker crashed without
 *      releasing.
 *   3. **Orphaned worktrees** — `git worktree list` entries whose
 *      branches no longer have an open PR and whose mtime is >24h old;
 *      the worker exited without cleaning up.
 *
 * The pure functions here decide WHAT to sweep; the I/O wrapper (next
 * slice) executes the unlinks + `git worktree prune --expire`. Tested
 * against fixtures, no shelling out from the unit tests.
 *
 * @otel-exempt pure substrate; the I/O wrapper emits
 * `claim_collision`, `stale_lock_recovered`, and `worktree_orphan_pruned`
 * counters per parent task slice 7.
 */

export type SweepDecision<T> =
  | { readonly verdict: "keep" }
  | { readonly verdict: "sweep"; readonly reason: string; readonly target: T };

/**
 * Decide whether a `.git/index.lock` file is stale and safe to remove.
 *
 * Truth table:
 *   - file does not exist        → keep (caller's "exists?" probe is false)
 *   - mtime is within `staleAfterMs` ms of `now`  → keep (live writer)
 *   - mtime is older than threshold              → sweep
 *
 * Default `staleAfterMs` = 5 min, matching the documented Claude Code
 * #11005 workaround window.
 *
 * @otel-exempt pure decision.
 */
export function decideStaleIndexLock(input: {
  readonly path: string;
  readonly mtimeMs: number;
  readonly now: number;
  readonly staleAfterMs?: number;
}): SweepDecision<string> {
  const threshold = input.staleAfterMs ?? 5 * 60_000;
  const ageMs = input.now - input.mtimeMs;
  if (ageMs <= threshold) return { verdict: "keep" };
  return {
    verdict: "sweep",
    reason: `index-lock age ${ageMs}ms exceeds threshold ${threshold}ms`,
    target: input.path,
  };
}

export type ClaimLockSnapshot = {
  readonly path: string;
  readonly expiresAt: number;
  readonly workerId: string;
};

/**
 * Decide whether a `.minsky/locks/task-*.lock` claim has expired and
 * should be unlinked. Mirrors the stale-recovery logic in
 * `worker-claim.ts` (#274) but operates on the sweeper's bulk view —
 * the worker's own per-claim path uses `O_EXCL` retry, this one
 * proactively cleans up across the whole locks dir on a fixed cadence.
 *
 * @otel-exempt pure decision.
 */
export function decideExpiredClaim(input: {
  readonly snapshot: ClaimLockSnapshot;
  readonly now: number;
}): SweepDecision<string> {
  if (input.snapshot.expiresAt > input.now) return { verdict: "keep" };
  return {
    verdict: "sweep",
    reason: `claim by ${input.snapshot.workerId} expired ${input.now - input.snapshot.expiresAt}ms ago`,
    target: input.snapshot.path,
  };
}

export type WorktreeSnapshot = {
  readonly name: string;
  readonly branch: string;
  readonly mtimeMs: number;
};

/**
 * Decide whether a `git worktree`-managed dir is orphaned and prunable.
 * A worktree is orphaned when:
 *   1. its branch is in the `daemon-<id>-` namespace (we don't sweep
 *      operator-created worktrees), AND
 *   2. its branch has no open PR (caller passes the open-PR set), AND
 *   3. its mtime is older than `orphanAfterMs` (default 24 h).
 *
 * Operator-created worktrees (branches not matching the `daemon-`
 * prefix) are always `keep` — the sweeper's blast radius is bounded to
 * daemon-namespace artefacts only.
 *
 * @otel-exempt pure decision.
 */
export function decideOrphanedWorktree(input: {
  readonly snapshot: WorktreeSnapshot;
  readonly openBranches: readonly string[];
  readonly now: number;
  readonly orphanAfterMs?: number;
}): SweepDecision<string> {
  if (!isDaemonNamespace(input.snapshot.branch)) return { verdict: "keep" };
  if (input.openBranches.includes(input.snapshot.branch)) return { verdict: "keep" };
  const threshold = input.orphanAfterMs ?? 24 * 3_600_000;
  const ageMs = input.now - input.snapshot.mtimeMs;
  if (ageMs < threshold) return { verdict: "keep" };
  return {
    verdict: "sweep",
    reason: `daemon-namespace worktree ${input.snapshot.name} (branch ${input.snapshot.branch}) orphaned for ${ageMs}ms`,
    target: input.snapshot.name,
  };
}

function isDaemonNamespace(branch: string): boolean {
  return branch.startsWith("daemon/") || branch.startsWith("daemon-");
}

/**
 * Roll up multiple sweep decisions into one summary. Convenience for the
 * I/O wrapper's per-tick counter emission and the dashboard tile.
 *
 * @otel-exempt pure aggregator.
 */
export function summarizeSweepDecisions(decisions: readonly SweepDecision<unknown>[]): {
  readonly kept: number;
  readonly swept: number;
  readonly reasons: readonly string[];
} {
  let kept = 0;
  let swept = 0;
  const reasons: string[] = [];
  for (const d of decisions) {
    if (d.verdict === "keep") kept += 1;
    else {
      swept += 1;
      reasons.push(d.reason);
    }
  }
  return { kept, swept, reasons };
}
