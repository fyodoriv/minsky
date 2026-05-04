/**
 * `@minsky/tick-loop/budget-guard-facade` — thin Adapter (Gamma 1994) that
 * wraps the real `@minsky/budget-guard` `BudgetGuard` (which exposes
 * `tick()`) behind the daemon's structural `BudgetGuardLike.decide()` shape.
 *
 * This is the **Pivot path** pre-registered in
 * `tick-loop-daemon-budget-guard-real`'s task block: the real
 * `BudgetGuard`'s public surface is `tick(): Promise<BudgetDecision>` (the
 * watchdog idiom — periodic-deadline check loop, not a "decide" call), so
 * a thin facade is the cleanest seam without forking the real package's
 * API. The daemon keeps depending on the structural `BudgetGuardLike`
 * type (rule #2 — every dep behind interface) and the facade is the
 * one-line bridge.
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index, row 67):
 *   - **Adapter** — Gamma, Helm, Johnson, Vlissides, *Design Patterns*,
 *     Addison-Wesley, 1994. The facade adapts the real `BudgetGuard.tick()`
 *     surface (its watchdog idiom) to the daemon's expected `decide()`
 *     surface. Conformance: full.
 *
 * @module tick-loop/budget-guard-facade
 */

import type { BudgetDecision, BudgetGuard } from "@minsky/budget-guard";

import type { BudgetDecisionLike, BudgetGuardLike } from "./daemon.js";

/**
 * Wrap a real `@minsky/budget-guard` `BudgetGuard` instance behind the
 * daemon's structural `BudgetGuardLike` shape. The facade calls
 * `guard.tick()` — which itself takes a fresh `TokenMonitor.snapshot()` and
 * runs the pure `decide(...)` thresholding inside — and returns the
 * minimum `{ action, reason }` projection the daemon branches on.
 *
 * No I/O of its own; all I/O is inside `guard.tick()`'s monitor.
 *
 * @otel tick-loop.budget-guard-facade.from-real-guard
 */
export function fromRealBudgetGuard(guard: BudgetGuard): BudgetGuardLike {
  return {
    decide: async (): Promise<BudgetDecisionLike> => projectDecision(await guard.tick()),
  };
}

/**
 * Project a full `BudgetDecision` (action + snapshot + consumed + reason +
 * decidedAt) down to the minimum the daemon needs (`{ action, reason }`).
 *
 * (Internal helper — no JSDoc tag required.)
 */
function projectDecision(d: BudgetDecision): BudgetDecisionLike {
  return { action: d.action, reason: d.reason };
}
