/**
 * `@minsky/prompt-optimizer` — interface for prompt-A/B and structured one-shot
 * calls. The DSPy fallback per `research.md` § "DSPy fit".
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Adapter (structural) + Strategy (behavioral) per
 *                            Gamma, Helm, Johnson, Vlissides, *Design Patterns*,
 *                            1994. Conformance: full.
 *   - `runABTest(...)`:      A/B-test primitive — Kohavi, Tang, Xu,
 *                            *Trustworthy Online Controlled Experiments*,
 *                            Cambridge UP 2020 (per-variant scoring with
 *                            sustained-gain window). Conformance: full.
 *   - `structured<T>(...)`:  Typed-call analogue of DSPy's `Signature`
 *                            (Khattab et al., "DSPy", ICLR 2024) without the
 *                            Python runtime. Conformance: partial — the
 *                            schema is currently passed through as a JSON
 *                            object; full conformance arrives when the
 *                            tool-use response constraint lands in the
 *                            Anthropic strategy.
 *   - `selfTest()`:          Self-checking software / health probe per
 *                            Avizienis 1985 + Burns 2016. Conformance: full.
 *
 * Why this shape (rule #2): the adapter interface must be expressible without
 * naming a vendor. DSPy's `dspy.Module` would have leaked its class hierarchy
 * into the surface; instead the two-method shape (`runABTest` for the MAPE-K
 * Execute primitive; `structured` for one-shot calls) covers all five canonical
 * use cases listed in `research.md` § "DSPy fit" with no vendor mention. The
 * default Strategy (`AnthropicPromptOptimizer` in `./anthropic.js`) calls the
 * Anthropic Messages API directly, applying `cache_control` on the system
 * prefix per ARCHITECTURE.md § "Token economy".
 *
 * v0 ships:
 *   - The interface (this file).
 *   - `StubPromptOptimizer` — in-memory fake (Meszaros 2007) for tests.
 *   - `AnthropicPromptOptimizer` — Anthropic-SDK Strategy (`./anthropic.ts`).
 *
 * Anchors:
 *   - Khattab et al., "DSPy: Compiling Declarative Language Model Calls into
 *     Self-Improving Pipelines", *ICLR* 2024 (the rejected baseline; this
 *     interface preserves the optimizer-shape lessons without the runtime).
 *   - Kohavi, Tang, Xu, *Trustworthy Online Controlled Experiments*, Cambridge
 *     UP 2020, Ch. 3 (sustained-gain window; statistical rigour of A/B).
 *   - Gamma et al., *Design Patterns*, 1994 (Adapter + Strategy).
 *   - Meszaros, *xUnit Test Patterns*, 2007 (test fake / contract test).
 */

import type { SelfTestResult } from "@minsky/adapter-types";

export { aggregateStatus, type SelfTestResult, type SelfTestStatus } from "@minsky/adapter-types";

/** A single prompt variant — the unit the A/B harness rolls out. */
export interface Variant {
  /** Stable variant id (kebab-case recommended). */
  readonly id: string;
  /** System-prompt prefix. Cache-pinned by `AnthropicPromptOptimizer`. */
  readonly system: string;
  /** User-prompt template (placeholder substitution is the caller's job). */
  readonly user: string;
}

/** One variant's score against one input. */
export interface EvalResult {
  readonly variantId: string;
  /** Caller-defined metric value (higher is better; convention only). */
  readonly score: number;
  /** Tokens consumed across system + user + completion. */
  readonly tokens: number;
  /** OTEL trace id for the call (16-byte lowercase hex). Empty for stubs. */
  readonly traceId: string;
}

/** Aggregate outcome of one `runABTest` invocation. */
export interface ABResult {
  /** Winning variant id (highest mean score). Ties go to lowest `id`. */
  readonly winnerId: string;
  /** Per-variant per-input scores, in iteration order. */
  readonly results: readonly EvalResult[];
  /**
   * Whether the gain is sustained per Kohavi-Tang-Xu 2020. Always `false` from
   * a single `runABTest` call (which runs in seconds); a downstream caller
   * (`mape-k-loop`'s sustained-gain check) flips this `true` when the same
   * winner persists across the configured window (default 7 d).
   */
  readonly sustainedGainAt7d: boolean;
}

/**
 * Argument bundle for `runABTest`. Kept as a single record per Fowler 2002
 * (Patterns of Enterprise Application Architecture — value object); the named
 * fields make call sites self-documenting and avoid positional-argument
 * mistakes when (e.g.) `inputs` and `variants` have similar shapes.
 */
export interface RunABTestArgs {
  readonly variants: readonly Variant[];
  readonly inputs: readonly Readonly<Record<string, unknown>>[];
  /** Async metric function — higher is better. May call out to LLM judges. */
  readonly metric: (output: string, input: Readonly<Record<string, unknown>>) => Promise<number>;
  /** Sustained-gain window in days (Kohavi-Tang-Xu 2020). Default `7`. */
  readonly sustainedGainWindowDays?: number;
}

/** Argument bundle for the structured one-shot call (DSPy-Signature analogue). */
export interface StructuredArgs {
  readonly system: string;
  readonly user: string;
  /**
   * JSON Schema (draft-07) describing the expected response shape. Strategies
   * that support tool-use will enforce the schema; stubs and weaker backends
   * may parse-and-validate.
   */
  readonly schema: Readonly<Record<string, unknown>>;
}

/**
 * Adapter interface. Strategies (`AnthropicPromptOptimizer`,
 * `StubPromptOptimizer`) implement it.
 */
export interface PromptOptimizer {
  /** Run an A/B over `variants`; emit one OTEL span per variant per input. */
  runABTest(args: RunABTestArgs): Promise<ABResult>;
  /** Single typed call (DSPy-Signature analogue). */
  structured<T>(args: StructuredArgs): Promise<T>;
  /** Health probe per the {@link SelfTestResult} contract. */
  selfTest(): Promise<SelfTestResult>;
}

/**
 * In-memory `PromptOptimizer` for tests — Meszaros 2007 fake. Deterministic:
 * the metric function is called for every (variant × input) pair, and the
 * winner is the variant with the highest mean score (lowest id breaks ties).
 *
 * Pattern: test double / fake (Meszaros 2007). Conformance: full.
 *
 * @otel adapters.prompt-optimizer.stub
 */
export class StubPromptOptimizer implements PromptOptimizer {
  /** Number of times each variant has been "called" — useful for assertions. */
  public readonly callCount: Map<string, number> = new Map();

  /** Synthetic completion text. Defaults to `<variant-id>:<input-json>`. */
  private readonly completion: (
    variantId: string,
    input: Readonly<Record<string, unknown>>,
  ) => string;

  /** Synthetic token count per call. Defaults to 1. */
  private readonly tokensPerCall: number;

  constructor(
    opts: {
      completion?: (variantId: string, input: Readonly<Record<string, unknown>>) => string;
      tokensPerCall?: number;
    } = {},
  ) {
    this.completion = opts.completion ?? ((vid, input) => `${vid}:${JSON.stringify(input)}`);
    this.tokensPerCall = opts.tokensPerCall ?? 1;
  }

  /**
   * Score every (variant × input) pair via the caller's metric, then pick the
   * highest-mean-score variant.
   *
   * @otel adapters.prompt-optimizer.run-ab-test
   */
  async runABTest(args: RunABTestArgs): Promise<ABResult> {
    return runABTestPure(args, async (variantId, input) => {
      const count = this.callCount.get(variantId) ?? 0;
      this.callCount.set(variantId, count + 1);
      return {
        text: this.completion(variantId, input),
        tokens: this.tokensPerCall,
        traceId: "",
      };
    });
  }

  /**
   * Returns the schema unchanged, cast to `T`. Tests assert against the
   * shape the metric function would have observed.
   *
   * @otel adapters.prompt-optimizer.structured
   */
  async structured<T>(args: StructuredArgs): Promise<T> {
    // The fake echoes the schema as the response so downstream code can
    // assert on the schema-shaped contract. Production strategies (e.g.,
    // AnthropicPromptOptimizer) replace this with a real LLM call.
    return args.schema as unknown as T;
  }

  /** @otel adapters.prompt-optimizer.self-test */
  async selfTest(): Promise<SelfTestResult> {
    const start = Date.now();
    return {
      status: "green",
      message: "StubPromptOptimizer: in-memory fake — no I/O",
      latencyMs: Date.now() - start,
      lastCheck: new Date().toISOString(),
    };
  }
}

/**
 * Pure A/B-evaluation kernel. Strategies hand it a `call` function that
 * produces a completion + token count + trace id; the kernel does the score
 * aggregation and winner pick. Exported for use by the Anthropic strategy
 * and for direct testing.
 *
 * @otel-exempt pure function — no I/O of its own; the wrapping strategy
 *   methods carry the spans.
 */
export async function runABTestPure(
  args: RunABTestArgs,
  call: (
    variantId: string,
    input: Readonly<Record<string, unknown>>,
    variant: Variant,
  ) => Promise<{ text: string; tokens: number; traceId: string }>,
): Promise<ABResult> {
  const results: EvalResult[] = [];
  for (const variant of args.variants) {
    for (const input of args.inputs) {
      const out = await call(variant.id, input, variant);
      const score = await args.metric(out.text, input);
      results.push({
        variantId: variant.id,
        score,
        tokens: out.tokens,
        traceId: out.traceId,
      });
    }
  }
  const winnerId = pickWinner(args.variants, results);
  return {
    winnerId,
    results,
    sustainedGainAt7d: false,
  };
}

/**
 * Highest-mean-score variant; lowest variant id breaks ties (so the result is
 * deterministic across runs and across hash-order changes).
 *
 * @otel-exempt pure helper of `runABTestPure`; no I/O, no allocations beyond
 *   the score map.
 */
function pickWinner(variants: readonly Variant[], results: readonly EvalResult[]): string {
  if (variants.length === 0) {
    throw new Error("runABTest: variants must be non-empty");
  }
  const means = computeMeans(results);
  // Iterate in `variants` order so absent variants (zero-input case) still
  // get a deterministic answer: the first listed variant wins.
  let best: { id: string; mean: number } = { id: "", mean: Number.NEGATIVE_INFINITY };
  for (const v of variants) {
    const mean = means.get(v.id) ?? 0;
    if (isStrictlyBetter(mean, v.id, best)) {
      best = { id: v.id, mean };
    }
  }
  return best.id;
}

/**
 * Reduce `results` to a `variantId → mean` map. Pure helper.
 *
 * @otel-exempt pure helper of `pickWinner`.
 */
function computeMeans(results: readonly EvalResult[]): Map<string, number> {
  /** variantId → [sum, count] */
  const sums = new Map<string, [number, number]>();
  for (const r of results) {
    const cur = sums.get(r.variantId) ?? [0, 0];
    sums.set(r.variantId, [cur[0] + r.score, cur[1] + 1]);
  }
  const out = new Map<string, number>();
  for (const [id, [sum, count]] of sums) {
    out.set(id, count === 0 ? 0 : sum / count);
  }
  return out;
}

/**
 * Tie-break: lowest variant id wins. The "" sentinel for `best.id` stays
 * losing only on the first iteration, when any non-NEGATIVE_INFINITY mean
 * beats it — so the first listed variant wins the empty-results case.
 *
 * @otel-exempt pure helper of `pickWinner`.
 */
function isStrictlyBetter(mean: number, id: string, best: { id: string; mean: number }): boolean {
  if (mean > best.mean) return true;
  if (mean < best.mean) return false;
  if (best.id === "") return true;
  return id < best.id;
}
