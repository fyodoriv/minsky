/**
 * `@minsky/adapter-types` — leaf types package for the adapter health-probe
 * contract shared by every Minsky adapter.
 *
 * Pattern conformance (per vision.md § 8 / Pattern conformance index):
 *   - This module:           Adapter (structural) supporting types per Gamma,
 *                            Helm, Johnson, Vlissides, *Design Patterns*, 1994.
 *                            Conformance: full.
 *   - `SelfTestResult`:      Self-checking software / health probe — Avizienis,
 *                            *IEEE TSE* 1985; Burns et al., "Borg, Omega, and
 *                            Kubernetes", *ACM Queue* 2016 (liveness probe).
 *                            Conformance: full.
 *   - `aggregateStatus()`:   Worst-status aggregation over a status lattice —
 *                            Avizienis et al., "Basic Concepts and Taxonomy of
 *                            Dependable and Secure Computing", *IEEE TDSC* 2004.
 *                            Equivalent to the Kubernetes pod-phase rule
 *                            (red ⊐ yellow ⊐ green is the lattice meet).
 *                            Conformance: full. The identifier matches the
 *                            pattern's canonical name per rule #8.
 *
 * Why this is a leaf package (Martin, *Clean Architecture*, 2017 — acyclic
 * dependency principle): every adapter (`@minsky/observability`,
 * `@minsky/budget-guard`, `@minsky/token-monitor`, future) consumes this
 * contract. If it lived inside `@minsky/observability`, then
 * `@minsky/budget-guard → @minsky/observability` for a base type would be
 * an architectural cycle (budget-guard does not depend on observability;
 * they are siblings). The fix per Wiggins' Twelve-Factor App factor II
 * (explicit dependencies) is to hoist the shared contract to a leaf with
 * zero internal Minsky deps.
 *
 * `@minsky/observability` re-exports these names for back-compat so
 * existing `import { aggregateStatus } from "@minsky/observability"` keeps
 * working.
 */

/**
 * Health-probe status. Forms a 3-element lattice: green < yellow < red.
 * The aggregator (worst-status-wins) is the lattice's meet operation.
 */
export type SelfTestStatus = "green" | "yellow" | "red";

/**
 * One adapter's self-check result. Implements the health-probe pattern
 * (Avizienis 1985; Kubernetes liveness probe). Setup.sh's `--doctor` mode
 * aggregates these across all registered adapters via {@link aggregateStatus}.
 */
export interface SelfTestResult {
  readonly status: SelfTestStatus;
  readonly message: string;
  readonly latencyMs: number;
  readonly lastCheck: string;
}

/**
 * Worst-status aggregation over a {@link SelfTestStatus} lattice. Returns
 * the meet (greatest lower bound) of all input statuses: red dominates
 * yellow dominates green. Empty input is green (vacuous truth — no failures
 * observed).
 *
 * Pattern: status-lattice aggregation (Avizienis et al., *IEEE TDSC* 2004).
 * Equivalent to Kubernetes pod-phase computation. Identifier matches the
 * pattern's canonical name per constitutional rule #8.
 *
 * @otel-exempt pure function — no I/O, no side effects, called inside
 *   another adapter's already-traced `selfTest()` span. A wrapping span
 *   here would be empty noise. (When CI rule-4 lands and enforces `@otel`
 *   tagging, this exemption is the documented justification per rule #10's
 *   spirit: declare the deviation explicitly rather than slip past silently.)
 */
export function aggregateStatus(results: readonly SelfTestResult[]): SelfTestStatus {
  if (results.some((r) => r.status === "red")) return "red";
  if (results.some((r) => r.status === "yellow")) return "yellow";
  return "green";
}
