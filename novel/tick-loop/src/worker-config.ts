// <!-- scope: human-approved slice 2 of daemon-parallel-worktree-launch (operator 2026-05-06) -->

/**
 * Slice 2 substrate of `daemon-parallel-worktree-launch`.
 *
 * Pure helpers for per-worker namespacing: parses `--worker-id` /
 * `--workers-total` CLI flags, computes the per-worker git branch and
 * worktree names, and produces the `claude --worktree <name>` arg
 * extension consumed by `ProcessSpawnStrategy`.
 *
 * Single-process daemon (no `--worker-id` flag) bypasses everything here
 * and runs against the shared main checkout, preserving the v0 contract.
 *
 * @otel-exempt pure substrate; the spawn-strategy slice (slice 2.5) wires
 * these into the supervisor with the spawn surface fed via injected
 * dependencies.
 */
export type WorkerConfig = {
  /** Zero-indexed worker number; `0 ≤ workerId < workersTotal`. */
  readonly workerId: number;
  /** Total worker count, ≥1. `1` means "no parallelism" — the single-process default. */
  readonly workersTotal: number;
};

/**
 * Parse CLI args for `--worker-id=<n>` and `--workers-total=<N>`. Both flags
 * must be present together; either alone is an error. When both are absent,
 * returns `undefined` (single-process default).
 *
 * @otel-exempt pure parser.
 */
export function parseWorkerArgs(
  argv: readonly string[],
): WorkerConfig | { readonly error: string } | undefined {
  const idRaw = valueAfter(argv, "--worker-id=");
  const totalRaw = valueAfter(argv, "--workers-total=");
  if (idRaw === undefined && totalRaw === undefined) return undefined;
  if (idRaw === undefined || totalRaw === undefined) {
    return {
      error:
        "--worker-id and --workers-total must be passed together (set both, or neither for single-process mode)",
    };
  }
  const workerId = Number(idRaw);
  const workersTotal = Number(totalRaw);
  if (!Number.isInteger(workerId) || !Number.isInteger(workersTotal)) {
    return {
      error: `--worker-id and --workers-total must both be integers (got "${idRaw}", "${totalRaw}")`,
    };
  }
  if (workersTotal < 1) {
    return { error: `--workers-total must be ≥1 (got ${workersTotal})` };
  }
  if (workerId < 0 || workerId >= workersTotal) {
    return {
      error: `--worker-id must satisfy 0 ≤ id < total; got id=${workerId}, total=${workersTotal}`,
    };
  }
  return { workerId, workersTotal };
}

function valueAfter(argv: readonly string[], prefix: string): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

/**
 * Per-worker branch name. The namespace `daemon/<workerId>/<taskId>` makes
 * branch collisions impossible across workers — two workers picking the
 * same task can't happen (the claim layer prevents it; per parent task
 * acceptance #4 the `Touches:` glob check is the second line of defense),
 * but if it did, the branch namespaces are still disjoint.
 *
 * @otel-exempt pure naming helper.
 */
export function workerBranchName(input: {
  readonly workerId: number;
  readonly taskId: string;
}): string {
  return `daemon/${input.workerId}/${input.taskId}`;
}

/**
 * Per-worker git-worktree name. Mirrors `workerBranchName` shape but with
 * `-` separators (worktree paths can't contain `/` on POSIX without
 * implying nested dirs, which `git worktree add` doesn't allow as a name).
 *
 * @otel-exempt pure naming helper.
 */
export function workerWorktreeName(input: {
  readonly workerId: number;
  readonly taskId: string;
}): string {
  return `daemon-${input.workerId}-${input.taskId}`;
}

/**
 * Compute the `claude` invocation args for a worker — appends
 * `--worktree <name>` to the base args (typically `["--print"]`) when a
 * worker config is provided. When `workerConfig` is `undefined`, returns
 * `baseArgs` unchanged (single-process default).
 *
 * Anthropic's `claude --worktree <name>` flag (Cherny, Feb 2026) creates
 * an isolated git worktree per session and auto-cleans on session end —
 * the per-process isolation primitive that makes parallel daemons safe
 * (parent task research note (i)).
 *
 * @otel-exempt pure args builder.
 */
export function claudeArgsForWorker(input: {
  readonly baseArgs: readonly string[];
  readonly taskId: string;
  readonly workerConfig: WorkerConfig | undefined;
}): readonly string[] {
  if (input.workerConfig === undefined) return input.baseArgs;
  const name = workerWorktreeName({ workerId: input.workerConfig.workerId, taskId: input.taskId });
  return [...input.baseArgs, "--worktree", name];
}

/**
 * Format the operator-facing startup line announcing parallel mode.
 * Visible-not-silent (Beyer SRE 2016 Ch. 6) — the operator sees which
 * worker this process is and what its namespace will be.
 *
 * @otel-exempt pure formatter.
 */
export function workerStartupLine(workerConfig: WorkerConfig | undefined): string {
  if (workerConfig === undefined) return "tick-loop: single-process mode (no --worker-id set).";
  const { workerId, workersTotal } = workerConfig;
  return `tick-loop: worker ${workerId} of ${workersTotal} (branches: daemon/${workerId}/<task-id>; worktrees: daemon-${workerId}-<task-id>).`;
}
