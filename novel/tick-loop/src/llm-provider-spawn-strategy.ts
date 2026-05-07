/**
 * `@minsky/tick-loop/llm-provider-spawn-strategy` — wrapper {@link SpawnStrategy}
 * (Gamma 1994 — Strategy as a decorator) that dispatches per iteration
 * between a Claude Code spawn strategy and a local-LLM (aider) spawn
 * strategy based on `decideProvider(...)` from
 * `./llm-provider-selector.ts`. Slice 3 of
 * `local-llm-fallback-on-budget-pause` per TASKS.md.
 *
 * Holds the only state across iterations:
 *   - `lastClaudeFailure` — captured from the most recent claude spawn
 *     (so the next iteration's `decideProvider` can read it);
 *   - cached probe result with TTL (so we don't probe every tick);
 *   - reference to the budget-guard (for `budgetState`).
 *
 * Pattern conformance (rule #8):
 *   - **Strategy decorator** — Gamma 1994. The wrapper IS a `SpawnStrategy`,
 *     and dispatches to one of two underlying `SpawnStrategy`s per call.
 *     Conformance: full.
 *   - **Memoization with TTL** — Aho-Sethi-Ullman, *Compilers*, 1986
 *     (memoised re-evaluation guarded by a freshness predicate). The
 *     probe is re-run only when the cache is older than `probeTtlMs`.
 *     Conformance: full.
 *   - **Pure decision delegate** — `decideProvider(...)` is the pure
 *     decision function (rule #2 — every dep behind interface; the
 *     wrapper holds I/O, the function is referentially transparent).
 *     Conformance: full.
 *
 * Failure modes & chaos verification (rule #7).
 *
 * Steady-state hypothesis: the wrapper returns a `SpawnResult` whose
 * `provider` field is always one of `{"claude", "local", "hold"}` and
 * matches the dispatch path that produced the `exitCode` / `stdoutTail` /
 * `stderrTail`. Blast radius: a single iteration. Operator escape hatch:
 * `forceClaude: true` (env `MINSKY_LLM_PROVIDER=claude-only`) collapses to
 * the legacy claude-only behaviour.
 *
 * | # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | Claude strategy throws (e.g., spawn ENOENT — claude binary missing) | `claudeStrategy.spawn(...)` rejects | `loud-crash` per Armstrong 2007 — the wrapper does NOT catch; the rejection bubbles up to the supervisor via the daemon's `runOneIteration`. Operator sees the missing-binary at the supervisor layer, not as a silent fallback. Rationale: a missing claude binary is configuration (not a runtime fault); silently switching to local would mask the misconfiguration. | covered by spawn-strategy's existing `child.on("error", reject)` test; the wrapper does not add a try/catch |
 * | 2 | Local strategy throws (aider missing) when budget is `circuit-break` | `localStrategy.spawn(...)` rejects | same as row 1 — no catch; supervisor sees it. Daemon's outer loop respawns; operator sees the misconfig | same |
 * | 3 | Probe function throws | `probe()` rejects | `graceful-degrade` — the wrapper catches at the probe boundary (only) and produces a stale `LocalProbeResult` with `reason: "probe-error: ..."`. Tested. | `llm-provider-spawn-strategy.test.ts` "probe error: degrades to unreachable with reason" |
 * | 4 | Hard-limit detected from previous iteration but probe not yet run (cold start) | `lastClaudeFailure: hard-limit, probeResult: undefined` | the wrapper triggers an inline probe on first dispatch when no cached result exists | `llm-provider-spawn-strategy.test.ts` "fresh wrapper triggers probe on first call" |
 * | 5 | Budget snapshot throws | `budgetGuard.decide()` rejects | propagated. The supervisor handles via existing budget-paused-recovery code paths. | covered by daemon-side tests for budget-guard rejection |
 *
 * @module tick-loop/llm-provider-spawn-strategy
 */

import {
  type DecideProviderInput,
  type LastClaudeFailure,
  type LocalProbeResult,
  type ProviderDecision,
  decideProvider,
} from "./llm-provider-selector.js";
import type { SpawnInput, SpawnResult, SpawnStrategy } from "./spawn-strategy.js";

// ---- Types ----------------------------------------------------------------

/**
 * Minimal seam over `BudgetGuard.decide()`'s `action` field — the wrapper
 * consults the current budget state per spawn call. Mirrors
 * `BudgetDecisionLike` in `daemon.ts` (kept structurally compatible so
 * the bin layer can hand the same value).
 */
export interface BudgetStateProbe {
  decide():
    | Promise<{ readonly action: DecideProviderInput["budgetState"] }>
    | { readonly action: DecideProviderInput["budgetState"] };
}

export interface LlmProviderSpawnStrategyOptions {
  /** Underlying strategy for the claude path (production: `ProcessSpawnStrategy` with claude invocation). */
  readonly claude: SpawnStrategy;
  /** Underlying strategy for the local path (production: `ProcessSpawnStrategy` with aider invocation). */
  readonly local: SpawnStrategy;
  /** Probe function — slice-1 substrate at `scripts/check-mlx-server.mjs`. */
  readonly probe: () => Promise<LocalProbeResult>;
  /** Budget-guard adapter for the current budget state. */
  readonly budgetGuard: BudgetStateProbe;
  /**
   * Probe cache TTL in ms. Default 60_000 (60s — matches the docs).
   * The wrapper re-probes only when the cached result is older than this.
   */
  readonly probeTtlMs?: number;
  /** Operator escape hatch: `MINSKY_LLM_PROVIDER=claude-only`. */
  readonly forceClaude?: boolean;
  /** Operator opt-in: `MINSKY_LLM_PROVIDER=local-preferred`. */
  readonly preferLocal?: boolean;
  /**
   * Switchback probe interval (slice 4 of `local-llm-fallback-on-budget-pause`).
   * After every N consecutive iterations on local, the next iteration
   * tries claude once even if `lastClaudeFailure` carries a hard-limit,
   * to discover whether the operator's quota window has rolled over. If
   * claude succeeds (clean exit), `lastClaudeFailure` is cleared and
   * subsequent iterations route to claude normally. If claude
   * hard-limits again, we capture the new failure and continue on local.
   *
   * Default 5 (every 5th local iteration probes claude). Tighter than
   * Anthropic's documented quota-window granularity (5h / weekly) so the
   * worst-case "stuck on local after the operator topped up credits"
   * window is bounded by `5 × tickIntervalMs` minutes — at the daemon's
   * default 5-min cadence that's at most 25 minutes of "claude is
   * available but we didn't try" delay after a top-up.
   *
   * Set to `0` to disable switchback probing entirely (the wrapper
   * stays on local until something clears `lastClaudeFailure` — useful
   * for chaos tests + the `forceClaude` operator escape hatch).
   *
   * Pivot threshold (rule #9): if the switchback probe burns >2 wasted
   * iterations/day on operator stacks where claude is genuinely
   * exhausted for >24h, raise the interval to 20 (every 20th iter); if
   * the switchback probe is still missing real recoveries, drop to 1
   * (every iter probes — equivalent to disabling the carry-over).
   */
  readonly switchbackProbeEvery?: number;
  /** Clock seam for tests. Default `Date.now`. */
  readonly now?: () => number;
  /**
   * Optional sink for `tick-loop.llm-provider.dispatch` spans. One span
   * per `spawn(...)` call, attributes:
   *   - `provider` — claude / local / hold
   *   - `reason` — non-empty string from `decideProvider`
   *   - `budget.state` — current budget action
   *   - `local.reachable` — boolean
   *   - `switchback_probe` — true when the dispatch was a switchback
   *     probe forcing claude through a hard-limit carryover (slice 4)
   */
  readonly emit?: (event: {
    name: string;
    attributes: Record<string, string | number | boolean>;
  }) => void;
}

const DEFAULT_PROBE_TTL_MS = 60_000;
const DEFAULT_SWITCHBACK_PROBE_EVERY = 5;

// ---- Default probe error → graceful-degrade --------------------------------

/**
 * Wrap `opts.probe` so a thrown error becomes a `LocalProbeResult` with
 * `reachable: false` and `reason: "probe-error: <message>"`. Matches
 * chaos table row 3 (graceful-degrade for probe failures).
 *
 * Pure given a (potentially impure) `probe` and `now`. Exported for tests.
 *
 * @otel tick-loop.llm-provider-spawn-strategy.probe-with-error-guard
 */
export async function probeWithErrorGuard(
  probe: () => Promise<LocalProbeResult>,
  now: () => number,
): Promise<LocalProbeResult> {
  try {
    return await probe();
    // rule-6: handled-locally — probe error is a documented chaos mode (table row 3 graceful-degrade — keep dispatching with a stale "unreachable" state rather than crash the supervisor)
  } catch (err) {
    const message = err instanceof Error ? err.message : typeof err === "string" ? err : "unknown";
    return {
      reachable: false,
      observedAtMs: now(),
      reason: `probe-error: ${truncate(message, 80)}`,
    };
  }
}

/**
 * Truncate `s` to `cap` chars + ellipsis. Pure helper.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return `${s.slice(0, cap)}...`;
}

// ---- LlmProviderSpawnStrategy ---------------------------------------------

/**
 * The wrapper Strategy. Holds (a) two underlying spawn strategies, (b)
 * cached probe result with TTL, (c) last-claude-failure carry-over, and
 * dispatches per `decideProvider(...)`.
 *
 * Production wiring (slice 3 in `bin/tick-loop.mjs`): two
 * `ProcessSpawnStrategy` instances — one with the claude invocation
 * builder and one with the aider invocation builder — plus a probe
 * function that shells out to `node scripts/check-mlx-server.mjs` (or
 * the in-process equivalent), plus the existing `realGuard`.
 */
export class LlmProviderSpawnStrategy implements SpawnStrategy {
  private readonly opts: LlmProviderSpawnStrategyOptions;
  private readonly probeTtlMs: number;
  private readonly switchbackProbeEvery: number;
  private readonly nowFn: () => number;
  /** Cached probe result; `undefined` means "never probed". */
  private cachedProbe: LocalProbeResult | undefined;
  /** Carried last-claude-failure; `undefined` after a clean claude spawn. */
  private lastClaudeFailure: LastClaudeFailure | undefined;
  /**
   * Count of consecutive iterations that ran on `local` (slice 4 — the
   * switchback-probe interval). Resets to 0 on any non-local dispatch.
   * When this reaches `switchbackProbeEvery`, the next iteration forces
   * claude despite a hard-limit carry-over to discover whether the
   * operator's quota window has rolled over.
   */
  private consecutiveLocalIterations: number;

  constructor(opts: LlmProviderSpawnStrategyOptions) {
    this.opts = opts;
    this.probeTtlMs = opts.probeTtlMs ?? DEFAULT_PROBE_TTL_MS;
    this.switchbackProbeEvery = opts.switchbackProbeEvery ?? DEFAULT_SWITCHBACK_PROBE_EVERY;
    this.nowFn = opts.now ?? Date.now;
    this.cachedProbe = undefined;
    this.lastClaudeFailure = undefined;
    this.consecutiveLocalIterations = 0;
  }

  /**
   * Pick the provider and dispatch. Returns the underlying strategy's
   * `SpawnResult` with the wrapper's `provider` tag added. For `hold`
   * (both providers unavailable), returns a synthetic failed result so
   * the daemon's outer loop logs and retries on the next tick.
   *
   * Slice 4: when the wrapper has been on `local` for
   * `switchbackProbeEvery` consecutive iterations, the next iteration
   * suppresses the carried `lastClaudeFailure` (treated as `undefined`
   * for the decision call) so `decideProvider(...)` can route back to
   * claude. The probe-iteration's exit captures a fresh failure (or
   * clears it) — same as any other claude iteration. This bounds the
   * "stuck on local" window to `switchbackProbeEvery × tickIntervalMs`
   * even when claude's stderr has been hard-limit-tagged.
   *
   * @otel tick-loop.llm-provider-spawn-strategy.spawn
   */
  async spawn(input: SpawnInput): Promise<SpawnResult> {
    const probeResult = await this.getProbe();
    const budgetDecision = await Promise.resolve(this.opts.budgetGuard.decide());
    const isSwitchbackProbe = this.shouldRunSwitchbackProbe();
    const failureForDecision = isSwitchbackProbe ? undefined : this.lastClaudeFailure;
    const decision = decideProvider({
      budgetState: budgetDecision.action,
      lastClaudeFailure: failureForDecision,
      localProbeResult: probeResult,
      ...(this.opts.forceClaude === undefined ? {} : { forceClaude: this.opts.forceClaude }),
      ...(this.opts.preferLocal === undefined ? {} : { preferLocal: this.opts.preferLocal }),
    });
    this.emitDispatchSpan(decision, budgetDecision.action, probeResult, isSwitchbackProbe);
    return this.dispatch(decision, input);
  }

  /**
   * True when the wrapper has been on `local` for `switchbackProbeEvery`
   * consecutive iterations and is due to probe claude. False when:
   *   - `switchbackProbeEvery` is `0` (probing disabled);
   *   - we don't have a hard-limit carry to override;
   *   - the consecutive-local count hasn't reached the interval.
   *
   * (Internal helper — no JSDoc tag required.)
   */
  private shouldRunSwitchbackProbe(): boolean {
    if (this.switchbackProbeEvery <= 0) return false;
    if (this.lastClaudeFailure === undefined) return false;
    return this.consecutiveLocalIterations >= this.switchbackProbeEvery;
  }

  /**
   * Get the probe result, re-running the probe when the cache is stale
   * (or absent). Errors degrade to `unreachable` per chaos table row 3.
   *
   * (Internal helper — no JSDoc tag required.)
   */
  private async getProbe(): Promise<LocalProbeResult> {
    const now = this.nowFn();
    const cached = this.cachedProbe;
    if (cached !== undefined && now - cached.observedAtMs < this.probeTtlMs) {
      return cached;
    }
    const fresh = await probeWithErrorGuard(this.opts.probe, this.nowFn);
    this.cachedProbe = fresh;
    return fresh;
  }

  /**
   * Dispatch to claude / local / hold based on `decision.provider`. For
   * claude, captures the failure (if non-zero exit) into
   * `this.lastClaudeFailure` for the next iteration's
   * `decideProvider(...)`. For local, increments
   * `consecutiveLocalIterations` so slice 4's switchback probe fires
   * after `switchbackProbeEvery` calls. Any non-local dispatch resets
   * the count.
   *
   * (Internal helper — no JSDoc tag required.)
   */
  private async dispatch(decision: ProviderDecision, input: SpawnInput): Promise<SpawnResult> {
    if (decision.provider === "hold") {
      // `hold` is neither claude nor local, but it does NOT advance
      // toward a switchback probe (we couldn't get to local) and does
      // NOT reset the consecutive-local count (we'd lose progress on a
      // transient local outage). Leave the counter unchanged.
      return synthesiseHoldResult(decision.reason);
    }
    const strategy = decision.provider === "claude" ? this.opts.claude : this.opts.local;
    const result = await strategy.spawn(input);
    if (decision.provider === "claude") {
      this.captureClaudeFailure(result);
      this.consecutiveLocalIterations = 0;
    } else {
      // provider === "local"
      this.consecutiveLocalIterations += 1;
    }
    return { ...result, provider: decision.provider };
  }

  /**
   * Update `this.lastClaudeFailure` after a claude spawn. Clean exit (0)
   * clears the carry; non-zero captures the snapshot.
   *
   * (Internal helper — no JSDoc tag required.)
   */
  private captureClaudeFailure(result: SpawnResult): void {
    if (result.exitCode === 0) {
      this.lastClaudeFailure = undefined;
      return;
    }
    this.lastClaudeFailure = {
      exitCode: result.exitCode,
      stderrTail: result.stderrTail,
      observedAtMs: this.nowFn(),
    };
  }

  /**
   * Emit one dispatch span per spawn call. Visible-not-silent (rule #4)
   * — the operator's terminal sees the chosen provider for every tick.
   *
   * (Internal helper — no JSDoc tag required.)
   */
  private emitDispatchSpan(
    decision: ProviderDecision,
    budgetState: DecideProviderInput["budgetState"],
    probe: LocalProbeResult,
    isSwitchbackProbe: boolean,
  ): void {
    if (this.opts.emit === undefined) return;
    this.opts.emit({
      name: "tick-loop.llm-provider.dispatch",
      attributes: {
        provider: decision.provider,
        reason: decision.reason,
        "budget.state": budgetState,
        "local.reachable": probe.reachable,
        ...(probe.reason === undefined ? {} : { "local.reason": probe.reason }),
        ...(isSwitchbackProbe ? { switchback_probe: true } : {}),
      },
    });
  }
}

/**
 * Build the synthetic `SpawnResult` for the `hold` decision. Exit code
 * 99 is documented (matches the `provider-hold` reason); the daemon's
 * outer loop sees this as a `failed` iteration and reschedules.
 *
 * Exported for tests.
 *
 * @otel-exempt pure builder for the hold-result shape; instrumentation
 *   lives at the dispatch span emitted by the wrapper's `spawn(...)`.
 */
export function synthesiseHoldResult(reason: string): SpawnResult {
  return {
    exitCode: 99,
    durationMs: 0,
    stdoutTail: "",
    stderrTail: `<provider-hold>: ${reason}`,
    provider: "hold",
  };
}
