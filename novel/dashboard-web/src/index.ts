/**
 * `@minsky/dashboard-web` — package entry. SSR shell (`createServer`) +
 * pure renderer (`render`) + `SuccessMetric` shape + 10-row
 * `SUCCESS_METRICS` constant + `GetValue` Strategy seam (rule #2)
 * with `snapshotGetValue` / `constantGetValue` Adapter implementations.
 *
 * Pattern conformance: vision.md § "Pattern conformance index" row 57.
 *
 * @module dashboard-web
 */

export {
  createMemoryPauseState,
  type ParseControlResult,
  parseControlBody,
  type SetPaused,
  STUB_SET_PAUSED,
} from "./control.js";
export { SUCCESS_METRICS, type SuccessMetric } from "./metrics.js";
export { type GetValue, render, STUB_GET_VALUE } from "./render.js";
export { createServer, type DashboardServer } from "./server.js";
export { constantGetValue, type Snapshot, snapshotGetValue } from "./strategy.js";
export {
  type PauseState,
  STUB_PAUSE_STATE,
  WATCH_METRIC_IDS,
  type WatchEnvelope,
  type WatchKey,
  watchEnvelope,
} from "./watch.js";
