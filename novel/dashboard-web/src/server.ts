/**
 * `@minsky/dashboard-web` — Hono SSR server scaffold (v0 sub-task 3/4).
 * Single route: `GET /` returns the HTML produced by `render({ metrics })`.
 * Returns `app.fetch` so tests can drive the route without a real port.
 *
 * Sub-task 3 wires the 10-entry `SUCCESS_METRICS` constant from
 * `metrics.ts` as the default `metrics` source so the parent
 * `dashboard-web-v0`'s "10 `data-metric-id=` attributes" verification cell
 * is satisfied without a caller. The argument remains optional to keep the
 * signature backward-compatible for tests injecting custom arrays
 * (rule #7 — cold-start contract: empty `metrics` still yields a
 * well-formed document).
 */

import { Hono } from "hono";

import { SUCCESS_METRICS, type SuccessMetric } from "./metrics.js";
import { render } from "./render.js";

/** Server handle: `app` for tests, `fetch` for embedding. */
export interface DashboardServer {
  readonly app: Hono;
  readonly fetch: Hono["fetch"];
}

/**
 * Build a fresh Hono app with `GET /` wired. Does not bind a port —
 * caller decides whether to embed via `fetch` or `serve()`. `metrics`
 * defaults to `SUCCESS_METRICS` (the 10 vision.md success criteria);
 * tests inject custom arrays to exercise edge cases.
 *
 * @otel dashboard-web.create-server
 */
export function createServer(args?: {
  readonly metrics?: readonly SuccessMetric[];
}): DashboardServer {
  const metrics = args?.metrics ?? SUCCESS_METRICS;
  const app = new Hono();
  app.get("/", (c) => c.html(render({ metrics })));
  return { app, fetch: app.fetch };
}
