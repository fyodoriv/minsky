/**
 * `@minsky/tick-loop/llm-provider-selector` — pure decision function that
 * picks the LLM provider for the next iteration: `claude` (default,
 * cloud), `local` (MLX-LM + Qwen + aider fallback), or `hold` (the
 * "circuit-broken AND local unreachable" degenerate case where iterating
 * would burn cycles for nothing — log and wait).
 *
 * Slice 1 of `local-llm-fallback-on-budget-pause` per `TASKS.md`. The
 * downstream slices wire this into `ProcessSpawnStrategy` (slice 2),
 * `bin/tick-loop.mjs` boot path (slice 3), switchback flap suppression
 * (slice 4), and chaos verification (slice 6).
 *
 * The decision matrix is the canonical table in
 * `docs/local-llm-fallback.md` § "How the daemon picks the provider":
 *
 *     | budgetState              | last-claude  | local-probe | provider |
 *     |--------------------------|--------------|-------------|----------|
 *     | normal                   | clean        | —           | claude   |
 *     | normal                   | hard-limit   | reachable   | local    |
 *     | normal                   | hard-limit   | unreachable | claude   |
 *     | graceful-degrade         | clean        | reachable   | claude   |
 *     | graceful-degrade         | hard-limit   | reachable   | local    |
 *     | circuit-break-and-notify | —            | reachable   | local    |
 *     | circuit-break-and-notify | —            | unreachable | hold     |
 *
 * Plus operator escape hatches:
 *   - `forceClaude: true` (env `MINSKY_LLM_PROVIDER=claude-only`) — always claude
 *   - `preferLocal: true` (env `MINSKY_LLM_PROVIDER=local-preferred`) — local
 *     wins when the probe is reachable, regardless of budget
 *
 * Pattern conformance (rule #8 / vision.md § "Pattern conformance index"):
 *   - **Strategy / Selector** — Gamma 1994 (the function-as-Strategy form;
 *     the function-shape returns "which Strategy do we run" rather than
 *     itself doing the work). Conformance: full.
 *   - **Decision table** — Pollack, "Decision Tables", *CACM* 1962 — the
 *     function body is a literal transcription of the table above; each
 *     branch is one row. Conformance: full.
 *   - **Pure decision function** — Hughes, "Why Functional Programming
 *     Matters", 1989 — referentially transparent over the input record;
 *     all I/O (probe, claude-stderr capture, budget-guard call) happens
 *     in the caller. Conformance: full.
 *
 * Failure modes & chaos verification (rule #7 / vision.md § 7).
 *
 * Steady-state hypothesis: `decideProvider` returns one of three closed
 * symbols (`"claude" | "local" | "hold"`) for every legitimate input, never
 * throws, never reads I/O. Blast radius: a single iteration's provider
 * choice. Operator escape hatch: `forceClaude: true` (or
 * `MINSKY_LLM_PROVIDER=claude-only` env in the wiring layer) forces the
 * claude path regardless of all other inputs. The `hold` symbol is itself
 * an escape hatch — when both providers are unavailable, the daemon's
 * outer loop logs and skips the tick rather than spinning on an
 * impossible spawn.
 *
 * | # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | Hard-limit detection false-positive (claude returns transient `ENETUNREACH` mistaken for a quota signal) | non-quota stderr-tail string near a quota keyword | `graceful-degrade` — `isClaudeHardLimit` requires explicit token match (`usage limit`/`rate limit`/`quota`/`429`); a transient network error keeps the provider on claude | `llm-provider-selector.test.ts` "does NOT classify generic ENETUNREACH as hard-limit" + "transient claude failure → claude" |
 * | 2 | Hard-limit detection false-negative (Anthropic ships a new wording that doesn't match the regex) | Anthropic CLI updates its quota-error string format | `graceful-degrade` — function returns `claude`; the daemon retries; the ratchet is the test fixture (add the new string + regex broadens). Pivot: ≥2 missed signals/week → use exit code (instead of stderr-tail) as the load-bearing signal | manual: ship a synthetic stderr-tail with a new wording, assert the function returns `claude`; the operator's pivot is to add the new substring to `HARD_LIMIT_PATTERNS` |
 * | 3 | Local probe stale (the probe was reachable 10 min ago but the server has since crashed) | `localProbeResult.observedAtMs` older than the probe's TTL | `graceful-degrade` — the function does NOT validate the probe's freshness (that's the caller's job — slice 3's wiring layer enforces a 60s TTL). When the probe goes stale, the caller flips `reachable: false` before calling. | covered by the wiring layer's TTL test + "circuit-break + unreachable → hold" in this file |
 * | 4 | Concurrent provider flips (two iterations in flight, budget changes mid-flight) | budget-guard transitions during a spawn | `graceful-degrade` — each iteration calls `decideProvider` independently; the function is referentially transparent, so concurrent calls produce concurrent independent decisions. Switchback discipline (slice 4) handles the flap | "decision is referentially transparent" test |
 *
 * @module tick-loop/llm-provider-selector
 */

// ---- Types ----------------------------------------------------------------

/**
 * Budget-guard's `BudgetAction` symbol set, restated structurally so this
 * module doesn't pull in `@minsky/budget-guard` (the whole stack is the
 * spawn substrate; we want a leaf decision function with zero internal
 * dependencies). Mirrors `BudgetDecisionLike.action` in `daemon.ts`.
 */
export type BudgetState =
  | "normal"
  | "graceful-degrade"
  | "circuit-break-and-notify"
  | "weekly-cap-warn";

/**
 * The shape of the last claude-iteration's failure signal. The daemon's
 * outer loop captures the `exitCode` and last-4KB `stderrTail` from
 * `ProcessSpawnStrategy.spawn(...)` (rule #2 — the same Adapter the daemon
 * already uses). `undefined` means "claude has not failed yet" (cold start
 * or last iteration was clean).
 */
export interface LastClaudeFailure {
  /** Non-zero exit code from `claude --print`. */
  readonly exitCode: number;
  /**
   * Last 4KB of stderr (matches `SpawnResult.stderrTail`'s tail-cap).
   * The classifier {@link isClaudeHardLimit} looks for documented
   * quota-error substrings here.
   */
  readonly stderrTail: string;
  /**
   * Optional clock-time the failure was observed (ms). Used by the wiring
   * layer to expire stale failures (e.g., "if older than 1h, treat as
   * clean again"). The pure function does not consult it — observability.
   */
  readonly observedAtMs?: number;
}

/**
 * Result of the 60-second probe of the local mlx-lm.server's
 * `/v1/models` endpoint. The probe lives in `scripts/check-mlx-server.mjs`
 * (slice 1 substrate) and is consulted by the wiring layer; the pure
 * function only branches on `reachable`.
 */
export interface LocalProbeResult {
  readonly reachable: boolean;
  /** ms since epoch (clock seam in the wiring layer; tests inject a constant). */
  readonly observedAtMs: number;
  /**
   * When `reachable: false`, a short reason string ("ECONNREFUSED",
   * "ENOTFOUND", "not-probed", "http 5xx", etc.) for the operator-facing
   * log line. The pure function passes it through into the decision's
   * `reason` field so the daemon's iteration span carries the cause.
   */
  readonly reason?: string;
}

export interface DecideProviderInput {
  /** Current budget-guard action. */
  readonly budgetState: BudgetState;
  /** Last claude failure if any; `undefined` for cold start / last-clean. */
  readonly lastClaudeFailure: LastClaudeFailure | undefined;
  /** Most recent local-probe result. */
  readonly localProbeResult: LocalProbeResult;
  /**
   * Operator escape hatch — when `true`, always returns `claude` regardless
   * of everything else. Wired from `MINSKY_LLM_PROVIDER=claude-only` in
   * slice 3. Wins over `preferLocal`.
   */
  readonly forceClaude?: boolean;
  /**
   * Operator opt-in — when `true` AND probe is reachable, returns `local`
   * even when budget is normal. Useful for testing aider/Qwen quality
   * without waiting for a budget exhaustion. Wired from
   * `MINSKY_LLM_PROVIDER=local-preferred` in slice 3.
   */
  readonly preferLocal?: boolean;
}

/**
 * The decision returned by {@link decideProvider}. The closed
 * `provider` symbol is the dispatch key the slice-2 wiring uses; the
 * `reason` is the human-readable string the iteration span carries
 * (so the dashboard's per-iteration log shows why the daemon picked
 * what it picked).
 */
export interface ProviderDecision {
  readonly provider: "claude" | "local" | "hold";
  readonly reason: string;
}

// ---- isClaudeHardLimit ----------------------------------------------------

/**
 * Substrings that mark a "your weekly / monthly quota is exhausted" failure
 * vs a transient network error. The list is intentionally explicit (not
 * regex-soup) so a future Anthropic CLI string change is a one-line PR
 * (add the new substring) rather than a regex debugging session.
 *
 * **Stability promise**: this list is the public contract for the slice;
 * adding a new substring is safe (broader detection); removing one is a
 * breaking change that needs a `pivot-llm-provider-selector` rule-#9
 * record before it lands.
 *
 * Anchor: Anthropic's published `claude --print` error wording as of
 * 2026-05-07 (and the hard-limit detection clause in
 * `docs/local-llm-fallback.md` § "How the daemon picks the provider").
 */
const HARD_LIMIT_PATTERNS: readonly string[] = [
  "usage limit",
  "rate limit",
  "rate-limited",
  "rate limited",
  "quota exceeded",
  "quota_exceeded",
  "429",
  "limit reached",
  "limit will reset",
  "limit hit",
];

/**
 * Classify whether a `LastClaudeFailure` indicates the operator's claude
 * subscription has hit its hard-limit (weekly cap / quota exhaustion) vs
 * a transient failure (network error, model overload, auth refresh).
 *
 * The signal is the stderr-tail substring match — empirically the
 * Anthropic CLI prints quota-related errors to stderr with one of the
 * patterns above. Exit code 0 short-circuits to `false` (a successful
 * iteration cannot have hit the limit). Empty stderr returns `false`
 * (we need an explicit signal — silent non-zero exits are not classified
 * as hard-limit per chaos table row 1).
 *
 * Pure: same input → same output, no I/O.
 *
 * @otel tick-loop.llm-provider-selector.is-claude-hard-limit
 */
export function isClaudeHardLimit(failure: LastClaudeFailure | undefined): boolean {
  if (failure === undefined) return false;
  if (failure.exitCode === 0) return false;
  if (failure.stderrTail.length === 0) return false;
  const haystack = failure.stderrTail.toLowerCase();
  for (const needle of HARD_LIMIT_PATTERNS) {
    if (haystack.includes(needle)) return true;
  }
  return false;
}

// ---- decideProvider -------------------------------------------------------

/**
 * Pick the LLM provider for the next iteration. Pure decision function;
 * see the JSDoc at the top of this file for the decision-table contract
 * and the failure-mode chaos table.
 *
 * The function-body order is the published table's order — top to
 * bottom; first matching branch wins. Mirrors decision-table semantics
 * (Pollack, *CACM* 1962): rows are ordered, the first row whose
 * conditions match fires. Refactoring an opaque cascade later
 * (Quine-McCluskey minimisation, etc.) requires updating both the table
 * in the docs and the code in lockstep — the pivot threshold for that
 * refactor is filed as `selector-decision-table-minimisation` in
 * TASKS.md if/when it lands.
 *
 * @otel tick-loop.llm-provider-selector.decide-provider
 */
export function decideProvider(input: DecideProviderInput): ProviderDecision {
  // Operator escape hatches first — most specific. Extracted into a
  // helper so the body stays under biome's cognitive-complexity cap
  // (rule #6, ≤10).
  const override = decideOperatorOverride(input);
  if (override !== undefined) return override;

  // Circuit-broken: claude is unusable until budget resets. Fall back to
  // local if reachable, else hold.
  if (input.budgetState === "circuit-break-and-notify") {
    if (input.localProbeResult.reachable) {
      return {
        provider: "local",
        reason: "budget circuit-break — claude paused; local reachable, falling back",
      };
    }
    return {
      provider: "hold",
      reason: `budget circuit-break and local unreachable (${formatProbeReason(input.localProbeResult)}) — holding`,
    };
  }

  // Hard-limit detected (e.g., weekly cap hit even though 5h window may
  // still show normal — the budget-guard's 5h cap and Anthropic's weekly
  // cap are independent). Switch to local if reachable.
  if (isClaudeHardLimit(input.lastClaudeFailure)) {
    if (input.localProbeResult.reachable) {
      return {
        provider: "local",
        reason: `claude hard-limit signal in stderr (${truncateForReason(input.lastClaudeFailure?.stderrTail ?? "")}) — local reachable`,
      };
    }
    return {
      provider: "claude",
      reason: `claude hard-limit signal but local unreachable (${formatProbeReason(input.localProbeResult)}); retrying claude`,
    };
  }

  // Default: claude. Reason carries the budget state for the iteration log.
  return {
    provider: "claude",
    reason: `budget ${input.budgetState}; claude clean`,
  };
}

/**
 * Resolve the operator-override branch (forceClaude / preferLocal) into a
 * decision, or `undefined` if neither flag is set. Extracted from
 * `decideProvider` so the body's cyclomatic + cognitive complexity stays
 * under biome's cap (rule #6, ≤10) without flattening the published
 * decision table.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function decideOperatorOverride(input: DecideProviderInput): ProviderDecision | undefined {
  if (input.forceClaude === true) {
    return {
      provider: "claude",
      reason: "forceClaude operator override (MINSKY_LLM_PROVIDER=claude-only)",
    };
  }
  if (input.preferLocal === true) {
    if (input.localProbeResult.reachable) {
      return {
        provider: "local",
        reason: "operator override (MINSKY_LLM_PROVIDER=local-preferred) and local reachable",
      };
    }
    return {
      provider: "claude",
      reason: `operator override preferLocal=true but local unreachable (${formatProbeReason(input.localProbeResult)})`,
    };
  }
  return undefined;
}

// ---- Pure helpers ---------------------------------------------------------

function formatProbeReason(probe: LocalProbeResult): string {
  return probe.reason ?? "no-reason";
}

/**
 * Truncate a stderr-tail string for inclusion in a `reason` field. Caps at
 * 80 chars + ellipsis to keep iteration spans readable in the dashboard.
 */
function truncateForReason(s: string): string {
  const maxLen = 80;
  const trimmed = s.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}
