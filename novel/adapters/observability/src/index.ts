/**
 * Observability adapter — minimal interface stub.
 *
 * The real implementation will satisfy ARCHITECTURE.md § "The adapter pattern"
 * and emit OpenTelemetry traces/metrics/logs that propagate TRACEPARENT through
 * Claude Code subagents. This stub exists to validate the toolchain (Biome + tsc
 * + Vitest + coverage) before the real implementation lands in a follow-up PR.
 *
 * See user-stories/001-loop-runs-overnight.md for the integration test that
 * will exercise the real implementation.
 */

export type SelfTestStatus = "green" | "yellow" | "red";

export interface SelfTestResult {
  readonly status: SelfTestStatus;
  readonly message: string;
  readonly latencyMs: number;
  readonly lastCheck: string;
}

export interface Observability {
  /** Returns a self-test result per the bootstrap selfTest contract. */
  selfTest(): Promise<SelfTestResult>;
}

/**
 * Aggregate adapter self-test results into an overall status.
 * Red dominates yellow dominates green.
 */
export function aggregateStatus(results: readonly SelfTestResult[]): SelfTestStatus {
  if (results.some((r) => r.status === "red")) return "red";
  if (results.some((r) => r.status === "yellow")) return "yellow";
  return "green";
}
