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
 * Minimal span event shape that callers (e.g. `@minsky/tick-loop`'s daemon)
 * emit per phase. Mirrors the daemon's existing `TickSpan` type so the
 * CLI can pass `obs.emitTickSpan` straight in as the `emit` callback to
 * `runDaemon` without any adapter glue. `attributes` values are restricted
 * to the OTEL primitive scalars so the OTLP exporter can serialise them.
 */
export interface ObservabilityEvent {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Observability adapter interface — the Adapter pattern (Gamma et al. 1994)
 * applied to the OpenTelemetry contract. Strategy implementations live in
 * sibling files (e.g., `./otel.ts` — `OtelObservability`).
 */
export interface Observability {
  /** Health probe per the {@link SelfTestResult} contract. */
  selfTest(): Promise<SelfTestResult>;
  /**
   * Emit one event as an OTEL span: starts a span with `event.name`, sets
   * the `attributes` map, and ends it synchronously. The exporter ships it
   * to the configured OTLP endpoint asynchronously (the call returns
   * immediately — fire-and-forget per rule #7 graceful-degrade; a missed
   * span must never block the caller's hot loop).
   *
   * Closes the publisher half of the publish-then-read MAPE-K loop: today
   * the daemon's `emit` callback writes plain text to stdout, so
   * OpenObserve receives nothing and the dashboard's `OpenObserveStrategy`
   * reads `(stub)`. With this method wired into the CLI's `emit`, the
   * publisher catches up with the reader.
   *
   * Surfaced by `daemon-otel-pipe` (P1, 2026-05-04).
   *
   * @otel observability.emit-tick-span
   */
  emitTickSpan(event: ObservabilityEvent): void;
}
