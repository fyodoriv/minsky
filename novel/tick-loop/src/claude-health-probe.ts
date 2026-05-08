// <!-- scope: human-approved minsky-cli-auto-bootstrap-local-llm slice 4 (operator 2026-05-08) -->
/**
 * `@minsky/tick-loop/claude-health-probe` — real Claude-health probe for
 * the `minsky` CLI's auto-bootstrap pre-flight. Slice 4 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`, surfaced by the operator on
 * 2026-05-08:
 *
 *   > "So that all will work even if no message can be sent to claude
 *   > right?"
 *
 * The previous slice's `probeClaudeHealthy` was a `which claude` check —
 * it returned `true` whenever the binary existed on PATH, regardless of
 * whether credits were exhausted. On a machine with claude installed but
 * weekly cap hit, the check passed, the bootstrap was skipped, and the
 * daemon spawned claude per-iteration which 429'd every time.
 *
 * This module fixes that gap by classifying the result of a synthetic
 * 1-token `claude --print` invocation. Three discrete outcomes:
 *
 *   - `"healthy"` — exit 0; claude returned text. Daemon should prefer claude.
 *   - `"exhausted"` — non-zero exit AND stderr matches one of the
 *     documented hard-limit patterns. Daemon should bootstrap local-LLM.
 *   - `"binary-missing"` — `claude` not on PATH. Daemon should bootstrap.
 *   - `"error"` — non-zero exit but no hard-limit signal (network blip,
 *     auth refresh, etc.). Daemon defaults to claude (don't trigger a
 *     17 GB download on a transient error).
 *
 * The hard-limit pattern set is shared with
 * {@link isClaudeHardLimit} from `llm-provider-selector.ts` — same
 * substrings, same load-bearing contract (rule #2 — single source of
 * truth). The probe itself spends ≤2 input tokens + ≤1 output token of
 * Claude budget when claude is healthy; on exhausted Claude, the probe
 * errors before generating, so the cost is zero (the API rejects the
 * request before billing).
 *
 * Pattern conformance (rule #8):
 *   - **Pure decision function** — Hughes 1989 (`classifyClaudeProbeOutput`
 *     is referentially transparent over `{ exitCode, stderrTail }`).
 *     Conformance: full.
 *   - **Synthetic-fault probe** — Burns et al. *ACM Queue* 2016 (the
 *     Borg/Omega/Kubernetes liveness-probe idiom: a small synthetic
 *     request against a documented endpoint, bounded-time, classified
 *     to a closed verdict set). Conformance: full.
 *
 * Failure modes (rule #7).
 *
 * Steady-state hypothesis: the classifier returns one of four discrete
 * verdicts for every legitimate input, never throws, never reads I/O.
 * Blast radius: a single `minsky` cold-start decision. Operator escape
 * hatch: `MINSKY_NO_AUTO_BOOTSTRAP=1` (skips the probe entirely).
 *
 * | # | Failure mode | Trigger | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | False positive (transient ENETUNREACH classified as exhausted) | network drop, claude unreachable mid-probe | `"error"` (the message tail does not match `HARD_LIMIT_PATTERNS`); daemon defaults to claude | "transient ENETUNREACH classified as error not exhausted" |
 * | 2 | False negative (Anthropic ships new wording) | API returns a 429 with stderr "Out of tokens, retry next week" | `"error"` (substring not in pattern set); daemon defaults to claude until pattern set updates. Pivot: ≥2 missed signals/week → broaden the pattern set | manual: ship a synthetic stderr-tail with new wording, assert verdict |
 * | 3 | Probe binary throws (claude binary corrupt) | spawn rejects | the wiring layer catches and returns `"error"` (the classifier itself does NOT see a throw — only typed { exitCode, stderrTail } records). | wiring-layer test |
 * | 4 | Probe stdout empty but exit 0 | claude succeeds with no output | `"healthy"` (we trust exit 0 — empty output usually means an instruction filter, not exhaustion) | "exit 0 with empty stdout classified as healthy" |
 * | 5 | Stderr-tail truncation drops the hard-limit substring | stderr ≥4 KB and the limit message is in the early bytes | the wiring layer captures the LAST 4 KB; a hard-limit message in the EARLY bytes of a multi-paragraph stderr is missed. Pivot: capture the FULL stderr (memory-bounded by Anthropic's response cap) | "long stderr classified correctly when limit message in tail" |
 *
 * @module tick-loop/claude-health-probe
 */

// ---- Types ----------------------------------------------------------------

/**
 * Closed verdict set returned by {@link classifyClaudeProbeOutput}.
 * Adding a new verdict is a breaking change requiring a rule-#9 pivot
 * record; downstream callers branch on this string.
 */
export type ClaudeHealthVerdict = "healthy" | "exhausted" | "binary-missing" | "error";

/**
 * Input to {@link classifyClaudeProbeOutput}. The wiring layer in
 * `bin/minsky.mjs` captures these from a synthetic `claude --print` spawn.
 */
export interface ClaudeProbeOutput {
  /** Process exit code; -1 if spawn was timed out by the wiring layer. */
  readonly exitCode: number;
  /** Tail-capped stderr (last ≤4 KB, mirroring `SpawnResult.stderrTail`). */
  readonly stderrTail: string;
  /** Optional stdout for verbose-binary-missing classification. */
  readonly stdoutTail?: string;
  /**
   * `true` when `which claude` returned undefined (binary not on PATH).
   * The wiring layer sets this BEFORE attempting the probe; if `true`,
   * the classifier short-circuits to `"binary-missing"` without
   * consulting `exitCode` / `stderrTail`.
   */
  readonly binaryAbsent?: boolean;
}

/**
 * Decision shape — verdict + a one-line reason for the operator-facing
 * log. Mirrors the `ProviderDecision` shape from `llm-provider-selector.ts`
 * for consistency.
 */
export interface ClaudeHealthDecision {
  readonly verdict: ClaudeHealthVerdict;
  readonly reason: string;
}

// ---- Hard-limit pattern set ----------------------------------------------

/**
 * Substrings classified as "Anthropic refused this request because the
 * weekly / monthly quota is exhausted". MUST stay in sync with
 * `HARD_LIMIT_PATTERNS` in `llm-provider-selector.ts` — the daemon and
 * the CLI's auto-bootstrap pre-flight read from the same load-bearing
 * contract (rule #2). When Anthropic ships a new wording, both lists
 * update in the same PR.
 *
 * Anchor: Anthropic's published `claude --print` error wording 2026-05-07;
 * `HARD_LIMIT_PATTERNS` (`novel/tick-loop/src/llm-provider-selector.ts:173`).
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

// ---- classifyClaudeProbeOutput -------------------------------------------

/**
 * Classify the result of a synthetic `claude --print` probe into one of
 * four verdicts. Pure: same input → same output, no I/O.
 *
 * Decision order:
 *   1. `binaryAbsent === true` → `"binary-missing"`.
 *   2. `exitCode === 0` → `"healthy"` (we trust a clean exit; empty
 *      stdout is OK — instruction filters can produce empty output).
 *   3. Non-zero exit + stderr matches `HARD_LIMIT_PATTERNS` → `"exhausted"`.
 *   4. Non-zero exit + no hard-limit match → `"error"` (transient).
 *
 * The order is deterministic and exhaustive — no fall-through.
 *
 * @otel tick-loop.claude-health-probe.classify
 */
export function classifyClaudeProbeOutput(input: ClaudeProbeOutput): ClaudeHealthDecision {
  if (input.binaryAbsent === true) {
    return {
      verdict: "binary-missing",
      reason: "`claude` not on PATH (install via npm: claude.com/claude-code)",
    };
  }
  if (input.exitCode === 0) {
    return {
      verdict: "healthy",
      reason: "claude --print returned exit 0",
    };
  }
  const haystack = input.stderrTail.toLowerCase();
  for (const needle of HARD_LIMIT_PATTERNS) {
    if (haystack.includes(needle)) {
      return {
        verdict: "exhausted",
        reason: `claude hard-limit signal in stderr (${truncateForReason(input.stderrTail)})`,
      };
    }
  }
  return {
    verdict: "error",
    reason: `claude --print exited ${input.exitCode}; no hard-limit signal in stderr (${truncateForReason(input.stderrTail)})`,
  };
}

/**
 * Truncate a stderr-tail string for the `reason` field. Caps at 80
 * chars + ellipsis to keep the operator's terminal log readable.
 *
 * (Internal helper — no JSDoc tag required.)
 */
function truncateForReason(s: string): string {
  const maxLen = 80;
  const trimmed = s.trim();
  if (trimmed.length === 0) return "<empty stderr>";
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}

// ---- needsLocalLlmBootstrap ----------------------------------------------

/**
 * Convenience wrapper that the wiring layer in `bin/minsky.mjs` calls
 * to decide whether to trigger the local-LLM bootstrap. Returns `true`
 * when the local-LLM path should be preferred (claude is unavailable
 * for any reason). Returns `false` only when claude is currently
 * healthy.
 *
 * The mapping:
 *   - `"healthy"` → `false` (claude works; daemon prefers it)
 *   - `"exhausted"` → `true` (claude refused; bootstrap local)
 *   - `"binary-missing"` → `true` (no claude at all; bootstrap local)
 *   - `"error"` → `false` (transient; defer to claude, don't trigger
 *     a 17 GB download on a network blip)
 *
 * The conservative bias on `"error"` is deliberate (rule #7 graceful-
 * degrade): false-positive bootstraps would download 17 GB on a
 * transient. The daemon's own `decideProvider` will catch the hard-
 * limit signal on the next claude iteration and switch to local then.
 *
 * @otel-exempt pure boolean projection over the verdict.
 */
export function needsLocalLlmBootstrap(decision: ClaudeHealthDecision): boolean {
  return decision.verdict === "exhausted" || decision.verdict === "binary-missing";
}
