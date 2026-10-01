/**
 * `@minsky/mape-k-loop/plan` — Plan phase of the MAPE-K loop
 * (Kephart & Chess, "The Vision of Autonomic Computing", *IEEE Computer* 2003).
 *
 * Pure function: given an Analyze-phase top-constraint + evidence, propose up
 * to 3 prompt {@link Variant}s that target the constraint. The Execute phase
 * (`./execute.ts`) consumes the variants, runs an A/B via the
 * `@minsky/prompt-optimizer` adapter, and applies the two guards.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           MAPE-K Plan phase per Kephart-Chess 2003.
 *                            Conformance: full for the variant-proposal contract;
 *                            the variant pool is a v0 fixed catalogue (3 mutations)
 *                            until sub-task 4 wires in `vision.md`-sourced mutation
 *                            templates.
 *   - `plan(...)`:           Pure decision function (Martin 2017). Conformance:
 *                            full — no I/O, no shared state, no clocks.
 *
 * @module mape-k-loop/plan
 */

import type { Constraint, ConstraintEvidence } from "./analyze.js";

/**
 * One prompt-variant proposal. The Plan phase emits these; the Execute phase
 * runs them through `@minsky/prompt-optimizer`'s A/B harness. The shape is
 * deliberately distinct from the optimizer's own `Variant` (`{id, system, user}`):
 * this one carries the *mutation rationale* the loop needs to log when a winner
 * rolls out, while the optimizer's `Variant` is the wire format it sends to the
 * underlying LLM.
 */
export interface Variant {
  /** Stable, unique-within-plan id (kebab-case recommended). */
  readonly id: string;
  /** The base prompt being mutated. */
  readonly basePrompt: string;
  /** Human-readable description of the mutation applied. */
  readonly mutation: string;
  /** Why this variant addresses the top constraint. */
  readonly rationale: string;
}

/** Argument bundle for `plan`. */
export interface PlanArgs {
  /**
   * Top constraint emitted by `analyze(...)`. The `topConstraint` of `Analysis`
   * is `Constraint | null`; the caller (Execute) must unwrap before calling
   * `plan` — passing `null` is a programming error and throws.
   */
  readonly topConstraint: Constraint;
  /**
   * Convenience handle to the constraint's evidence; exposed so callers can
   * pass it positionally without re-deriving it from `topConstraint.evidence`.
   * Must equal `topConstraint.evidence` — checked in dev to prevent drift.
   */
  readonly evidence: ConstraintEvidence;
  /** The base prompt the loop is currently running. */
  readonly basePrompt: string;
}

/**
 * One mutation template in the v0 catalogue. Each template is a
 * `(basePrompt, ruleId) → mutation` recipe — concrete enough that the
 * Execute phase can A/B them without further interpretation.
 */
interface MutationTemplate {
  readonly idSuffix: string;
  readonly mutation: string;
  readonly rationaleFor: (ruleId: string) => string;
}

/**
 * v0 catalogue of three concrete mutations. The catalogue is fixed at v0
 * intentionally — sub-task 4 will source the mutation templates from
 * `vision.md` once Knowledge is wired in.
 */
const MUTATIONS: readonly MutationTemplate[] = [
  {
    idSuffix: "enumerate-failure-modes",
    mutation: "add explicit failure-mode enumeration to the prompt prefix",
    rationaleFor: (ruleId) =>
      `${ruleId} fires when the model misses an edge case; explicitly enumerating the failure modes shifts attention onto the under-handled axis`,
  },
  {
    idSuffix: "direct-answer",
    mutation: "swap chain-of-thought scaffolding for a direct-answer instruction",
    rationaleFor: (ruleId) =>
      `${ruleId} cost is dominated by token-count drift; a direct-answer prompt removes the speculative reasoning chain that inflates the budget`,
  },
  {
    idSuffix: "tighten-scope",
    mutation: "tighten scope to the top-3 constraints; drop optional context",
    rationaleFor: (ruleId) =>
      `${ruleId} fires under context-overload; pruning to the top-3 constraints reduces the surface where the model can drift off-task`,
  },
];

/** Maximum number of variants Plan emits per call (Kohavi-Tang-Xu 2020 — small N keeps the A/B power high). */
export const MAX_VARIANTS_PER_PLAN = 3;

/**
 * Propose up to {@link MAX_VARIANTS_PER_PLAN} prompt variants targeting the
 * supplied top constraint. Returns the variants in catalogue order so the
 * output is deterministic across runs (matching the Analyze tie-break
 * convention in `analyze.ts`).
 *
 * Empty / blank `ruleId` is rejected up-front — Plan cannot operate without a
 * named constraint to target. Guarding the input with an early throw keeps
 * the function shallow (rule #6 — no nested try/catch).
 *
 * @otel mape-k-loop.plan
 */
export function plan(args: PlanArgs): readonly Variant[] {
  ensureValidArgs(args);
  const ruleId = args.topConstraint.ruleId;
  const variants: Variant[] = [];
  for (const template of MUTATIONS) {
    if (variants.length >= MAX_VARIANTS_PER_PLAN) break;
    variants.push({
      id: `${ruleId}-${template.idSuffix}`,
      basePrompt: args.basePrompt,
      mutation: template.mutation,
      rationale: template.rationaleFor(ruleId),
    });
  }
  return variants;
}

// ---------- helpers (≤10 cognitive complexity each) -------------------------

/** @otel-exempt pure helper of `plan`. */
function ensureValidArgs(args: PlanArgs): void {
  const ruleId = args.topConstraint.ruleId;
  if (typeof ruleId !== "string" || ruleId.trim().length === 0) {
    throw new Error("plan: topConstraint.ruleId must be a non-empty string");
  }
  if (typeof args.basePrompt !== "string") {
    throw new Error("plan: basePrompt must be a string");
  }
  if (args.evidence !== args.topConstraint.evidence) {
    throw new Error("plan: evidence must be the same reference as topConstraint.evidence");
  }
}
