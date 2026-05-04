/**
 * `@minsky/mape-k-loop/analyze` — Analyze phase of the MAPE-K loop.
 * Implements Goldratt's Theory of Constraints (Goldratt, *The Goal*, 1984):
 * the *top* constraint is the one rule with the highest aggregate cost,
 * computed as `violationCount × costEstimate(ruleId)`.
 *
 * Pure function. The CLI wrapper that runs `monitor → analyze → plan` end-to-end
 * lives in sub-task 4 (`mape-k-knowledge-and-integration`).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           MAPE-K Analyze phase per Kephart-Chess 2003.
 *                            Conformance: full for the rule-level constraint
 *                            ranking; the broader "what to plan against"
 *                            shape ships in sub-task 3.
 *   - `analyze(...)`:        Theory of Constraints — pick the highest-cost
 *                            constraint per Goldratt 1984. Conformance: full.
 *                            Tie-break is alphabetical by ruleId, so two
 *                            equal-cost constraints produce a deterministic
 *                            answer across runs.
 *   - `costEstimate(...)`:   Per-rule weight (default 1). Conformance: partial
 *                            — the v0 default treats every rule as equally
 *                            expensive; the configurable schedule arrives in
 *                            sub-task 3 (Plan), where the weight is sourced
 *                            from `vision.md` § "Pattern conformance index".
 *
 * @module mape-k-loop/analyze
 */

import type { HealthSnapshot, RuleViolationStats } from "./monitor.js";

/**
 * Severity bucket for the {@link Constraint}. Matches the rule #7 status
 * lattice (`@minsky/adapter-types` `SelfTestStatus`) one-to-one but is not
 * imported as `SelfTestStatus` because the semantics here are constraint
 * severity, not adapter health — naming the type after its meaning per rule #8.
 */
export type ConstraintSeverity = "low" | "medium" | "high";

/** Per-constraint evidence the Plan phase consumes. */
export interface ConstraintEvidence {
  /** Number of times this rule was violated across the snapshot. */
  readonly violationCount: number;
  /** Per-rule weight used in the cost product. */
  readonly costEstimate: number;
  /** Up to 3 short evidence strings carried forward from the Monitor phase. */
  readonly exemplarRecords: readonly string[];
}

/** One constraint (the rule that bottlenecks the system per Goldratt 1984). */
export interface Constraint {
  readonly ruleId: string;
  readonly evidence: ConstraintEvidence;
  readonly severity: ConstraintSeverity;
}

/** Output of the Analyze phase. */
export interface Analysis {
  /**
   * The rule with the highest `violationCount × costEstimate` product.
   * `null` when the snapshot has zero violations across all rules.
   */
  readonly topConstraint: Constraint | null;
  /** Convenience accessor — same as `topConstraint?.evidence` flattened. */
  readonly evidence: ConstraintEvidence | null;
  /** Convenience accessor — same as `topConstraint?.severity`. */
  readonly severity: ConstraintSeverity | null;
}

/**
 * Optional cost-weight schedule. Maps `ruleId` → cost weight; rules absent
 * from the map use {@link DEFAULT_RULE_COST}. Per the v0 acceptance, this
 * is supplied by the caller (a future sub-task 3 wires it from
 * `vision.md`); the default schedule is the identity (every rule = 1).
 */
export type CostSchedule = Readonly<Record<string, number>>;

/** Default per-rule cost weight when no schedule entry is supplied. */
export const DEFAULT_RULE_COST = 1;

/**
 * Severity thresholds in `violationCount × costEstimate` units. The exact
 * cutoffs are deliberately conservative for v0; sub-task 3 will refine them
 * once Plan starts consuming the severity field.
 */
export const SEVERITY_THRESHOLDS = {
  /** ≥ this product → `medium`. Below → `low`. */
  medium: 3,
  /** ≥ this product → `high`. */
  high: 8,
} as const;

/** Argument bundle for `analyze`. */
export interface AnalyzeArgs {
  readonly snapshot: HealthSnapshot;
  /** Optional per-rule cost weights. Defaults to identity (every rule = 1). */
  readonly costs?: CostSchedule;
}

/**
 * Apply Goldratt's Theory of Constraints to a {@link HealthSnapshot}.
 * Picks the rule whose `violationCount × costEstimate(ruleId)` is highest;
 * ties go to the lowest `ruleId` alphabetically (deterministic output
 * across runs, matching the prompt-optimizer tie-break convention in
 * sub-task 1's `pickWinner`).
 *
 * @otel mape-k-loop.analyze
 */
export function analyze(args: AnalyzeArgs): Analysis {
  const snapshot = args.snapshot;
  const costs = args.costs ?? {};
  const ranked = rankConstraints(snapshot.violations, costs);
  const top = ranked[0];
  if (top === undefined) {
    return { topConstraint: null, evidence: null, severity: null };
  }
  const constraint: Constraint = {
    ruleId: top.ruleId,
    evidence: {
      violationCount: top.violationCount,
      costEstimate: top.costEstimate,
      exemplarRecords: top.exemplars,
    },
    severity: severityOf(top.product),
  };
  return {
    topConstraint: constraint,
    evidence: constraint.evidence,
    severity: constraint.severity,
  };
}

/**
 * Per-rule weight lookup. Falls back to {@link DEFAULT_RULE_COST} when the
 * caller omits a weight, OR when the entry is non-finite / non-positive
 * (graceful-degrade per rule #7 — a misconfigured weight should not zero
 * out a real constraint).
 *
 * @otel mape-k-loop.cost-estimate
 */
export function costEstimate(ruleId: string, costs: CostSchedule): number {
  const w = costs[ruleId];
  if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) return DEFAULT_RULE_COST;
  return w;
}

// ---------- helpers (≤10 cognitive complexity each) -------------------------

interface RankedConstraint {
  readonly ruleId: string;
  readonly violationCount: number;
  readonly costEstimate: number;
  readonly product: number;
  readonly exemplars: readonly string[];
}

/**
 * Score every rule, drop zero-product entries (no signal), then sort by
 * descending product with alphabetical ruleId as the tie-break.
 *
 * @otel-exempt pure helper of `analyze`.
 */
function rankConstraints(
  violations: readonly RuleViolationStats[],
  costs: CostSchedule,
): readonly RankedConstraint[] {
  const scored: RankedConstraint[] = [];
  for (const v of violations) {
    const cost = costEstimate(v.ruleId, costs);
    const product = v.violationCount * cost;
    if (product <= 0) continue;
    scored.push({
      ruleId: v.ruleId,
      violationCount: v.violationCount,
      costEstimate: cost,
      product,
      exemplars: v.exemplars,
    });
  }
  scored.sort(compareConstraints);
  return scored;
}

/**
 * Higher product wins; ties broken alphabetically by ruleId so the output
 * is deterministic across runs and across hash-order changes.
 *
 * @otel-exempt pure helper of `rankConstraints`.
 */
function compareConstraints(a: RankedConstraint, b: RankedConstraint): number {
  if (a.product !== b.product) return b.product - a.product;
  return a.ruleId.localeCompare(b.ruleId);
}

/** @otel-exempt pure helper. */
function severityOf(product: number): ConstraintSeverity {
  if (product >= SEVERITY_THRESHOLDS.high) return "high";
  if (product >= SEVERITY_THRESHOLDS.medium) return "medium";
  return "low";
}
