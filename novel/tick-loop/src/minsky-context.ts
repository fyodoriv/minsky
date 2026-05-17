// <!-- scope: human-approved minsky-cli-context-aware-ux (operator 2026-05-08) -->
/**
 * `@minsky/tick-loop/minsky-context` — 7-signal parallel context probe for
 * the context-aware `minsky` (no-args) UX. Slice 1 of P0 task
 * `minsky-cli-context-aware-ux`.
 *
 * Gathers 7 signals in parallel, each timeout-bounded at 500 ms:
 *
 *   1. {@link ContextProbes.probeWorker} — PID-file liveness (sync).
 *   2. {@link ContextProbes.probeLastIteration} — log-file mtime (sync).
 *   3. {@link ContextProbes.probeClaudeState} — persisted hard-limit field.
 *   4. {@link ContextProbes.probeLocalLlmState} — GET /v1/models endpoint.
 *   5. {@link ContextProbes.probeGitState} — `git status --porcelain`.
 *   6. {@link ContextProbes.probePrStats} — `gh pr list` open + CONFLICTING.
 *   7. {@link ContextProbes.probeQueueState} — TASKS.md unclaimed task count.
 *
 * Pure-over-injection: the probe seams are injected by the caller so tests
 * can supply synthetic implementations without spawning processes. The
 * production wiring lives in `bin/minsky.mjs`.
 *
 * Pattern conformance (rule #8):
 *   - **Adapter** — Wirfs-Brock & McKean, *Object Design*, 2003 — each probe
 *     is behind a typed function seam. Conformance: full.
 *   - **Liveness probe** — Burns et al., *ACM Queue* 2016 — each async probe
 *     is bounded-time (via `raceTimeout`). Conformance: full.
 *
 * Failure modes (rule #7):
 *
 * | # | Failure mode | Trigger | Expected behavior |
 * |---|---|---|---|
 * | 1 | Probe times out | slow `gh` CLI / busy machine | graceful-degrade: use safe default |
 * | 2 | Probe throws | subprocess crash / fs error | caught in wrapper, safe default returned |
 * | 3 | PID file stale | crash without cleanup | `alive: false` (same as stopped) |
 * | 4 | TASKS.md absent | fresh checkout / moved file | `"unknown"` queue state |
 *
 * @module tick-loop/minsky-context
 */

// ---- Types ------------------------------------------------------------------

/** Worker 0 (the default) PID-liveness state. */
export type WorkerRunState =
  | { readonly alive: true; readonly pid: number }
  | { readonly alive: false };

/** Claude quota / binary state, derived from persisted hard-limit field. */
export type ClaudeContextState = "healthy" | "exhausted" | "binary-missing" | "unknown";

/** Local-LLM server reachability. */
export type LocalLlmContextState = "running" | "not-running";

/** `git status --porcelain` result. */
export type GitContextState = "clean" | "dirty" | "unknown";

/** Unclaimed task presence in TASKS.md. */
export type QueueContextState = "has-tasks" | "empty" | "unknown";

/** Open-PR statistics from `gh pr list`. */
export interface PrStats {
  readonly open: number;
  readonly conflicting: number;
}

/** Full context snapshot gathered before the action-plan decision. */
export interface MinskyContext {
  /** Worker 0 PID liveness. */
  readonly workerState: WorkerRunState;
  /** Age (ms) since the last worker log was written; undefined if never ran. */
  readonly lastIterationAgeMs: number | undefined;
  readonly claudeState: ClaudeContextState;
  readonly localLlmState: LocalLlmContextState;
  readonly gitState: GitContextState;
  readonly prStats: PrStats;
  readonly queueState: QueueContextState;
}

// ---- Probe seams ------------------------------------------------------------

/**
 * Injectable seams for each of the 7 context signals. The production
 * implementation is in `bin/minsky.mjs`; tests supply fakes.
 */
export interface ContextProbes {
  /**
   * Synchronous: read `<workersDir>/<id>.pid` and verify the process is alive.
   * Never throws — returns `{ alive: false }` on any error.
   */
  readonly probeWorker: () => WorkerRunState;

  /**
   * Synchronous: return ms since last worker log was written, or undefined
   * when no log exists. Never throws.
   */
  readonly probeLastIteration: () => number | undefined;

  /**
   * Async: consult persisted hard-limit state. Resolves within 500 ms
   * (file read only — no live probe to avoid wasting tokens). Falls back
   * to `"unknown"` on timeout or error.
   */
  readonly probeClaudeState: () => Promise<ClaudeContextState>;

  /**
   * Async: GET /v1/models on the local-LLM server. Falls back to
   * `"not-running"` on timeout or error.
   */
  readonly probeLocalLlmState: () => Promise<LocalLlmContextState>;

  /**
   * Async: run `git status --porcelain`. Falls back to `"unknown"` on
   * timeout or error.
   */
  readonly probeGitState: () => Promise<GitContextState>;

  /**
   * Async: run `gh pr list --state open --json number,mergeable`. Falls
   * back to `{ open: 0, conflicting: 0 }` on timeout or error.
   */
  readonly probePrStats: () => Promise<PrStats>;

  /**
   * Async: read TASKS.md and count unclaimed tasks (`- [ ]` lines without
   * `(@agent-id)`). Falls back to `"unknown"` on timeout or error.
   */
  readonly probeQueueState: () => Promise<QueueContextState>;
}

// ---- gatherMinskyContext ----------------------------------------------------

/**
 * Run all 7 probes in parallel, each timeout-bounded at `timeoutMs`
 * (default 500 ms). Graceful-degrade: a timed-out or throwing async probe
 * returns its safe default rather than crashing the context gather.
 *
 * The sync probes (worker state, last-iteration age) are never
 * timeout-wrapped — they must be fast by contract (pure file reads with
 * no subprocess spawning).
 *
 * @otel-exempt I/O orchestrator; callers carry the span.
 */
export async function gatherMinskyContext(
  probes: ContextProbes,
  timeoutMs = 500,
): Promise<MinskyContext> {
  const workerState = probes.probeWorker();
  const lastIterationAgeMs = probes.probeLastIteration();

  const [claudeState, localLlmState, gitState, prStats, queueState] = await Promise.all([
    raceTimeout(probes.probeClaudeState(), "unknown" as ClaudeContextState, timeoutMs),
    raceTimeout(probes.probeLocalLlmState(), "not-running" as LocalLlmContextState, timeoutMs),
    raceTimeout(probes.probeGitState(), "unknown" as GitContextState, timeoutMs),
    raceTimeout(probes.probePrStats(), { open: 0, conflicting: 0 } as PrStats, timeoutMs),
    raceTimeout(probes.probeQueueState(), "unknown" as QueueContextState, timeoutMs),
  ]);

  return {
    workerState,
    lastIterationAgeMs,
    claudeState,
    localLlmState,
    gitState,
    prStats,
    queueState,
  };
}

// ---- Internal helpers -------------------------------------------------------

/**
 * Race `promise` against a timeout. On timeout OR rejection, return `fallback`.
 * Cleans up the timeout handle on resolution to avoid timer leaks.
 *
 * (Internal helper — no JSDoc tag required.)
 */
async function raceTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timerId = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timerId);
    return result;
    // rule-6: handled-locally — probe threw; return safe fallback so caller always gets a value
  } catch {
    clearTimeout(timerId);
    return fallback;
  }
}
