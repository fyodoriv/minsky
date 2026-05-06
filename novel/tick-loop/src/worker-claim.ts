// <!-- scope: human-approved slice 1 of daemon-parallel-worktree-launch (operator 2026-05-06) -->
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Slice 1 substrate of `daemon-parallel-worktree-launch`.
 *
 * Pure decision function {@link decideClaim} + I/O wrapper {@link acquireTaskClaim}.
 * Uses `O_EXCL` file-creation atomicity (no native flock dependency) which is
 * sufficient for single-host coordination per Kleppmann 2016. Lease TTL is
 * written into the lock body so external operators can see who holds what.
 * On `EEXIST`, the stale-TTL eviction path reads the existing lock, checks
 * expiry, and recovers if abandoned.
 *
 * @otel-exempt pure substrate; the spawn-strategy slice (slice 2) wires this
 * into the supervisor with the I/O surface fed via injected dependencies.
 */
export type LockBody = {
  readonly taskId: string;
  readonly workerId: string;
  readonly claimedAt: number;
  readonly expiresAt: number;
};

export type ClaimDecision =
  | { readonly verdict: "acquire" }
  | { readonly verdict: "held"; readonly heldBy: string; readonly expiresAt: number }
  | { readonly verdict: "stale-recoverable"; readonly heldBy: string; readonly expiredAt: number };

/**
 * Pure decision: given the existing lock body (or `null` if no file) and the
 * current time, decide whether to acquire fresh, defer to a live holder, or
 * recover a stale lease.
 *
 * @otel-exempt pure decision; instrumentation lives in the spawn-strategy slice that wraps this.
 */
export function decideClaim(input: {
  readonly existingLock: LockBody | null;
  readonly now: number;
}): ClaimDecision {
  const { existingLock, now } = input;
  if (existingLock === null) return { verdict: "acquire" };
  if (existingLock.expiresAt <= now) {
    return {
      verdict: "stale-recoverable",
      heldBy: existingLock.workerId,
      expiredAt: existingLock.expiresAt,
    };
  }
  return { verdict: "held", heldBy: existingLock.workerId, expiresAt: existingLock.expiresAt };
}

/**
 * Parse the on-disk lock-body bytes into a {@link LockBody}, returning `null`
 * for malformed JSON or missing fields. Malformed locks are treated as
 * stale-recoverable on read (so a crashed write doesn't permanently jam the
 * task), per Beyer SRE 2016 Ch. 6 "silence is failure".
 *
 * @otel-exempt pure parser; the I/O wrapper records the read.
 */
export function parseLockBody(text: string): LockBody | null {
  try {
    const obj = JSON.parse(text) as Partial<LockBody>;
    if (
      typeof obj.taskId === "string" &&
      typeof obj.workerId === "string" &&
      typeof obj.claimedAt === "number" &&
      typeof obj.expiresAt === "number"
    ) {
      return {
        taskId: obj.taskId,
        workerId: obj.workerId,
        claimedAt: obj.claimedAt,
        expiresAt: obj.expiresAt,
      };
    }
    return null;
    // rule-6: handled-locally — malformed lock body returns null so caller's stale-recovery path runs
  } catch {
    return null;
  }
}

export type AcquireResult =
  | { readonly acquired: true; readonly release: () => void; readonly expiresAt: number }
  | { readonly acquired: false; readonly heldBy: string; readonly expiresAt: number };

/**
 * Acquire a per-task claim using O_EXCL file-creation atomicity. The lock
 * file lives at `<locksDir>/task-<taskId>.lock`; its body is the JSON-encoded
 * {@link LockBody}. On `EEXIST`, the existing body is parsed and the
 * decision is delegated to {@link decideClaim} — stale leases (expired or
 * malformed) are recovered by deleting and retrying once.
 *
 * Single-host single-process safe under POSIX `O_EXCL` semantics. Multi-host
 * is out of scope (parent task pivot — single-host `flock` per Kleppmann
 * 2016 is sufficient for the daemon's surface; multi-host requires Redis /
 * etcd which is rejected by the parent task's research notes).
 *
 * @otel-exempt slice-1 substrate; instrumentation (claim_collision, stale_lock_recovered counters) lives in slice 7 of parent task.
 */
export function acquireTaskClaim(opts: {
  readonly taskId: string;
  readonly workerId: string;
  readonly ttlMs: number;
  readonly locksDir: string;
  readonly now?: () => number;
}): AcquireResult {
  const now = opts.now ?? Date.now;
  mkdirSync(opts.locksDir, { recursive: true });
  const lockPath = join(opts.locksDir, `task-${opts.taskId}.lock`);
  return tryCreateLock({ ...opts, now, lockPath, retryOnStale: true });
}

function tryCreateLock(args: {
  readonly taskId: string;
  readonly workerId: string;
  readonly ttlMs: number;
  readonly lockPath: string;
  readonly now: () => number;
  readonly retryOnStale: boolean;
}): AcquireResult {
  const claimedAt = args.now();
  const body: LockBody = {
    taskId: args.taskId,
    workerId: args.workerId,
    claimedAt,
    expiresAt: claimedAt + args.ttlMs,
  };
  try {
    return tryWriteLockBody(args.lockPath, body);
  } catch (err) {
    if (!isEExist(err)) throw err;
    return handleCollision(args);
  }
}

function tryWriteLockBody(lockPath: string, body: LockBody): AcquireResult {
  const fd = openSync(lockPath, "wx");
  writeFileSync(fd, JSON.stringify(body));
  closeSync(fd);
  return { acquired: true, release: makeRelease(lockPath), expiresAt: body.expiresAt };
}

function makeRelease(lockPath: string): () => void {
  return () => {
    try {
      unlinkSync(lockPath);
      // rule-6: handled-locally — release is best-effort; if sweeper already removed the file, no-op is correct
    } catch {
      return;
    }
  };
}

function handleCollision(args: {
  readonly taskId: string;
  readonly workerId: string;
  readonly ttlMs: number;
  readonly lockPath: string;
  readonly now: () => number;
  readonly retryOnStale: boolean;
}): AcquireResult {
  const existingText = safeReadFile(args.lockPath);
  const parsed = existingText === null ? null : parseLockBody(existingText);
  // Malformed body (file exists but JSON unparseable) is treated as stale —
  // a crashed write must not permanently jam the task.
  const isMalformedExisting = existingText !== null && parsed === null;
  if (isMalformedExisting && args.retryOnStale) {
    return recoverAndRetry(args);
  }
  const decision = decideClaim({ existingLock: parsed, now: args.now() });
  if (decision.verdict === "stale-recoverable" && args.retryOnStale) {
    return recoverAndRetry(args);
  }
  if (decision.verdict === "held") {
    return { acquired: false, heldBy: decision.heldBy, expiresAt: decision.expiresAt };
  }
  return {
    acquired: false,
    heldBy: parsed?.workerId ?? "unknown",
    expiresAt: parsed?.expiresAt ?? args.now(),
  };
}

function recoverAndRetry(args: {
  readonly taskId: string;
  readonly workerId: string;
  readonly ttlMs: number;
  readonly lockPath: string;
  readonly now: () => number;
}): AcquireResult {
  try {
    unlinkSync(args.lockPath);
    // rule-6: handled-locally — race-tolerant unlink; tryCreateLock's EEXIST path handles re-collision
  } catch {
    /* lost the recovery race — tryCreateLock handles re-collision */
  }
  return tryCreateLock({ ...args, retryOnStale: false });
}

function safeReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
    // rule-6: handled-locally — null = no lock present (race between EEXIST and stat), caller treats as recoverable
  } catch {
    return null;
  }
}

function isEExist(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "EEXIST"
  );
}
