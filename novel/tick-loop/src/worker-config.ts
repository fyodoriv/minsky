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
): WorkerConfig | { readonly error: string } {
  const idRaw = valueAfter(argv, "--worker-id=");
  const totalRaw = valueAfter(argv, "--workers-total=");
  // Default (both absent, 2026-05-06): claim-aware worker-0 of 1. Was
  // previously `undefined` (no claim layer); the new default ensures every
  // daemon coordinates via `acquireTaskClaim` so additional workers can
  // join later (operator-launched OR spawned via `--spawn-additional-workers`)
  // without needing a behaviour-change on the existing process.
  if (idRaw === undefined && totalRaw === undefined) return { workerId: 0, workersTotal: 1 };
  // `--workers-total=N` alone (no `--worker-id`): defaults workerId to 0.
  // The common operator pattern is "I'm launching the root worker; sibling
  // workers will join with their own --worker-id=K".
  if (idRaw === undefined && totalRaw !== undefined) {
    return validateAndBuild(0, totalRaw, "0", totalRaw);
  }
  // `--worker-id=K` alone (no `--workers-total`) is still an error — the
  // worker can't infer how many siblings exist.
  if (idRaw !== undefined && totalRaw === undefined) {
    return {
      error:
        "--worker-id requires --workers-total (set both, or just --workers-total to default --worker-id=0)",
    };
  }
  return validateAndBuild(Number(idRaw), totalRaw as string, idRaw as string, totalRaw as string);
}

function validateAndBuild(
  workerIdNum: number,
  totalRaw: string,
  idDisplay: string,
  totalDisplay: string,
): WorkerConfig | { readonly error: string } {
  const workersTotal = Number(totalRaw);
  if (!Number.isInteger(workerIdNum) || !Number.isInteger(workersTotal)) {
    return {
      error: `--worker-id and --workers-total must both be integers (got "${idDisplay}", "${totalDisplay}")`,
    };
  }
  if (workersTotal < 1) {
    return { error: `--workers-total must be ≥1 (got ${workersTotal})` };
  }
  if (workerIdNum < 0 || workerIdNum >= workersTotal) {
    return {
      error: `--worker-id must satisfy 0 ≤ id < total; got id=${workerIdNum}, total=${workersTotal}`,
    };
  }
  return { workerId: workerIdNum, workersTotal };
}

/**
 * Decide whether the current process should fork additional worker children.
 *
 * Three-state:
 *   - `{ count: 0 }` — no spawn requested (the common case).
 *   - `{ count: N }` — spawn N children with `--worker-id=K --workers-total=(N+1)` for K in 1..N.
 *     The root process becomes worker 0 of (N+1).
 *   - `{ error }` — invalid input (non-integer, negative, OR `MINSKY_WORKER_SPAWNED=1` is set
 *     in the env, meaning this process is itself a spawned child and may not spawn further —
 *     the depth-2 cap "only grandchildren allowed" enforced at the CLI seam).
 *
 * @otel-exempt pure decision; the I/O wrapper (bin/tick-loop.mjs) does the actual fork.
 */
export function parseSpawnAdditionalWorkers(input: {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}): { readonly count: number } | { readonly error: string } {
  const raw = valueAfter(input.argv, "--spawn-additional-workers=");
  if (raw === undefined) return { count: 0 };
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 0) {
    return { error: `--spawn-additional-workers must be a non-negative integer (got "${raw}")` };
  }
  if (count === 0) return { count: 0 };
  // Depth-2 cap: a process already spawned by another worker may NOT spawn
  // its own children. The env var is set by the parent at fork time; only
  // the operator-launched root has it unset.
  if (input.env["MINSKY_WORKER_SPAWNED"] === "1") {
    return {
      error:
        "cannot spawn additional workers — MINSKY_WORKER_SPAWNED=1 in env, meaning this process is already a spawned child (depth-2 cap: only grandchildren allowed)",
    };
  }
  return { count };
}

/**
 * Compute the per-child argv given the spawn count + a child index.
 * The child gets `--worker-id=<i>` (i in 1..count), `--workers-total=(count+1)`,
 * and inherits the rest of the parent's argv minus `--spawn-additional-workers`
 * (since children must NOT recurse) and minus any `--worker-id` / `--workers-total`
 * the parent supplied (the child's are computed here).
 *
 * @otel-exempt pure args builder.
 */
export function buildChildWorkerArgs(input: {
  readonly parentArgv: readonly string[];
  readonly childIndex: number;
  readonly totalAfterSpawn: number;
}): readonly string[] {
  const stripped = input.parentArgv.filter(
    (arg) =>
      !arg.startsWith("--spawn-additional-workers=") &&
      !arg.startsWith("--worker-id=") &&
      !arg.startsWith("--workers-total="),
  );
  return [
    ...stripped,
    `--worker-id=${input.childIndex}`,
    `--workers-total=${input.totalAfterSpawn}`,
  ];
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
