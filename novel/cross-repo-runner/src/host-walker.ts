// Multi-host walker — drain-then-advance orchestrator above `runHostLoop`.
// Walks an ordered list of bootstrapped host paths; for each host, runs
// `runHostLoop` until it returns `empty-queue` / `aborted` / `max-iterations`
// / `scope-leak` / `spawn-failed`; then advances to the next host.
//
// Pattern: round-robin scheduler with drain semantics (Liu & Layland 1973
//   — same anchor `runHostLoop` cites; the walker is the outer scheduler
//   over the inner periodic-task primitive) + let-it-crash AT the host
//   boundary (Armstrong 2007 — a scope-leak in one host doesn't take
//   down the walker; the operator inspects and re-launches).
// Source: TASKS.md `minsky-run-autonomous-defaults-and-multi-host`; rule
//   #1 (don't reinvent — `runHostLoop` is the single-host primitive;
//   the walker is the multi-host orchestrator above it).
// Conformance: full — pure function over injected I/O seams.

import type { LoopResult, LoopStopReason } from "./host-loop.js";

/**
 * Reasons {@link walkHostsDir} can return.
 *
 *   - `all-hosts-drained` — every host's queue is empty AND, where
 *                           seed-on-empty was attempted, the seed audit
 *                           didn't produce new work. Healthy stop.
 *   - `max-iterations`    — outer cap on total iterations across all
 *                           hosts (operator-supplied). Healthy stop.
 *   - `aborted`           — SIGTERM / AbortSignal fired during a host's
 *                           inner loop.
 *   - `scope-leak`        — first host iteration that produced a
 *                           scope-leak halts the entire walker for
 *                           operator inspection.
 *
 * Note: `spawn-failed` on a single host does NOT halt the walker —
 * the walker skips to the next host. The failure is recorded in the
 * visit audit trail and surfaced in the summary. This prevents one
 * bad host from blocking the entire fleet.
 */
export type WalkerStopReason = "all-hosts-drained" | "max-iterations" | "aborted" | "scope-leak";

/**
 * Per-host audit trail. The walker collects one of these per host visit
 * so the CLI summary can render "host A → 3 iterations, host B → 0 iterations,
 * host C → scope-leak".
 */
export interface HostVisitResult {
  /** Absolute path to the host repo root. */
  readonly hostRoot: string;
  /** Inner loop's verdict for this host. */
  readonly loopResult: LoopResult;
}

export interface WalkerResult {
  /** Per-host audit trail in visit order. */
  readonly visits: readonly HostVisitResult[];
  /** Final walker stop reason. */
  readonly stopReason: WalkerStopReason;
  /** Total iterations across all hosts (for the operator-facing summary). */
  readonly totalIterations: number;
}

/**
 * Inputs to {@link walkHostsDir}. The host list is supplied by the caller
 * (typically `findBootstrappedSubdirs` from `cwd-detect.ts`); the walker
 * is agnostic to the discovery mechanism.
 */
export interface WalkHostsDirInputs {
  /** Hosts to walk, in visit order. */
  readonly hosts: readonly string[];
  /**
   * Per-host runner. Production wires this to a closure that builds the
   * `runHostLoop` opts for the given host (config, seams, signal, …) and
   * invokes it; tests inject a fake that returns canned `LoopResult`s.
   */
  readonly runOneHost: (hostRoot: string) => Promise<LoopResult>;
  /**
   * Optional outer cap on total iterations across all hosts. Default
   * `Infinity` — the walker stops on `all-hosts-drained` instead.
   */
  readonly maxTotalIterations?: number;
  /**
   * Optional abort signal — production: the CLI's SIGTERM/SIGINT bridge.
   * Tests inject an `AbortController.signal`. When the signal fires, the
   * walker exits at the next host boundary (the inner host loop already
   * has its own signal handling per slice B).
   */
  readonly signal?: AbortSignal;
}

/**
 * Walk the hosts list with drain-then-advance semantics. For each host:
 *   1. Check abort signal — if set, exit `aborted`.
 *   2. Call `runOneHost(host)` — drains that host via `runHostLoop`.
 *   3. Inspect the inner stop reason:
 *      - `empty-queue` / `max-iterations` / `aborted` → advance to next host
 *      - `scope-leak` / `spawn-failed` → halt walker with same reason
 *   4. After last host, return `all-hosts-drained`.
 *
 * Halt-on-error semantics: a scope-leak or spawn-failed in any host
 * halts the WHOLE walker. The operator inspects, fixes, re-launches.
 * This is intentional per slice-C's same-shaped halt-on-fail discipline
 * (rule #7 `circuit-break-and-notify` — surface failures, don't silently
 * retry across hosts).
 *
 * Never catches mid-host; an exception from `runOneHost` propagates per
 * rule #6 let-it-crash.
 *
 * @otel cross-repo-runner.walk-hosts-dir
 */
export async function walkHostsDir(inputs: WalkHostsDirInputs): Promise<WalkerResult> {
  const maxTotal = inputs.maxTotalIterations ?? Number.POSITIVE_INFINITY;
  const visits: HostVisitResult[] = [];
  let totalIterations = 0;

  for (const hostRoot of inputs.hosts) {
    if (inputs.signal?.aborted) {
      return { visits, stopReason: "aborted", totalIterations };
    }
    if (totalIterations >= maxTotal) {
      return { visits, stopReason: "max-iterations", totalIterations };
    }
    const loopResult = await inputs.runOneHost(hostRoot);
    visits.push({ hostRoot, loopResult });
    totalIterations += loopResult.iterations.length;
    const earlyStop = mapInnerStopToWalker(loopResult.stopReason);
    if (earlyStop !== undefined) {
      return { visits, stopReason: earlyStop, totalIterations };
    }
  }
  return { visits, stopReason: "all-hosts-drained", totalIterations };
}

/**
 * Map the inner-loop stop reason to a walker-level stop signal. Returns
 * `undefined` when the walker should advance to the next host; returns
 * a `WalkerStopReason` when the walker should halt.
 *
 * `spawn-failed` is intentionally NOT a walker halt — a bad host
 * (missing binary, auth expired, network down) should not prevent the
 * walker from trying the remaining hosts. The failure is recorded in
 * the visit and surfaced in the summary. Only `scope-leak` (sandbox
 * violation) and `aborted` (operator SIGTERM) halt the walk.
 *
 * Changed 2026-05-18: previously `spawn-failed` halted the walker,
 * causing one bad host to block all other hosts indefinitely.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function mapInnerStopToWalker(inner: LoopStopReason): WalkerStopReason | undefined {
  if (inner === "scope-leak") return "scope-leak";
  if (inner === "aborted") return "aborted";
  // spawn-failed, empty-queue, and max-iterations are non-fatal advances —
  // the walker moves to the next host. spawn-failed is logged in the visit
  // record so the operator sees it in the summary.
  return undefined;
}
