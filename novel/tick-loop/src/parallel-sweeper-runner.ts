// <!-- scope: human-approved slice 5 of daemon-parallel-worktree-launch (operator 2026-05-07) -->

/**
 * `@minsky/tick-loop/parallel-sweeper-runner` — I/O wrapper for the
 * pure sweep decisions in `parallel-sweeper.ts`. The supervisor calls
 * `runParallelSweeper(opts)` once per tick to recover three classes of
 * debris that accumulate across N parallel workers:
 *
 *   1. **Stale `.git/index.lock`** — Claude Code's background ops can
 *      leak this file (anthropics/claude-code#11005); >5min old + no
 *      live writer = abandoned, safe to remove.
 *   2. **Expired claim leases** — `.minsky/locks/task-*.lock` whose
 *      `expiresAt` is in the past; the holding worker crashed without
 *      releasing.
 *
 * Worktree-orphan pruning (slice 4 substrate's third decision) is
 * deferred to a follow-up — it requires a `git worktree list -v`
 * caller and `git worktree prune` shell-out that's higher-blast-radius
 * than the file-unlink operations covered here. This slice prioritises
 * the two debris classes that block live workers from making progress
 * (an undeleted `.git/index.lock` blocks every git operation in that
 * worktree; an expired claim lease silently gates the next tick's
 * task pickup).
 *
 * Pattern conformance (rule #8):
 *   - **Strategy** (Gamma 1994) — every I/O dependency (file read,
 *     file unlink, `path.join`) is injected, so tests exercise the
 *     orchestration logic against synthetic fixtures and production
 *     wires the real `node:fs` calls.
 *   - **Fail-safe defaults** (Saltzer & Schroeder 1975) — on any
 *     unrecoverable error reading a file, the runner logs and skips
 *     (doesn't propagate the crash) so a single corrupt lock file
 *     doesn't take the whole sweep down.
 *   - **Visible-not-silent** (Beyer SRE 2016 Ch. 6) — every sweep
 *     emits a `tick-loop.parallel-sweeper.tick` span with the
 *     swept/kept counts so the operator log answers "did the sweeper
 *     find anything this tick?".
 *
 * @otel tick-loop.parallel-sweeper.tick (one per `runParallelSweeper` invocation)
 */

import {
  type ClaimLockSnapshot,
  type SweepDecision,
  decideExpiredClaim,
  decideStaleIndexLock,
  summarizeSweepDecisions,
} from "./parallel-sweeper.js";

/**
 * Result of a single sweep tick. Aggregates counts + reasons across
 * both sweep classes (index-lock + claim-lease). The supervisor logs
 * this per-tick; the dashboard tile (follow-up slice 9) renders it.
 */
export type SweeperTickResult = {
  /** Total `.git/index.lock` files unlinked this tick. */
  readonly indexLocksSwept: number;
  /** Total `.minsky/locks/task-*.lock` files unlinked this tick. */
  readonly expiredClaimsSwept: number;
  /** Per-decision reasons (truncated at 20 entries to keep span size bounded). */
  readonly reasons: readonly string[];
  /** When `true`, the sweeper hit a non-fatal error reading a file (per-file recovery). */
  readonly hadRecoverableErrors: boolean;
};

/**
 * I/O surface — every dependency injected for testing. Production
 * wires real `fs.readdirSync` / `fs.statSync` / `fs.readFileSync` /
 * `fs.unlinkSync` to these.
 */
export type SweeperIo = {
  /** `now` accessor — production: `Date.now()`. Tests: a fixed value. */
  readonly now: () => number;
  /** Whether the path exists. */
  readonly exists: (path: string) => boolean;
  /** Stat → mtime in ms. Returns `undefined` when the path can't be statted. */
  readonly mtimeMs: (path: string) => number | undefined;
  /** Read text — returns `undefined` on read failure. */
  readonly readText: (path: string) => string | undefined;
  /** List filenames in a dir (no recursion). Returns `[]` when the dir doesn't exist. */
  readonly listDir: (dir: string) => readonly string[];
  /** Unlink. Returns true on success, false on failure (logs + continues). */
  readonly unlink: (path: string) => boolean;
};

/**
 * Inputs for `runParallelSweeper`.
 */
export type SweeperRunInput = {
  /** Path to the repo root (== MINSKY_HOME in production). */
  readonly minskyHome: string;
  /** Optional `staleAfterMs` for index-lock decisions. Default 5 min. */
  readonly indexLockStaleAfterMs?: number;
  /** Injected I/O surface. */
  readonly io: SweeperIo;
};

/**
 * Sweep stale `.git/index.lock` files + expired `.minsky/locks/task-*.lock`
 * leases. Returns aggregate counters; emits no spans itself (caller
 * wraps in a `tick-loop.parallel-sweeper.tick` span with the result).
 *
 * Per-file errors do NOT abort the sweep — each file's failure is
 * accumulated into `hadRecoverableErrors` and the sweep continues
 * across remaining files. This matches the rule-#7 graceful-degrade
 * contract: one corrupt lock file doesn't gate the rest of the
 * cleanup.
 *
 * @otel-exempt I/O wrapper; the daemon's caller emits the span.
 */
export function runParallelSweeper(input: SweeperRunInput): SweeperTickResult {
  const indexLockResult = sweepIndexLocks(input);
  const claimLockResult = sweepExpiredClaims(input);
  return {
    indexLocksSwept: indexLockResult.swept,
    expiredClaimsSwept: claimLockResult.swept,
    reasons: [...indexLockResult.reasons, ...claimLockResult.reasons].slice(0, 20),
    hadRecoverableErrors: indexLockResult.errors || claimLockResult.errors,
  };
}

/**
 * Sweep `.git/index.lock` (root) + `.git/worktrees/<name>/index.lock`
 * (per-worker worktree). `git worktree list` enumerates the worktrees;
 * we approximate by listing `.git/worktrees/`'s subdirs (each contains
 * one `index.lock` candidate).
 */
function sweepIndexLocks(input: SweeperRunInput): {
  swept: number;
  reasons: string[];
  errors: boolean;
} {
  const candidates = collectIndexLockCandidates(input);
  const decisions: SweepDecision<string>[] = [];
  let errors = false;
  for (const path of candidates) {
    const decision = decideOneIndexLock(input, path);
    if (decision === undefined) {
      errors = true;
      continue;
    }
    decisions.push(decision);
    if (decision.verdict === "sweep" && !input.io.unlink(decision.target)) {
      errors = true;
    }
  }
  const summary = summarizeSweepDecisions(decisions);
  return { swept: summary.swept, reasons: [...summary.reasons], errors };
}

/** Collect candidate index-lock paths (root + per-worktree). */
function collectIndexLockCandidates(input: SweeperRunInput): readonly string[] {
  const candidates: string[] = [];
  const rootLock = `${input.minskyHome}/.git/index.lock`;
  if (input.io.exists(rootLock)) candidates.push(rootLock);
  const worktreesDir = `${input.minskyHome}/.git/worktrees`;
  if (input.io.exists(worktreesDir)) {
    for (const name of input.io.listDir(worktreesDir)) {
      const path = `${worktreesDir}/${name}/index.lock`;
      if (input.io.exists(path)) candidates.push(path);
    }
  }
  return candidates;
}

/** Decide a single index-lock; returns undefined when mtime probe fails. */
function decideOneIndexLock(
  input: SweeperRunInput,
  path: string,
): SweepDecision<string> | undefined {
  const mtime = input.io.mtimeMs(path);
  if (mtime === undefined) return undefined;
  return decideStaleIndexLock({
    path,
    mtimeMs: mtime,
    now: input.io.now(),
    ...(input.indexLockStaleAfterMs !== undefined
      ? { staleAfterMs: input.indexLockStaleAfterMs }
      : {}),
  });
}

/**
 * Sweep `.minsky/locks/task-*.lock` claim files whose `expiresAt` is
 * in the past. The lock body is JSON of shape `{taskId, workerId,
 * claimedAt, expiresAt}`; malformed files (parse error or missing
 * fields) are skipped with `errors=true` rather than swept (the
 * existing `worker-claim.ts` stale-recovery path handles malformed
 * locks at acquire time).
 */
function sweepExpiredClaims(input: SweeperRunInput): {
  swept: number;
  reasons: string[];
  errors: boolean;
} {
  const locksDir = `${input.minskyHome}/.minsky/locks`;
  if (!input.io.exists(locksDir)) return { swept: 0, reasons: [], errors: false };
  const decisions: SweepDecision<string>[] = [];
  let errors = false;
  for (const name of input.io.listDir(locksDir)) {
    if (!name.startsWith("task-") || !name.endsWith(".lock")) continue;
    const decision = decideOneClaim(input, `${locksDir}/${name}`);
    if (decision === undefined) {
      errors = true;
      continue;
    }
    decisions.push(decision);
    if (decision.verdict === "sweep" && !input.io.unlink(decision.target)) {
      errors = true;
    }
  }
  const summary = summarizeSweepDecisions(decisions);
  return { swept: summary.swept, reasons: [...summary.reasons], errors };
}

/** Decide a single claim lock; returns undefined when read or parse fails. */
function decideOneClaim(input: SweeperRunInput, path: string): SweepDecision<string> | undefined {
  const text = input.io.readText(path);
  if (text === undefined) return undefined;
  const snapshot = parseLockSnapshot(path, text);
  if (snapshot === undefined) return undefined;
  return decideExpiredClaim({ snapshot, now: input.io.now() });
}

/**
 * Parse a `task-*.lock` body into a `ClaimLockSnapshot`. Malformed input
 * returns `undefined`; the caller's `errors=true` flag carries this so
 * the per-tick span surfaces "had errors" without aborting the whole
 * sweep.
 */
function parseLockSnapshot(path: string, text: string): ClaimLockSnapshot | undefined {
  try {
    const obj = JSON.parse(text) as Partial<ClaimLockSnapshot> & Record<string, unknown>;
    if (typeof obj["expiresAt"] !== "number") return undefined;
    if (typeof obj["workerId"] !== "string") return undefined;
    return { path, expiresAt: obj["expiresAt"], workerId: obj["workerId"] };
    // rule-6: handled-locally — malformed JSON returns undefined; the caller flags errors=true
  } catch {
    return undefined;
  }
}
