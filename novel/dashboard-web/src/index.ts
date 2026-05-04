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

export { createServer, type DashboardServer } from "./server.js";
export { SUCCESS_METRICS, type SuccessMetric } from "./metrics.js";
export { render, STUB_GET_VALUE, type GetValue } from "./render.js";
export { constantGetValue, snapshotGetValue, type Snapshot } from "./strategy.js";
export {
  STUB_PAUSE_STATE,
  WATCH_METRIC_IDS,
  type PauseState,
  type WatchEnvelope,
  type WatchKey,
  watchEnvelope,
} from "./watch.js";
export {
  STUB_SET_PAUSED,
  createMemoryPauseState,
  parseControlBody,
  type ParseControlResult,
  type SetPaused,
} from "./control.js";
