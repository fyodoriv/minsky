/**
 * `@minsky/dashboard-web` — concrete `GetValue` Strategies (rule #2 Adapter).
 *
 * `snapshotGetValue(snapshot)` reads a pre-fetched JSON map keyed by
 * `SuccessMetric.id`; the runner produces it via async OTEL / PromQL
 * queries. `constantGetValue(v)` smoke-tests the seam end-to-end without
 * a backend. Real live-query Strategies (Prometheus / OpenObserve) are a
 * follow-up — the snapshot indirection is the simplest shape that
 * satisfies the per-render 500-ms budget without per-request I/O.
 *
 * Anchor: rule #2 (every dep behind interface — value source is data,
 * not a hard import); Card & Mackinlay 1999 (live readings).
 */

import type { SuccessMetric } from "./metrics.js";
import type { GetValue } from "./render.js";

/** Snapshot map: metric id → current rendered value (string). */
export type Snapshot = Readonly<Record<string, string>>;

/** @otel-exempt pure data lookup, no I/O. */
export function snapshotGetValue(snapshot: Snapshot): GetValue {
  return (m: SuccessMetric) => {
    const v = snapshot[m.id];
    return v === undefined ? null : v;
  };
}

/** @otel-exempt pure data lookup, no I/O. */
export function constantGetValue(value: string): GetValue {
  return () => value;
}
