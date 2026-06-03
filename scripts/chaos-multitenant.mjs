#!/usr/bin/env node
// @ts-check
// `scripts/chaos-multitenant.mjs` — operator-facing chaos test for
// `runany-multitenant-no-conflict` (TASKS.md P0). It is the task's
// `**Measurement**`:
//
//   node scripts/chaos-multitenant.mjs --runs=10 --minutes=30 --json
//     → {collisions:0, corruptWorktrees:0, doubleClaims:0}
//
// Pattern conformance (vision.md § "Pattern conformance index"):
//   - Chaos engineering — Basiri et al., "Principles of Chaos Engineering",
//     IEEE Software 2016: steady-state hypothesis + fault injection +
//     assertion against the steady state. The injected fault here is N
//     concurrent `minsky` runs on the SAME repo on one machine; the steady
//     state is "zero collisions across every per-run mutable namespace, zero
//     corrupt worktrees, zero double-claimed tasks". As with the sibling
//     `chaos-restart-schedule.mjs`, the harness is a deterministic
//     discrete-event simulation over the PURE decision under test
//     (`deriveRunNamespace` + `deriveClaimKey`) rather than a real
//     process-spawn race — a real race would be flaky, slow, and
//     machine-dependent, while the namespacing decision is pure, so the sim
//     is the faithful + deterministic harness.
//   - RFC 4122 §4.4 run-id namespacing + Lamport 1974 mutual exclusion —
//     the decisions the sim exercises (see novel/tick-loop/src/worker-config.ts).
//
// Steady-state hypothesis (restated from the task):
//   N concurrent runs on the same repo, each holding its run-id for the whole
//   window, produce 0 namespace collisions; the repo+task-scoped claim grants
//   each contested task to exactly one process (0 double-claims); and because
//   every worktree dir is run-id-keyed and disjoint, 0 worktrees corrupt.
//
// Exit 0 iff all three observables are 0; 1 otherwise (Basiri assertion). The
// sim is pure and exported so the paired .test.mjs drives it deterministically.

import { decideStaleClaimEviction, deriveClaimKey, deriveRunNamespace } from "@minsky/tick-loop";

const DEFAULT_RUNS = 10; // "spawns N=10 concurrent runs"
const DEFAULT_MINUTES = 30; // "for 30 min"
// The task's N=3 worker fanout (daemon-parallel-worktree-launch Success: "at
// N=3, ... 0 namespace collisions"). The fanout invariants hold for any N; 3
// is the default the chaos run asserts so `--json` matches the task's
// Measurement out of the box.
const DEFAULT_WORKERS_TOTAL = 3;
// A virtual tick granularity for the claim contention sim. The wall-clock
// minutes don't change the namespacing result (it's pid+rand-keyed, not
// time-keyed) — they scale how many claim rounds we simulate, so a longer
// window exercises more contention, never less.
const CLAIM_ROUNDS_PER_MINUTE = 4;

/**
 * Build N per-run namespaces for the same repo, exactly as N concurrent
 * processes would (each with its own pid + random token). Deterministic: the
 * sim seeds pid/rand from the run index so the result is reproducible, while
 * still exercising the real derivation that production uses.
 *
 * @param {string} repoPath
 * @param {number} runs
 * @returns {import("@minsky/tick-loop").RunNamespace[]}
 */
function buildConcurrentNamespaces(repoPath, runs) {
  /** @type {import("@minsky/tick-loop").RunNamespace[]} */
  const out = [];
  for (let i = 0; i < runs; i++) {
    // Distinct (pid, rand) per run — what `process.pid` + a crypto rand give
    // each real process. The sim makes them distinct deterministically.
    out.push(deriveRunNamespace({ repoPath, pid: 10_000 + i, rand: `run${i}` }));
  }
  return out;
}

/**
 * Count cross-run collisions across every per-run mutable namespace dimension
 * that MUST be disjoint by construction. Returns the TOTAL collision count
 * (sum over dimensions) — the task's single `collisions` observable. Zero
 * means every run wrote to disjoint paths / branches / labels / ledgers.
 *
 * NOTE on `port`: the port is deliberately EXCLUDED from the hard-collision
 * count. It is a finite shared resource (the birthday paradox guarantees hash
 * collisions at high N), so a derived port is only a *hint* — the OS bind loop
 * (`EADDRINUSE` → probe the next free port) is the real arbiter, not the
 * derivation. A port hint clash is resolved at bind time, never a corruption.
 * The other dimensions are run-id-keyed strings and so are provably disjoint
 * whenever run-ids are unique. Surfacing port as a "collision" would be a false
 * positive — the chaos steady state is about FS/branch/label disjointness +
 * bind-arbitrated ports, not hash-unique ports.
 *
 * @param {readonly import("@minsky/tick-loop").RunNamespace[]} namespaces
 * @returns {number}
 */
export function countCollisions(namespaces) {
  const dims = ["runId", "worktreeDir", "lockPath", "branchName", "launchdLabel", "ledgerPath"];
  let total = 0;
  for (const dim of dims) {
    const seen = new Set();
    for (const ns of namespaces) {
      const v = ns[/** @type {keyof import("@minsky/tick-loop").RunNamespace} */ (dim)];
      if (seen.has(v)) total += 1;
      else seen.add(v);
    }
  }
  return total;
}

/**
 * Simulate cross-process task arbitration: over many rounds, every run tries
 * to claim the SAME contested task on the SAME repo. The repo+task-scoped
 * claim key is identical for all of them, so a correct O_EXCL flock grants it
 * to exactly one winner per round. A double-claim is two runs believing they
 * hold the same task in the same round. We model the O_EXCL create as the
 * canonical winner = first-arriver; the assertion is that the KEY is shared
 * (so the OS can serialize), which is the decision under test.
 *
 * @param {string} repoPath
 * @param {number} runs
 * @param {number} rounds
 * @returns {number} the number of double-claims (0 = correct)
 */
export function countDoubleClaims(repoPath, runs, rounds) {
  let doubleClaims = 0;
  for (let r = 0; r < rounds; r++) {
    // Every run computes the claim key for the same contested task.
    const taskId = `contested-task-${r % 3}`; // a few rotating contested tasks
    const keys = [];
    for (let i = 0; i < runs; i++) keys.push(deriveClaimKey(repoPath, taskId));
    // All runs MUST derive the same key for the same (repo, task) so the OS
    // O_EXCL create serializes them to one winner. If any run derived a
    // DIFFERENT key for the same (repo, task), two O_EXCL creates would both
    // succeed → a double-claim. Count those.
    const distinct = new Set(keys);
    if (distinct.size > 1) doubleClaims += distinct.size - 1;
  }
  return doubleClaims;
}

/**
 * Count corrupt worktrees. A worktree corrupts iff two runs share a worktree
 * dir (they'd write into the same git working tree → index corruption). Since
 * every worktree dir is run-id-keyed, this is exactly the worktreeDir
 * collision count — surfaced as its own observable per the task's measurement.
 *
 * @param {readonly import("@minsky/tick-loop").RunNamespace[]} namespaces
 * @returns {number}
 */
export function countCorruptWorktrees(namespaces) {
  const seen = new Set();
  let corrupt = 0;
  for (const ns of namespaces) {
    if (seen.has(ns.worktreeDir)) corrupt += 1;
    else seen.add(ns.worktreeDir);
  }
  return corrupt;
}

/**
 * N-worker fanout assertion (slice (c) of daemon-parallel-worktree-launch:
 * "Extend chaos-multitenant.mjs to assert zero collisions across the N-worker
 * fanout"). Unlike `buildConcurrentNamespaces` (N independent processes), this
 * models the daemon's intended shape: ONE host walker fans out N workers, each
 * worker getting a per-worker run-id (its pid is `basePid + workerId`, exactly
 * what `bin/minsky-run.sh --workers-total N` passes). Returns the cross-worker
 * collision count over the must-be-disjoint dimensions — 0 means the fanout's
 * worktrees / locks / branches / labels / ledgers are all disjoint.
 *
 * @param {string} repoPath
 * @param {number} workersTotal
 * @param {number} [basePid]
 * @returns {number} cross-worker collisions (0 = fanout is disjoint)
 */
export function countFanoutCollisions(repoPath, workersTotal, basePid = 20_000) {
  /** @type {import("@minsky/tick-loop").RunNamespace[]} */
  const namespaces = [];
  for (let workerId = 0; workerId < workersTotal; workerId++) {
    namespaces.push(
      deriveRunNamespace({ repoPath, pid: basePid + workerId, rand: `worker${workerId}` }),
    );
  }
  return countCollisions(namespaces);
}

/**
 * Stale-claim eviction invariant (slice (d): "prune stale worktrees/locks older
 * than the iteration TTL every conductor tick"). Models a worker that crashed
 * mid-iteration, leaving an orphaned claim older than the TTL, alongside live
 * claims. The pure `decideStaleClaimEviction` must evict exactly the orphans
 * (returning the wedged task to the pool) and keep every live claim. Returns
 * the number of MIS-evictions: live claims wrongly evicted PLUS stale claims
 * wrongly kept. 0 means eviction is correct (a crashed worker never wedges a
 * task forever, and a live worker is never preempted).
 *
 * @param {number} workersTotal
 * @param {number} [ttlMs]
 * @returns {number} mis-evictions (0 = correct)
 */
export function countStaleClaimMisEvictions(workersTotal, ttlMs = 1_800_000) {
  const nowMs = 10_000_000;
  const key = (/** @type {number} */ workerId) => `claim-worker-${workerId}.lock`;
  // Worker 0 crashed: its claim is 2× the TTL old (orphaned lock). Workers
  // 1..N-1 are alive: claims stamped well within the TTL.
  /** @type {import("@minsky/tick-loop").TaskClaim[]} */
  const claims = Array.from({ length: workersTotal }, (_, workerId) => ({
    claimKey: key(workerId),
    claimedAtMs: workerId === 0 ? nowMs - ttlMs * 2 : nowMs - Math.floor(ttlMs / 2),
  }));
  const { evict, keep } = decideStaleClaimEviction(claims, ttlMs, nowMs);
  const evicted = new Set(evict.map((c) => c.claimKey));
  const kept = new Set(keep.map((c) => c.claimKey));
  // The crashed worker (0) MUST be evicted; every live worker (≥1) MUST be kept.
  // A mis-eviction is the count of workers violating their expected disposition.
  return Array.from({ length: workersTotal }, (_, workerId) => workerId).filter((workerId) =>
    workerId === 0 ? !evicted.has(key(0)) : !kept.has(key(workerId)),
  ).length;
}

/**
 * The full chaos measurement. Pure (deterministic) and exported so the paired
 * test drives it without spawning processes.
 *
 * `workersTotal` (slice (c)/(d) of daemon-parallel-worktree-launch) extends the
 * original multi-tenant measurement with the N-worker fanout invariants: the
 * fanout's namespaces stay disjoint (`fanoutCollisions`) AND the conductor's
 * stale-claim eviction never preempts a live worker nor leaves a crashed
 * worker's lock wedged (`staleClaimMisEvictions`). Defaults to the task's N=3.
 *
 * @param {{ runs?: number, minutes?: number, repoPath?: string, workersTotal?: number }} [opts]
 * @returns {{ collisions: number, corruptWorktrees: number, doubleClaims: number, fanoutCollisions: number, staleClaimMisEvictions: number }}
 */
export function simulateMultitenant(opts = {}) {
  const runs = opts.runs ?? DEFAULT_RUNS;
  const minutes = opts.minutes ?? DEFAULT_MINUTES;
  const repoPath = opts.repoPath ?? "/chaos/same-repo";
  const workersTotal = opts.workersTotal ?? DEFAULT_WORKERS_TOTAL;
  const namespaces = buildConcurrentNamespaces(repoPath, runs);
  const rounds = Math.max(1, Math.floor(minutes * CLAIM_ROUNDS_PER_MINUTE));
  return {
    collisions: countCollisions(namespaces),
    corruptWorktrees: countCorruptWorktrees(namespaces),
    doubleClaims: countDoubleClaims(repoPath, runs, rounds),
    fanoutCollisions: countFanoutCollisions(repoPath, workersTotal),
    staleClaimMisEvictions: countStaleClaimMisEvictions(workersTotal),
  };
}

/**
 * @param {{ collisions: number, corruptWorktrees: number, doubleClaims: number, fanoutCollisions?: number, staleClaimMisEvictions?: number }} r
 * @returns {boolean}
 */
export function allClear(r) {
  return (
    r.collisions === 0 &&
    r.corruptWorktrees === 0 &&
    r.doubleClaims === 0 &&
    // The fanout invariants default to 0 for callers that pre-date the N-worker
    // slice (back-compat): a result with no fanout fields is treated as clear
    // on those dimensions, never spuriously violated.
    (r.fanoutCollisions ?? 0) === 0 &&
    (r.staleClaimMisEvictions ?? 0) === 0
  );
}

/**
 * Parse a single `--<name>=<digits>` numeric flag from argv, falling back to
 * `dflt` when the flag is absent or the value is 0/non-numeric (rule #7 — a
 * typo'd knob never crashes the chaos harness). Extracted so `parseArgs` stays
 * a flat list of one-liners (cognitive-complexity budget).
 *
 * @param {readonly string[]} argv
 * @param {string} name
 * @param {number} dflt
 * @returns {number}
 */
function parseNumericFlag(argv, name, dflt) {
  const re = new RegExp(`^--${name}=(\\d+)$`);
  for (const a of argv) {
    const m = a.match(re);
    if (m?.[1] !== undefined) return Number(m[1]) || dflt;
  }
  return dflt;
}

/**
 * Parse `--runs=N` / `--minutes=N` / `--workers-total=N` / `--json` from argv.
 * A bad value falls back to the default (rule #7).
 *
 * @param {readonly string[]} argv
 * @returns {{ runs: number, minutes: number, workersTotal: number, jsonOnly: boolean }}
 */
export function parseArgs(argv) {
  return {
    runs: parseNumericFlag(argv, "runs", DEFAULT_RUNS),
    minutes: parseNumericFlag(argv, "minutes", DEFAULT_MINUTES),
    workersTotal: parseNumericFlag(argv, "workers-total", DEFAULT_WORKERS_TOTAL),
    jsonOnly: argv.includes("--json"),
  };
}

// ---- CLI -----------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { runs, minutes, workersTotal, jsonOnly } = parseArgs(process.argv.slice(2));
  const result = simulateMultitenant({ runs, minutes, workersTotal });
  const ok = allClear(result);
  if (!jsonOnly) {
    process.stdout.write(
      `chaos-multitenant: N=${runs} concurrent runs + ${workersTotal}-worker fanout on one repo over ${minutes} min\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!jsonOnly) {
    process.stdout.write(
      ok
        ? "chaos-multitenant: STEADY STATE HELD — 0 collisions / 0 corrupt worktrees / 0 double-claims / 0 fanout-collisions / 0 stale-claim mis-evictions\n"
        : "chaos-multitenant: STEADY STATE VIOLATED\n",
    );
  }
  process.exit(ok ? 0 : 1);
}
