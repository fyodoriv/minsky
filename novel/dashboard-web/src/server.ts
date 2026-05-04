/**
 * `@minsky/dashboard-web` — Hono SSR server scaffold (v0 sub-task 1/4).
 * Single route: `GET /` returns the HTML produced by `render({ metrics })`.
 * Returns `app.fetch` so tests can drive the route without a real port.
 */

import { Hono } from "hono";

import type { SuccessMetric } from "./metrics.js";
import { render } from "./render.js";

/** Server handle: `app` for tests, `fetch` for embedding. */
export interface DashboardServer {
  readonly app: Hono;
  readonly fetch: Hono["fetch"];
}

/**
 * Build a fresh Hono app with `GET /` wired. Does not bind a port —
 * caller decides whether to embed via `fetch` or `serve()`.
 *
 * @otel dashboard-web.create-server
 */
export function createServer(args: {
  readonly metrics: readonly SuccessMetric[];
}): DashboardServer {
  const app = new Hono();
  app.get("/", (c) => c.html(render({ metrics: args.metrics })));
  return { app, fetch: app.fetch };
}
