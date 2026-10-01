// Pattern: Universally Unique Identifier namespacing (Leach, Mealling &
//   Salz, RFC 4122 §4.4, "Algorithms for Creating a UUID from Truly Random
//   or Pseudo-Random Numbers", 2005) applied as a per-run namespace prefix,
//   plus mutual exclusion via uniquely-keyed lock names (Lamport, "A New
//   Solution of Dijkstra's Concurrent Programming Problem", CACM 1974 — the
//   bakery algorithm's per-process unique number). Every per-run mutable
//   namespace (worktree dir, lock file, branch, launchd label, ledger path,
//   port) is keyed by a single run-id `<repo-hash>-<pid>-<rand>` so dozens of
//   concurrent `minsky` processes on one machine never collide. Cross-process
//   task arbitration uses a repo+task-scoped claim key so two processes on the
//   same repo cannot grab the same task. Pure: all derivation is a function of
//   (repoPath, pid, rand, taskId); the I/O (mkdir, O_EXCL open, git branch,
//   launchctl) lives at the edge in scripts/orchestrate.mjs + the bash runner.
// Source: TASKS.md `runany-multitenant-no-conflict`; vision.md rule #7 (chaos
//   engineering — N concurrent runs are an injected fault; the steady state is
//   zero collisions); rule #6 (stay alive — a namespace clash must never crash
//   a sibling run); Basiri et al., "Chaos Engineering", IEEE Software 2016
//   (steady-state hypothesis + fault injection); Lamport 1974 (mutual
//   exclusion). The chaos measurement lives in scripts/chaos-multitenant.mjs.
// <!-- pattern: not-applicable — RFC 4122 run-id namespacing + Lamport mutual exclusion; pattern grounding lives in this header + the package README "Pattern conformance" section, not the vision.md index (vision.md is MAPE-K-owned and out of this task's scope) -->

/**
 * The fully-derived per-run namespace. Every field is keyed by the run's
 * unique `runId` so two concurrent runs on the same repo (same machine) write
 * to disjoint paths / branches / labels / ports — the core invariant the
 * `runany-multitenant-no-conflict` chaos test asserts (zero collisions).
 */
export interface RunNamespace {
  /** The unique run identifier: `<repo-hash>-<pid>-<rand>`. */
  readonly runId: string;
  /** Per-run git worktree dir, relative to the repo root (no two runs share). */
  readonly worktreeDir: string;
  /** Per-run O_EXCL lock file, relative to the repo root. */
  readonly lockPath: string;
  /** Per-run branch name the run pushes its work to. */
  readonly branchName: string;
  /** Per-run launchd label (macOS) — disjoint so kickstart targets one run. */
  readonly launchdLabel: string;
  /** Per-run orchestrate ledger path, relative to the repo root. */
  readonly ledgerPath: string;
  /**
   * Per-run TCP port *hint* for any dashboard/observability surface. Unlike the
   * string namespaces above, a port is a finite shared resource — the birthday
   * paradox guarantees hash clashes at high N — so this is only a starting
   * hint; the OS bind loop (`EADDRINUSE` → probe the next free port) is the
   * real arbiter. A port-hint clash is resolved at bind time, never a
   * corruption.
   */
  readonly port: number;
}

/** Inputs to the namespace derivation. All optional except `repoPath`. */
export interface RunNamespaceInput {
  /** Absolute path of the invoked repo (its git root). */
  readonly repoPath: string;
  /** The OS process id of this run. Defaults wired by the caller. */
  readonly pid: number;
  /** A random token (hex). The caller supplies entropy; the core stays pure. */
  readonly rand: string;
  /** Optional base port; the per-run port is `basePort + hash(runId) % span`. */
  readonly basePort?: number;
  /** Optional port span (number of candidate ports). */
  readonly portSpan?: number;
}

/** Default base port for a per-run dashboard surface (localhost-bound). */
export const DEFAULT_BASE_PORT = 41000;

/** Default port span — 1000 candidate ports keeps clash probability tiny. */
export const DEFAULT_PORT_SPAN = 1000;

/**
 * FNV-1a 32-bit hash. Deterministic, dependency-free, and sufficient for a
 * namespace prefix (we are not hashing for crypto — rule #1, don't pull in a
 * hashing lib for a 5-line pure function). Source: Fowler/Noll/Vo, FNV hash.
 *
 * @otel-exempt pure hash — no span; folded into the deriveRunNamespace span
 * @param input the string to hash
 * @returns an unsigned 32-bit integer
 */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (avoids BigInt; stays in uint32).
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Short, filesystem-safe, collision-resistant hash of the repo path. Two
 * different repos on the same machine get different prefixes; the same repo
 * always gets the same prefix (so an operator can `grep` all runs of one repo).
 *
 * @otel-exempt pure hash — no span; folded into the deriveRunNamespace span
 * @param repoPath absolute repo root
 * @returns an 8-char lowercase hex string
 */
export function repoHash(repoPath: string): string {
  return fnv1a32(normalizeRepoPath(repoPath)).toString(16).padStart(8, "0");
}

/**
 * Normalize a repo path so trailing slashes / `.` segments don't produce a
 * different hash for the same repo. Pure string transform (no fs access — the
 * core never touches the disk).
 *
 * @otel-exempt pure string transform — no I/O, no span
 * @param repoPath the path to normalize
 * @returns the normalized path
 */
export function normalizeRepoPath(repoPath: string): string {
  let p = repoPath.trim();
  // Collapse repeated slashes and strip a single trailing slash (but keep "/").
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * Derive the unique run-id `<repo-hash>-<pid>-<rand>`. The triple of
 * (repo, process, random) makes collisions astronomically unlikely even when
 * two runs start in the same millisecond with the same pid recycled across a
 * reboot — the random token is the tiebreaker (RFC 4122 §4.4 rationale).
 *
 * @otel-exempt pure derivation — folded into the deriveRunNamespace span
 * @param input the derivation inputs
 * @returns the run-id string
 */
export function deriveRunId(input: RunNamespaceInput): string {
  const { repoPath, pid, rand } = input;
  const safeRand = sanitizeToken(rand);
  if (safeRand.length === 0) {
    // rule #6 — a missing random token must not silently collide siblings;
    // crash loud so the caller wires real entropy (it is a programming bug,
    // not a recoverable runtime fault).
    throw new Error("deriveRunId: `rand` must be a non-empty token");
  }
  return `${repoHash(repoPath)}-${sanitizePid(pid)}-${safeRand}`;
}

/**
 * Derive every per-run namespace from a single run-id. One function so a new
 * mutable namespace can never be added in one place and forgotten in another
 * (the bug class the task exists to kill).
 *
 * @otel tick-loop.worker-config.derive-namespace
 * @param input the derivation inputs
 * @returns the fully-keyed namespace
 */
export function deriveRunNamespace(input: RunNamespaceInput): RunNamespace {
  const runId = deriveRunId(input);
  const basePort = input.basePort ?? DEFAULT_BASE_PORT;
  const portSpan = input.portSpan ?? DEFAULT_PORT_SPAN;
  return Object.freeze({
    runId,
    worktreeDir: `.minsky/worktrees/${runId}`,
    lockPath: `.minsky/locks/run-${runId}.lock`,
    branchName: `minsky/run-${runId}`,
    launchdLabel: `com.minsky.run.${runId}`,
    ledgerPath: `.minsky/ledger/${runId}.jsonl`,
    port: basePort + (fnv1a32(runId) % portSpan),
  });
}

/**
 * Derive the repo+task-scoped claim key used by the cross-process O_EXCL flock
 * arbitration. Two processes on the SAME repo asking for the SAME task derive
 * the SAME key (so only one wins the O_EXCL create); two processes on the same
 * repo asking for DIFFERENT tasks derive different keys (so they don't block
 * each other). Scoping by repo too means the same task-id in two different
 * repos never cross-blocks. This is the extension the task calls for: the
 * existing claim was task-only; this makes it repo+task-scoped.
 *
 * @otel-exempt pure key derivation — the O_EXCL open at the call site carries the span
 * @param repoPath absolute repo root
 * @param taskId the kebab-case task id being claimed
 * @returns the lock-file path, relative to the repo root
 */
export function deriveClaimKey(repoPath: string, taskId: string): string {
  const safeTask = sanitizeToken(taskId);
  if (safeTask.length === 0) {
    throw new Error("deriveClaimKey: `taskId` must be a non-empty token");
  }
  return `.minsky/locks/claim-${repoHash(repoPath)}-${safeTask}.lock`;
}

/**
 * Pure collision detector over a set of derived namespaces. Returns the count
 * of cross-run collisions for each mutable namespace dimension. The chaos test
 * feeds it N independently-derived namespaces and asserts every count is 0 —
 * the steady-state hypothesis (Basiri 2016). Exposed so the measurement is a
 * pure assertion, not a flaky real-process race.
 *
 * @otel-exempt pure test/measurement helper — invoked by the chaos harness, not in production
 * @param namespaces the derived per-run namespaces to check for overlap
 * @returns per-dimension collision counts (0 = disjoint)
 */
export function countNamespaceCollisions(namespaces: readonly RunNamespace[]): {
  runId: number;
  worktreeDir: number;
  lockPath: number;
  branchName: number;
  launchdLabel: number;
  ledgerPath: number;
  port: number;
} {
  return {
    runId: countDuplicates(namespaces.map((n) => n.runId)),
    worktreeDir: countDuplicates(namespaces.map((n) => n.worktreeDir)),
    lockPath: countDuplicates(namespaces.map((n) => n.lockPath)),
    branchName: countDuplicates(namespaces.map((n) => n.branchName)),
    launchdLabel: countDuplicates(namespaces.map((n) => n.launchdLabel)),
    ledgerPath: countDuplicates(namespaces.map((n) => n.ledgerPath)),
    port: countDuplicates(namespaces.map((n) => n.port)),
  };
}

/**
 * Count how many array entries are NOT the first occurrence of their value
 * (i.e. the number of collisions: a 3-way clash counts as 2).
 *
 * @otel-exempt pure array helper — no I/O, no span
 * @param values the values to scan for duplicates
 * @returns the number of duplicate (colliding) entries
 */
export function countDuplicates<T>(values: readonly T[]): number {
  const seen = new Set<T>();
  let collisions = 0;
  for (const v of values) {
    if (seen.has(v)) collisions += 1;
    else seen.add(v);
  }
  return collisions;
}

/**
 * Strip everything that isn't `[a-z0-9-]` (lower-cased) so a token is always
 * safe in a filename, a branch ref, and a launchd label simultaneously.
 *
 * @param token the raw token
 * @returns the sanitized token
 */
function sanitizeToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

/**
 * Coerce a pid to a non-negative integer string. A negative or non-finite pid
 * is a caller bug; clamp to 0 so the namespace stays well-formed (the random
 * token still disambiguates).
 *
 * @param pid the process id
 * @returns the pid as a safe decimal string
 */
function sanitizePid(pid: number): string {
  if (!Number.isFinite(pid) || pid < 0) return "0";
  return String(Math.floor(pid));
}
