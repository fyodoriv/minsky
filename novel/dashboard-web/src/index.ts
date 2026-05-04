/**
 * `@minsky/dashboard-web` — package entry. Sub-task 1/4 of `dashboard-web-v0`:
 * SSR shell (`createServer`) + pure renderer (`render`) + `SuccessMetric`
 * shape with one placeholder. Sub-tasks 2-4 wire the 10 vision.md metrics,
 * the OTEL backend, and the Lighthouse Mobile ≥0.9 CI gate.
 *
 * Pattern conformance: vision.md § "Pattern conformance index" row 57.
 *
 * @module dashboard-web
 */

export { createServer, type DashboardServer } from "./server.js";
export { PLACEHOLDER_METRICS, type SuccessMetric } from "./metrics.js";
export { render } from "./render.js";
