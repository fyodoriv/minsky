/**
 * `@minsky/mape-k-loop/execute` — Execute phase of the MAPE-K loop
 * (Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer* 2003).
 *
 * Pure orchestration: hands the {@link Variant} list to a
 * {@link PromptOptimizer} (sub-task 1's adapter), picks the highest-scoring
 * variant, then applies the two guards (`sustainedGain`, `oscillation`)
 * before deciding `rollout` or `abstain`.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           MAPE-K Execute phase per Kephart-Chess 2003.
 *                            Conformance: full — the two guards + the
 *                            optimizer call cover the canonical Execute shape.
 *   - `execute(...)`:        Pure decision function (Martin 2017) over an
 *                            injected `optimizer`. Conformance: full — the
 *                            only async side is the optimizer call, which is
 *                            wrapped in the adapter (rule #2).
 *
 * @module mape-k-loop/execute
 */

import type { Variant as OptimizerVariant, PromptOptimizer } from "@minsky/prompt-optimizer";
import { DEFAULT_LOOKBACK_ITERATIONS, oscillation } from "./oscillation.js";
import type { Variant } from "./plan.js";
import { DEFAULT_WINDOW_DAYS, type RolloutHistory, sustainedGain } from "./sustained-gain.js";

/** One row of the eval set that the A/B harness scores variants against. */
export type EvalSetInput = Readonly<Record<string, unknown>>;

/** Per-variant aggregate score from the A/B run. */
export interface VariantScore {
  readonly variantId: string;
  /** Mean score across the eval-set (higher is better; convention only). */
  readonly score: number;
}

/** Decision the loop logs into the rollout-history. */
export type ExecuteDecision = "rollout" | "abstain";

/** Outcome of the Execute phase. */
export interface ExecuteResult {
  /** The picked variant (or `null` when the input list was empty). */
  readonly winner: Variant | null;
  /** What Execute decided. `abstain` when either guard fires. */
  readonly decision: ExecuteDecision;
  /** Human-readable reason for the decision (always populated). */
  readonly reason: string;
  /** Per-variant aggregate scores in `variants` order. */
  readonly abMetrics: readonly VariantScore[];
}

/** Argument bundle for `execute`. */
export interface ExecuteArgs {
  readonly variants: readonly Variant[];
  readonly evalSet: readonly EvalSetInput[];
  readonly optimizer: PromptOptimizer;
  /** Async metric function — higher is better. */
  readonly metric: (output: string, input: EvalSetInput) => Promise<number>;
  readonly history: RolloutHistory;
  /** Reference clock (injected for deterministic tests). */
  readonly now: Date;
  /**
   * Sustained-gain window in days. Defaults to {@link DEFAULT_WINDOW_DAYS}.
   * Forwarded to {@link sustainedGain}.
   */
  readonly sustainedGainWindowDays?: number;
  /**
   * Oscillation lookback in iterations. Defaults to
   * {@link DEFAULT_LOOKBACK_ITERATIONS}. Forwarded to {@link oscillation}.
   */
  readonly oscillationLookback?: number;
}

/**
 * Run the A/B over `variants` via `optimizer.runABTest`, then apply the two
 * guards. The decision is `rollout` only when both guards pass; otherwise
 * `abstain` with a reason from the failing guard.
 *
 * Returns `{ winner: null, decision: 'abstain', reason: 'execute: variants is empty' }`
 * when called with an empty variant list — the caller is expected to handle
 * the cold-start path explicitly rather than crash here (rule #7).
 *
 * @otel mape-k-loop.execute
 */
export async function execute(args: ExecuteArgs): Promise<ExecuteResult> {
  if (args.variants.length === 0) {
    return {
      winner: null,
      decision: "abstain",
      reason: "execute: variants is empty — nothing to A/B",
      abMetrics: [],
    };
  }
  const optimizerVariants = args.variants.map(toOptimizerVariant);
  const ab = await args.optimizer.runABTest({
    variants: optimizerVariants,
    inputs: args.evalSet,
    metric: args.metric,
    sustainedGainWindowDays: args.sustainedGainWindowDays ?? DEFAULT_WINDOW_DAYS,
  });
  const abMetrics = aggregateScores(args.variants, ab.results);
  const winner = pickWinner(args.variants, ab.winnerId);
  if (winner === null) {
    return {
      winner: null,
      decision: "abstain",
      reason: `execute: optimizer returned unknown winnerId="${ab.winnerId}"`,
      abMetrics,
    };
  }
  return decideWithGuards({
    winner,
    abMetrics,
    history: args.history,
    now: args.now,
    sustainedGainWindowDays: args.sustainedGainWindowDays ?? DEFAULT_WINDOW_DAYS,
    oscillationLookback: args.oscillationLookback ?? DEFAULT_LOOKBACK_ITERATIONS,
  });
}

// ---------- helpers (≤10 cognitive complexity each) -------------------------

/**
 * Map our Plan-phase {@link Variant} (carrying mutation + rationale) into the
 * `@minsky/prompt-optimizer` `Variant` shape (`{id, system, user}`). Mutation
 * + rationale become the system prefix; basePrompt becomes the user template.
 *
 * @otel-exempt pure helper of `execute`.
 */
function toOptimizerVariant(v: Variant): OptimizerVariant {
  return {
    id: v.id,
    system: `Mutation: ${v.mutation}\nRationale: ${v.rationale}`,
    user: v.basePrompt,
  };
}

/**
 * Aggregate per-call scores into per-variant means, in `variants` input order.
 *
 * @otel-exempt pure helper of `execute`.
 */
function aggregateScores(
  variants: readonly Variant[],
  results: readonly { variantId: string; score: number }[],
): readonly VariantScore[] {
  const sums = new Map<string, [number, number]>();
  for (const r of results) {
    const cur = sums.get(r.variantId) ?? [0, 0];
    sums.set(r.variantId, [cur[0] + r.score, cur[1] + 1]);
  }
  return variants.map((v) => {
    const cur = sums.get(v.id);
    if (cur === undefined) return { variantId: v.id, score: 0 };
    return { variantId: v.id, score: cur[1] === 0 ? 0 : cur[0] / cur[1] };
  });
}

/** @otel-exempt pure helper of `execute`. */
function pickWinner(variants: readonly Variant[], winnerId: string): Variant | null {
  for (const v of variants) {
    if (v.id === winnerId) return v;
  }
  return null;
}

interface GuardArgs {
  readonly winner: Variant;
  readonly abMetrics: readonly VariantScore[];
  readonly history: RolloutHistory;
  readonly now: Date;
  readonly sustainedGainWindowDays: number;
  readonly oscillationLookback: number;
}

/**
 * Apply the two guards to a chosen winner. Both must pass for `rollout`;
 * otherwise `abstain` with the failing guard's reason.
 *
 * @otel-exempt pure helper of `execute`.
 */
function decideWithGuards(g: GuardArgs): ExecuteResult {
  const sg = sustainedGain({
    winnerVariantId: g.winner.id,
    history: g.history,
    now: g.now,
    windowDays: g.sustainedGainWindowDays,
  });
  if (!sg.ok) {
    return {
      winner: g.winner,
      decision: "abstain",
      reason: sg.reason ?? "sustained-gain: guard fired",
      abMetrics: g.abMetrics,
    };
  }
  const osc = oscillation({
    proposedVariantId: g.winner.id,
    history: g.history,
    lookbackIterations: g.oscillationLookback,
  });
  if (!osc.ok) {
    return {
      winner: g.winner,
      decision: "abstain",
      reason: osc.reason ?? "oscillation: guard fired",
      abMetrics: g.abMetrics,
    };
  }
  return {
    winner: g.winner,
    decision: "rollout",
    reason: `execute: ${g.winner.id} passed both guards (sustained-gain + oscillation)`,
    abMetrics: g.abMetrics,
  };
}
