// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 10 (operator 2026-05-08 — daemonized start-mlx-server step needs a readiness wait so the bootstrap pipeline doesn't hang on the indefinitely-running server process) -->
/**
 * `@minsky/tick-loop/local-llm-server-launcher` — pure
 * `pollUntilReachable` helper for the `start-mlx-server` step. Slice 10
 * of P0 task `minsky-cli-auto-bootstrap-local-llm`.
 *
 * The mlx-lm.server is a long-lived daemon: it never `close`s on the
 * happy path, so spawn-and-await-close (the slice-2 default for install
 * steps) hangs indefinitely. Slice 10 splits this case out:
 *
 *   1. The bootstrap executor signals the spawn adapter via
 *      `daemonMode: true` — the adapter detaches, writes a PID file,
 *      and resolves once the server passes a readiness probe.
 *   2. Readiness is signalled by the existing `buildServerProbe` in
 *      `local-llm-probes.ts` (HTTP 200 on `<url>/v1/models`).
 *   3. {@link pollUntilReachable} is the pure poll loop: takes a probe,
 *      polls with a fixed interval, returns once the probe reports
 *      reachable OR the cumulative wait exceeds the timeout. No I/O
 *      beyond what the injected probe + sleep seams perform.
 *
 * Pattern conformance (rule #8):
 *   - **Pure decision function** — Hughes 1989 — same inputs (probe seam,
 *     interval, timeout, clock) → same outputs (`PollOutcome` record).
 *   - **Adapter** — Wirfs-Brock & McKean 2003 — `sleepFn` + `nowFn` are
 *     injected so tests run in zero wall-clock; production wires
 *     `setTimeout` + `Date.now`.
 *
 * Failure modes & chaos verification (rule #7).
 *
 * Steady-state hypothesis: `pollUntilReachable` returns within
 * `timeoutMs + intervalMs` wall-clock; never throws (probe rejections
 * are typed as `attempts++` and the loop continues).
 *
 * | # | Failure mode | Trigger / fault axis | Expected behaviour | Chaos test |
 * |---|---|---|---|---|
 * | 1 | Probe ready on first call | `probe()` returns `reachable: true` immediately | `{ ready: true, attempts: 1 }` in O(1) | "ready immediately" test |
 * | 2 | Probe ready on Nth call | first N-1 calls `reachable: false`, then `true` | `{ ready: true, attempts: N }` after N polls | "ready after N retries" test |
 * | 3 | Probe never ready | every call `reachable: false` | `{ ready: false, attempts: ⌈timeoutMs/intervalMs⌉, reason }` | "never ready — times out" test |
 * | 4 | Probe rejects | `probe()` throws | rejection caught; loop continues with the throw count carried in `lastReason`; eventually times out | "probe rejects — captured, retried" test |
 * | 5 | Zero timeout | `timeoutMs === 0` | one probe attempt; if not ready, `{ ready: false, attempts: 1 }` | "zero timeout — one probe" test |
 *
 * @module tick-loop/local-llm-server-launcher
 */

import type { ServerState } from "./local-llm-bootstrap.js";

// ---- Types ----------------------------------------------------------------

/** Probe seam — same shape as `buildServerProbe()`'s return type. */
export type ServerProbeFn = () => Promise<ServerState>;

/** Sleep seam — `setTimeout`-based in production; tests inject 0-delay. */
export type SleepFn = (ms: number) => Promise<void>;

/** Clock seam — `Date.now` in production; tests inject a deterministic counter. */
export type NowFn = () => number;

export interface PollUntilReachableOpts {
  readonly probe: ServerProbeFn;
  /**
   * Interval between probe attempts in ms. Defaults to 1000 (1 s) —
   * mlx-lm.server typically takes 30–60 s to load a 17 GB model into
   * MLX, so a 1 s poll catches readiness within ~1 s of the server
   * actually being ready while keeping the probe count under 60.
   */
  readonly intervalMs?: number;
  /**
   * Total wall-clock budget in ms. Defaults to 120_000 (2 min) — the
   * model load is ~30–60 s on a warm cache; cold-cache reads can
   * stretch to 90 s on slower SSDs.
   */
  readonly timeoutMs?: number;
  /**
   * Sleep seam — production wires the global `setTimeout`. Tests inject
   * a no-op so the loop runs in zero wall-clock.
   */
  readonly sleepFn?: SleepFn;
  /**
   * Clock seam — production wires `Date.now`. Tests inject a counter
   * that advances by `intervalMs` on each call so the loop terminates
   * deterministically regardless of host wall-clock.
   */
  readonly nowFn?: NowFn;
}

export interface PollOutcome {
  /** `true` iff a probe call returned `reachable: true` within the budget. */
  readonly ready: boolean;
  /** Number of probe calls (including the final ready call). */
  readonly attempts: number;
  /** Total wall-clock elapsed in ms (from the injected `nowFn`). */
  readonly elapsedMs: number;
  /**
   * On `ready: false`, a short reason string from the last probe call
   * ("ECONNREFUSED", "timeout 2000ms", "rejected: <message>", etc.).
   * Undefined when `ready: true`.
   */
  readonly lastReason?: string;
}

// ---- Defaults -------------------------------------------------------------

export const DEFAULT_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_POLL_TIMEOUT_MS = 120_000;

const defaultSleepFn: SleepFn = (ms) =>
  new Promise((resolveDone) => {
    setTimeout(resolveDone, ms);
  });

const defaultNowFn: NowFn = () => Date.now();

// ---- pollUntilReachable ---------------------------------------------------

/**
 * Run one probe attempt; classify rejections + non-ready statuses into
 * a uniform `{ result, reason }` pair so the loop body in
 * {@link pollUntilReachable} stays under biome's cognitive-complexity
 * cap (rule #6). Pure helper.
 *
 * (Internal — not exported.)
 */
async function runOneProbe(
  probe: ServerProbeFn,
): Promise<{ result: ServerState; reason: string | undefined }> {
  try {
    const result = await probe();
    return { result, reason: result.reason };
    // rule-6: handled-locally — probe rejections during server warmup (transient ECONNRESET / ECONNREFUSED) are typed as a non-ready attempt; the loop retries until the budget runs out.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = `rejected: ${message.slice(0, 80)}`;
    return { result: { reachable: false, url: "", reason }, reason };
  }
}

/**
 * Poll the injected probe until it reports `reachable: true` or the
 * total elapsed wall-clock exceeds `timeoutMs`. Pure-over-injection;
 * see the failure-mode chaos table at the top of this file.
 *
 * Loop shape:
 *   1. Record start time via `nowFn()`.
 *   2. Run the probe. If `reachable`, return `{ ready: true, ... }`.
 *   3. If elapsed >= timeoutMs OR next-elapsed would exceed timeout,
 *      return `{ ready: false, ... }`.
 *   4. Sleep for `intervalMs`, then loop.
 *
 * The probe is allowed to reject (throw). Rejections are typed as a
 * non-ready attempt — the loop continues with `lastReason` carrying
 * `rejected: <message>`. Non-ready statuses ({@link ServerState} with
 * `reachable: false`) carry `lastReason` from the probe's `reason`
 * field (e.g., "ECONNREFUSED" while the server is starting).
 *
 * Always runs at least one probe attempt — even when `timeoutMs === 0`
 * (failure-mode row 5). This guarantees the caller gets a deterministic
 * one-shot probe in the zero-timeout case.
 *
 * @otel tick-loop.local-llm-server-launcher.poll
 */
export async function pollUntilReachable(opts: PollUntilReachableOpts): Promise<PollOutcome> {
  const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const sleepFn = opts.sleepFn ?? defaultSleepFn;
  const nowFn = opts.nowFn ?? defaultNowFn;

  const startedAt = nowFn();
  let attempts = 0;
  let lastReason: string | undefined;

  while (true) {
    attempts += 1;
    const { result, reason } = await runOneProbe(opts.probe);
    if (result.reachable) {
      return { ready: true, attempts, elapsedMs: nowFn() - startedAt };
    }
    lastReason = reason ?? lastReason;
    const elapsed = nowFn() - startedAt;
    if (elapsed + intervalMs > timeoutMs) {
      return buildTimeoutOutcome(attempts, elapsed, lastReason);
    }
    await sleepFn(intervalMs);
  }
}

/**
 * Build the timeout-branch return value. Extracted so
 * {@link pollUntilReachable} stays under biome's cognitive-complexity
 * cap (rule #6). Keeps the conditional `lastReason` spread out of the
 * main loop body. (Internal — not exported.)
 */
function buildTimeoutOutcome(
  attempts: number,
  elapsedMs: number,
  lastReason: string | undefined,
): PollOutcome {
  return {
    ready: false,
    attempts,
    elapsedMs,
    ...(lastReason !== undefined && { lastReason }),
  };
}
