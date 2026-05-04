/**
 * Observability adapter — minimal interface stub.
 *
 * Pattern conformance (per vision.md § 8 / Pattern conformance index):
 *   - This module:           Adapter (structural) + Strategy (behavioral) per
 *                            Gamma, Helm, Johnson, Vlissides, *Design Patterns*, 1994.
 *                            Conformance: full.
 *   - `SelfTestResult`:      Health-probe shape — defined in
 *                            `@minsky/adapter-types` (leaf package per Martin,
 *                            *Clean Architecture*, 2017 — acyclic dependency
 *                            principle). Re-exported here for back-compat.
 *   - `aggregateStatus()`:   Worst-status lattice meet — defined in
 *                            `@minsky/adapter-types`. Re-exported here.
 *
 * The shared health-probe contract used to live in this file. It was hoisted
 * to `@minsky/adapter-types` (a leaf package) so future adapters
 * (`@minsky/budget-guard`, etc.) depend on the leaf directly instead of
 * forming a `budget-guard → observability` dependency cycle through a base
 * type. Existing imports `import { aggregateStatus } from "@minsky/observability"`
 * keep working via the re-export below; the canonical home is the leaf.
 *
 * The real OpenTelemetry implementation (planned in P1 task observability-adapter-v0)
 * will emit traces/metrics/logs that propagate TRACEPARENT through Claude Code
 * subagents per ARCHITECTURE.md § "Observability". This stub exists to validate
 * the toolchain (Biome + tsc + Vitest + coverage).
 *
 * See user-stories/001-loop-runs-overnight.md for the integration test that
 * will exercise the real implementation.
 */

// Re-export the shared health-probe contract from the leaf types package.
// Public API of `@minsky/observability` is unchanged: callers can keep doing
// `import { aggregateStatus, type SelfTestResult } from "@minsky/observability"`.
export { aggregateStatus, type SelfTestResult, type SelfTestStatus } from "@minsky/adapter-types";

import type { SelfTestResult } from "@minsky/adapter-types";

/**
 * Observability adapter interface — the Adapter pattern (Gamma et al. 1994)
 * applied to the OpenTelemetry contract. Strategy implementations live in
 * sibling files (e.g., `observability.otel.ts`, planned).
 */
export interface Observability {
  /** Health probe per the {@link SelfTestResult} contract. */
  selfTest(): Promise<SelfTestResult>;
}
