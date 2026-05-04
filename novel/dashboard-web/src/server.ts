/**
 * `@minsky/dashboard-web` — Hono SSR server scaffold.
 * Single route: `GET /` returns the HTML produced by `render({ metrics, getValue })`.
 * Returns `app.fetch` so tests can drive the route without a real port.
 *
 * `getValue` is the Strategy seam (rule #2) opened by
 * `dashboard-web-otel-wiring`: callers inject a synchronous lookup
 * `(m: SuccessMetric) => string | null`. `null` renders the `(stub)`
 * sentinel (backward-compatible default); a string is HTML-escaped and
 * displayed in place of `(stub)`. Async snapshot work happens upstream
 * (`start.ts` + the runner) so the per-render path stays synchronous and
 * fast — the parent task's 500-ms per-render budget is enforced by
 * keeping I/O off the request hot-path entirely.
 */

import { Hono } from "hono";

import { SUCCESS_METRICS, type SuccessMetric } from "./metrics.js";
import { type GetValue, STUB_GET_VALUE, render } from "./render.js";

/** Server handle: `app` for tests, `fetch` for embedding. */
export interface DashboardServer {
  readonly app: Hono;
  readonly fetch: Hono["fetch"];
}

/**
 * Build a fresh Hono app with `GET /` wired. Does not bind a port —
 * caller decides whether to embed via `fetch` or `serve()`. `metrics`
 * defaults to `SUCCESS_METRICS` (the 10 vision.md success criteria);
 * `getValue` defaults to `STUB_GET_VALUE` (every row → `(stub)`); tests
 * inject custom Strategies to exercise the live-value path.
 *
 * @otel dashboard-web.create-server
 */
export function createServer(args?: {
  readonly metrics?: readonly SuccessMetric[];
  readonly getValue?: GetValue;
}): DashboardServer {
  const metrics = args?.metrics ?? SUCCESS_METRICS;
  const getValue = args?.getValue ?? STUB_GET_VALUE;
  const app = new Hono();
  app.get("/", (c) => c.html(render({ metrics, getValue })));
  return { app, fetch: app.fetch };
}
