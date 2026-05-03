/**
 * Observability adapter — minimal interface stub.
 *
 * Pattern conformance (per vision.md § 8 / Pattern conformance index):
 *   - This module:           Adapter (structural) + Strategy (behavioral) per
 *                            Gamma, Helm, Johnson, Vlissides, *Design Patterns*, 1994.
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
 * The real OpenTelemetry implementation (planned in P1 task observability-adapter-v0)
 * will emit traces/metrics/logs that propagate TRACEPARENT through Claude Code
 * subagents per ARCHITECTURE.md § "Observability". This stub exists to validate
 * the toolchain (Biome + tsc + Vitest + coverage).
 *
 * See user-stories/001-loop-runs-overnight.md for the integration test that
 * will exercise the real implementation.
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
 * Observability adapter interface — the Adapter pattern (Gamma et al. 1994)
 * applied to the OpenTelemetry contract. Strategy implementations live in
 * sibling files (e.g., `observability.otel.ts`, planned).
 */
export interface Observability {
  /** Health probe per the {@link SelfTestResult} contract. */
  selfTest(): Promise<SelfTestResult>;
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
 */
export function aggregateStatus(results: readonly SelfTestResult[]): SelfTestStatus {
  if (results.some((r) => r.status === "red")) return "red";
  if (results.some((r) => r.status === "yellow")) return "yellow";
  return "green";
}
